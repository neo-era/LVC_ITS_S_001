import { FileSource, PMTiles } from 'pmtiles';
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

  list(): Downloaded[] {
    return this.meta;
  }

  has(slug: string): boolean {
    return this.meta.some((m) => m.slug === slug);
  }

  async init(): Promise<void> {
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
        /* tệp hỏng: bỏ */
      }
    }
    if (keep.length !== this.meta.length) writeMeta((this.meta = keep));
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
    if (res.headers.get('content-length') && got !== total) throw new Error('Tải chưa trọn vẹn, vui lòng thử lại.');
    const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
    const src = await open(p.slug, blob).catch(() => {
      throw new Error('Tệp bản đồ bị hỏng, vui lòng thử lại.');
    });
    const cache = await caches.open(CACHE);
    await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
    this.loaded = [...this.loaded.filter((l) => l.slug !== p.slug), src];
    this.meta = [...this.meta.filter((m) => m.slug !== p.slug), { slug: p.slug, name: p.name, bbox: p.bbox, bytes: got, updated, file: p.file }];
    writeMeta(this.meta);
  }

  async remove(slug: string): Promise<void> {
    const m = this.meta.find((x) => x.slug === slug);
    if (m && 'caches' in window) await (await caches.open(CACHE)).delete(urlOf(m.file));
    this.loaded = this.loaded.filter((l) => l.slug !== slug);
    this.meta = this.meta.filter((x) => x.slug !== slug);
    writeMeta(this.meta);
  }

  /** Dữ liệu ô z/x/y từ bản đồ đã tải; null nếu không có. */
  async tile(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer | null> {
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
