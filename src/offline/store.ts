import { FileSource, PMTiles } from 'pmtiles';
import { collectFontstacks, GLYPH_RANGES } from '../pipeline/style';
import { pickLocal, type LocalSourceInfo, type ProvinceInfo } from './core';
import type { BBox } from './tiles';

const CACHE = 'lat-map-offline-v1';
const META = 'lat.offline.v1';

export interface Downloaded {
  slug: string;
  name: string;
  bbox: BBox;
  bytes: number;
  updated: string;
  file: string;
}

type Loaded = LocalSourceInfo & { pm: PMTiles };

const mapBase = () => new URL('./map/', location.href).href;
const urlOf = (file: string) => new URL(file, mapBase()).href;

function readMeta(): Downloaded[] {
  try {
    const v = JSON.parse(localStorage.getItem(META) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function writeMeta(v: Downloaded[]): void {
  try {
    localStorage.setItem(META, JSON.stringify(v));
  } catch {
    /* bỏ qua */
  }
}

async function open(slug: string, blob: Blob): Promise<Loaded> {
  const pm = new PMTiles(new FileSource(new File([blob], `${slug}.pmtiles`)));
  const h = await pm.getHeader();
  return { slug, pm, bbox: [h.minLon, h.minLat, h.maxLon, h.maxLat], minZoom: h.minZoom, maxZoom: h.maxZoom };
}

/** Bản đồ offline đã tải trên máy (lưu trong Cache Storage), đọc ô bằng PMTiles. */
export class OfflineMaps {
  private loaded: Loaded[] = [];
  private meta: Downloaded[] = readMeta();
  private ready: Promise<void> = Promise.resolve();
  /** Tên các tỉnh đã tải nhưng bị trình duyệt xoá (vd Safari dọn dữ liệu khi lâu không mở). */
  evicted: string[] = [];

  list(): Downloaded[] {
    return this.meta;
  }

  has(slug: string): boolean {
    return this.meta.some((m) => m.slug === slug);
  }

  /** Mở các tỉnh đã tải (chạy nền; đọc ô, tải, xoá đều chờ bước này xong). */
  init(): Promise<void> {
    this.ready = (async () => {
      if (!('caches' in window)) return;
      const cache = await caches.open(CACHE);
      const keep: Downloaded[] = [];
      for (const m of this.meta) {
        try {
          const r = await cache.match(urlOf(m.file));
          if (!r) continue;
          this.loaded.push(await open(m.slug, await r.blob()));
          keep.push(m);
        } catch {
          await cache.delete(urlOf(m.file)).catch(() => {}); // tệp hỏng: xoá hẳn, không để chiếm chỗ
        }
      }
      if (keep.length !== this.meta.length) {
        this.evicted = this.meta.filter((m) => !keep.includes(m)).map((m) => m.name);
        writeMeta((this.meta = keep));
      }
    })().catch(() => {});
    return this.ready;
  }

  /** Lưu style, sprite và font cùng bản đồ để mở được khi mất mạng (cả giao diện sáng lẫn tối). */
  private async saveAssets(cache: Cache): Promise<void> {
    for (const key of ['light', 'dark']) {
      const styleUrl = urlOf(`style-${key}.json`);
      const r = await fetch(styleUrl, { cache: 'no-cache' });
      if (!r.ok) continue;
      const st = await r.clone().json();
      await cache.put(styleUrl, r);
      const urls: string[] = [];
      if (typeof st.sprite === 'string') {
        const sp = new URL(st.sprite, new URL('./', location.href)).href;
        for (const suf of ['.json', '.png', '@2x.json', '@2x.png']) urls.push(sp + suf);
      }
      if (typeof st.glyphs === 'string') {
        const g = new URL('./', location.href).href + st.glyphs.replace(/^\.\//, '');
        for (const f of collectFontstacks(st.layers ?? [])) {
          for (const range of GLYPH_RANGES) urls.push(g.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', range));
        }
      }
      for (const u of urls) {
        if (await cache.match(u)) continue;
        try {
          const a = await fetch(u);
          if (a.ok) await cache.put(u, a);
        } catch {
          /* thiếu một tệp phụ không chặn việc dùng bản đồ */
        }
      }
    }
  }

  async usage(): Promise<{ used: number; free: number | null }> {
    const used = this.meta.reduce((a, m) => a + m.bytes, 0);
    try {
      const e = await navigator.storage?.estimate?.();
      return { used, free: e?.quota != null && e.usage != null ? e.quota - e.usage : null };
    } catch {
      return { used, free: null };
    }
  }

  async download(
    p: ProvinceInfo,
    updated: string,
    onProgress: (loaded: number, total: number) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (!('caches' in window)) throw new Error('Trình duyệt này không hỗ trợ lưu bản đồ offline.');
    await this.ready;
    const { free } = await this.usage();
    if (free !== null && free < p.bytes * 1.2) throw new Error('Điện thoại không đủ chỗ trống để tải tỉnh này.');
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* bỏ qua */
    }
    const url = urlOf(p.file);
    const res = await fetch(url, { cache: 'no-store', signal });
    if (!res.ok || !res.body) throw new Error(`Không tải được (mã ${res.status}).`);
    const total = Number(res.headers.get('content-length')) || p.bytes;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.byteLength;
      onProgress(got, total);
    }
    const encoded = !!res.headers.get('content-encoding');
    if (!encoded && res.headers.get('content-length') && got !== total) throw new Error('Tải chưa trọn vẹn, vui lòng thử lại.');
    if (got < p.bytes * 0.98) throw new Error('Tải chưa trọn vẹn, vui lòng thử lại.');
    let blob: Blob | null = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
    chunks.length = 0;
    await open(p.slug, blob).catch(() => {
      throw new Error('Tệp bản đồ bị hỏng, vui lòng thử lại.');
    });
    const cache = await caches.open(CACHE);
    try {
      await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
      await this.saveAssets(cache);
    } catch (e) {
      await cache.delete(url).catch(() => {});
      if ((e as Error).name === 'QuotaExceededError') throw new Error('Điện thoại không đủ chỗ trống để lưu bản đồ tỉnh này.');
      throw new Error('Không lưu được bản đồ vào máy, vui lòng thử lại.');
    }
    blob = null;
    // Mở lại từ bản trong bộ nhớ đệm (nằm trên ổ, không giữ cả tệp trong RAM).
    const stored = await cache.match(url);
    const src = await open(p.slug, await stored!.blob());
    this.loaded = [...this.loaded.filter((l) => l.slug !== p.slug), src];
    this.meta = [...this.meta.filter((m) => m.slug !== p.slug), { slug: p.slug, name: p.name, bbox: p.bbox, bytes: got, updated, file: p.file }];
    writeMeta(this.meta);
  }

  async remove(slug: string): Promise<void> {
    await this.ready;
    const m = this.meta.find((x) => x.slug === slug);
    if (m && 'caches' in window) await (await caches.open(CACHE)).delete(urlOf(m.file));
    this.loaded = this.loaded.filter((l) => l.slug !== slug);
    this.meta = this.meta.filter((x) => x.slug !== slug);
    writeMeta(this.meta);
  }

  /** Dữ liệu ô z/x/y từ bản đồ đã tải; null nếu không có. */
  async tile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
    await this.ready;
    for (const s of pickLocal(this.loaded, z, x, y)) {
      try {
        const r = await s.pm.getZxy(z, x, y, signal);
        if (r?.data) return r.data;
      } catch {
        /* thử nguồn khác */
      }
    }
    return null;
  }
}
