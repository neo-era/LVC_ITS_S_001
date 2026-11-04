// A3/A4/A6: hạn giờ mạng, nạp song song có giới hạn, bỏ ô ở xa.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchT, mapLimit } from '../src/core/net';
import { Engine } from '../src/engine';
import { cellKey } from '../src/core/geo';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchT', () => {
  it('quá hạn thì huỷ và báo lỗi (không treo mãi)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
    );
    const p = fetchT('https://a', 8000);
    const assertion = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8100);
    await assertion;
  });
  it('tín hiệu huỷ từ ngoài vẫn có tác dụng', async () => {
    vi.stubGlobal('fetch', (_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
    );
    const ac = new AbortController();
    const p = fetchT('https://a', 60_000, { signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
  });
  it('trả kết quả bình thường khi kịp', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok'));
    expect(await (await fetchT('https://a', 1000)).text()).toBe('ok');
  });
});

describe('mapLimit', () => {
  it('chạy song song tối đa n việc', async () => {
    let now = 0;
    let peak = 0;
    const done: number[] = [];
    await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (x) => {
      now++;
      peak = Math.max(peak, now);
      await new Promise((r) => setTimeout(r, 5));
      now--;
      done.push(x);
    });
    expect(peak).toBe(4);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('một việc lỗi không làm dừng các việc khác', async () => {
    const done: number[] = [];
    await mapLimit([1, 2, 3], 2, async (x) => {
      if (x === 2) throw new Error('hỏng');
      done.push(x);
    });
    expect(done.sort()).toEqual([1, 3]);
  });
});

describe('Engine.evictFar', () => {
  it('chạy 300 km: số ô giữ lại ổn định, ô gần vẫn còn', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    let lat = 10.5;
    for (let i = 0; i < 300; i++) {
      lat += 0.009; // ~1 km mỗi bước
      for (let d = -1; d <= 1; d++) e.loadCell(cellKey(lat, 106.6 + d * 0.01), { segments: [], alerts: [] });
      e.evictFar(lat, 106.6, 5000, 300);
    }
    expect(e.cellCount()).toBeLessThanOrEqual(40);
    expect(e.hasCell(cellKey(lat, 106.6))).toBe(true);
    expect(e.hasCell(cellKey(10.51, 106.6))).toBe(false);
  });
  it('không vượt số ô tối đa', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    for (let y = 0; y < 30; y++) for (let x = 0; x < 30; x++) e.loadCell(cellKey(10.8 + y * 0.001, 106.6 + x * 0.001), { segments: [], alerts: [] });
    e.evictFar(10.8, 106.6, 1e9, 5);
    expect(e.cellCount()).toBeLessThanOrEqual(5);
  });
});

describe('dấu camera tự đánh dấu', () => {
  it('không chặn việc nạp dữ liệu thật của ô chứa dấu, và không mất khi bỏ ô', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    const m = { id: 'mark-1', lat: 10.8, lng: 106.6, kind: 'camera' } as any;
    e.addAlert(m);
    expect(e.hasCell(cellKey(10.8, 106.6))).toBe(false);
    e.loadCell(cellKey(10.8, 106.6), { segments: [], alerts: [{ id: 'osm-1', lat: 10.8001, lng: 106.6, kind: 'camera' } as any] });
    expect(e.alertsNear({ lat: 10.8, lng: 106.6 }, 100).map((a) => a.id).sort()).toEqual(['mark-1', 'osm-1']);
    e.evictFar(20, 100, 5000, 300);
    expect(e.alertsNear({ lat: 10.8, lng: 106.6 }, 100).map((a) => a.id)).toEqual(['mark-1']);
    e.removeAlert(m);
    expect(e.alertsNear({ lat: 10.8, lng: 106.6 }, 100)).toEqual([]);
  });
});
