// Kiểm thử service worker (A1–A3): chạy public/sw.js trong môi trường giả lập.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { stampSw } from '../src/update';

type Handler = (e: any) => void;

class FakeCache {
  m = new Map<string, Response>();
  async put(req: Request | string, res: Response) {
    this.m.set(typeof req === 'string' ? req : req.url, res);
  }
  async match(req: Request | string) {
    const u = typeof req === 'string' ? req : req.url;
    const r = this.m.get(u.split('?')[0]) ?? this.m.get(u);
    return r ? r.clone() : undefined;
  }
  async addAll(urls: string[]) {
    for (const u of urls) this.m.set(u, new Response('x'));
  }
  async keys() {
    return [...this.m.keys()].map((u) => new Request(u));
  }
  async delete(req: Request | string) {
    return this.m.delete(typeof req === 'string' ? req : req.url);
  }
}

function load(opts: { fetch: (req: Request | string) => Promise<Response>; precache?: string[]; build?: string }) {
  let src = readFileSync(join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  src = stampSw(src, opts.build ?? 'b1', opts.precache ?? []);
  const stores = new Map<string, FakeCache>();
  const caches = {
    async open(n: string) {
      if (!stores.has(n)) stores.set(n, new FakeCache());
      return stores.get(n)!;
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(n: string) {
      return stores.delete(n);
    },
    async match(req: Request | string) {
      for (const c of stores.values()) {
        const r = await c.match(req);
        if (r) return r;
      }
      return undefined;
    },
  };
  const handlers: Record<string, Handler> = {};
  const self: any = {
    registration: { scope: 'https://x.test/app/' },
    addEventListener: (t: string, h: Handler) => (handlers[t] = h),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const ctx = vm.createContext({ self, caches, fetch: opts.fetch, location: { origin: 'https://x.test' }, URL, Request, Response, setTimeout, clearTimeout, Promise, console });
  vm.runInContext(src, ctx);
  const fire = async (type: string, extra: any = {}) => {
    const waits: Promise<unknown>[] = [];
    let resp: Promise<Response> | undefined;
    let dispatching = true;
    // như trình duyệt: waitUntil chỉ gọi được khi đang xử lý sự kiện hoặc còn lời hứa waitUntil chưa xong
    const e = {
      waitUntil: (p: Promise<unknown>) => {
        if (!dispatching && waits.length === 0) throw new Error('InvalidStateError');
        waits.push(p);
      },
      respondWith: (p: Promise<Response>) => (resp = p),
      ...extra,
    };
    handlers[type](e);
    dispatching = false;
    const r = resp ? await resp : undefined;
    // không chờ mạng treo mãi; các kiểm thử cần ghi kho tự chờ "waits"
    await Promise.race([Promise.all(waits), new Promise((ok) => setTimeout(ok, 10))]);
    return { res: r, waits };
  };
  return { stores, fire, caches };
}

const html = '<script src="./assets/index-a.js"></script>';

describe('service worker', () => {
  it('A1: cache dữ liệu tên cố định, không bị xoá khi đổi phiên bản', async () => {
    const f = vi.fn(async (req: any) => new Response(String(req.url ?? req).endsWith('/app/') ? html : '{}'));
    const a = load({ fetch: f, build: 'b1' });
    await a.fire('install');
    await a.fire('activate');
    await a.fire('fetch', { request: new Request('https://x.test/app/data/cells/1.json') });
    expect([...a.stores.keys()]).toContain('lat-data');
    // bản mới: dùng chung kho, activate không xoá lat-data
    const b = load({ fetch: f, build: 'b2' });
    for (const [k, v] of a.stores) b.stores.set(k, v);
    await b.fire('install');
    await b.fire('activate');
    expect(b.stores.has('lat-data')).toBe(true);
    expect([...b.stores.keys()].some((k) => k.includes('b1'))).toBe(false);
  });

  it('A1: giới hạn số ô lưu (bỏ ô cũ nhất)', async () => {
    const f = vi.fn(async () => new Response('{}'));
    const a = load({ fetch: f });
    const c = await a.caches.open('lat-data');
    for (let i = 0; i < 3000; i++) await c.put(`https://x.test/app/data/cells/${i}.json`, new Response('{}'));
    await a.fire('fetch', { request: new Request('https://x.test/app/data/cells/new.json') });
    expect(c.m.size).toBeLessThanOrEqual(3000);
    expect(c.m.has('https://x.test/app/data/cells/new.json')).toBe(true);
    expect(c.m.has('https://x.test/app/data/cells/0.json')).toBe(false);
  });

  it('A2: lưu sẵn mọi tệp assets theo danh sách build (kể cả maplibre nạp động)', async () => {
    const f = vi.fn(async (req: any) => new Response(String(req.url ?? req).endsWith('/app/') ? html : 'js'));
    const a = load({ fetch: f, precache: ['assets/index-a.js', 'assets/maplibre-gl-z.js'] });
    await a.fire('install');
    const shell = [...a.stores.entries()].find(([k]) => k.endsWith('-shell'))![1];
    expect(shell.m.has('https://x.test/app/assets/maplibre-gl-z.js')).toBe(true);
  });

  it('A3: mạng treo > 3 s thì trả bản đã lưu', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(() => new Promise<Response>(() => {})); // treo mãi
      const a = load({ fetch: f });
      const c = await a.caches.open('lat-data');
      await c.put('https://x.test/app/data/cells/5.json', new Response('cu'));
      const p = a.fire('fetch', { request: new Request('https://x.test/app/data/cells/5.json') });
      await vi.advanceTimersByTimeAsync(3100);
      const r = await p;
      expect(await r!.res!.text()).toBe('cu');
    } finally {
      vi.useRealTimers();
    }
  });

  it('QA: mạng chậm trả bản lưu, nhưng khi mạng về vẫn ghi bản mới vào kho', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(() => new Promise<Response>((res) => setTimeout(() => res(new Response('moi')), 5000)));
      const a = load({ fetch: f });
      const c = await a.caches.open('lat-data');
      await c.put('https://x.test/app/data/cells/7.json', new Response('cu'));
      const p = a.fire('fetch', { request: new Request('https://x.test/app/data/cells/7.json') });
      await vi.advanceTimersByTimeAsync(6000);
      const r = await p;
      expect(await r!.res!.text()).toBe('cu');
      expect(r!.waits.length).toBeGreaterThan(0);
      await Promise.all(r!.waits);
      expect(await (await c.match('https://x.test/app/data/cells/7.json'))!.text()).toBe('moi');
    } finally {
      vi.useRealTimers();
    }
  });

  it('QA: phải sao chép phản hồi trước khi trang đọc nội dung (clone sau await thì hỏng)', async () => {
    let handedOut = false;
    const mk = (): Response => {
      const r = new Response('moi');
      const orig = r.clone.bind(r);
      (r as any).clone = () => {
        if (handedOut) throw new TypeError('body used');
        return orig();
      };
      return r;
    };
    const f = vi.fn(async () => mk());
    const a = load({ fetch: f });
    const c = await a.caches.open('lat-data');
    let given: Promise<Response> | undefined;
    // trình duyệt dùng phản hồi ngay khi lời hứa của respondWith xong → sau đó không clone được nữa
    const r = await a.fire('fetch', {
      request: new Request('https://x.test/app/data/cells/8.json'),
      respondWith: (p: Promise<Response>) => (given = p.then((x) => ((handedOut = true), x))),
    });
    await given;
    await Promise.all(r!.waits);
    expect(c.m.has('https://x.test/app/data/cells/8.json')).toBe(true);
  });

  it('A3: chưa có bản lưu thì vẫn chờ mạng', async () => {
    vi.useFakeTimers();
    try {
      const f = vi.fn(() => new Promise<Response>((res) => setTimeout(() => res(new Response('moi')), 5000)));
      const a = load({ fetch: f });
      const p = a.fire('fetch', { request: new Request('https://x.test/app/data/cells/9.json') });
      await vi.advanceTimersByTimeAsync(5100);
      expect(await (await p)!.res!.text()).toBe('moi');
    } finally {
      vi.useRealTimers();
    }
  });
});
