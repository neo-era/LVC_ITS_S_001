import { bboxContains, tileBBox, type BBox } from './tiles';

export interface ProvinceInfo {
  name: string;
  slug: string;
  bbox: BBox;
  bytes: number;
  file: string;
}

export interface LocalSourceInfo {
  slug: string;
  bbox: BBox;
  minZoom: number;
  maxZoom: number;
}

export function parseLatmapUrl(url: string): { z: number; x: number; y: number } | null {
  const m = /^latmap:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(url);
  return m ? { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\b(tinh|thanh pho|tp\.?)\s+/g, '')
    .trim();

export function filterProvinces<T extends { name: string }>(list: T[], q: string): T[] {
  const f = fold(q);
  return f ? list.filter((p) => fold(p.name).includes(f)) : list;
}

/** Tỉnh đang đứng: khung bao chứa vị trí, ưu tiên khung nhỏ nhất. */
export function suggestProvince<T extends { bbox: BBox }>(list: T[], pos: { lat: number; lng: number } | null): T | null {
  if (!pos) return null;
  const area = (b: BBox) => (b[2] - b[0]) * (b[3] - b[1]);
  const hits = list.filter((p) => pos.lng >= p.bbox[0] && pos.lng <= p.bbox[2] && pos.lat >= p.bbox[1] && pos.lat <= p.bbox[3]);
  hits.sort((a, b) => area(a.bbox) - area(b.bbox));
  return hits[0] ?? null;
}

/** Các nguồn bản đồ đã tải có thể chứa ô z/x/y. */
export function pickLocal<T extends LocalSourceInfo>(sources: T[], z: number, x: number, y: number): T[] {
  const tb = tileBBox(z, x, y);
  return sources.filter((s) => z >= s.minZoom && z <= s.maxZoom && bboxContains(s.bbox, tb));
}

export function formatMB(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1).replace('.', ',')} GB`;
  const mb = bytes / 1048576;
  if (mb === 0) return '0 MB';
  return mb < 10 ? `${mb.toFixed(1).replace('.', ',').replace(/,0$/, '')} MB` : `${Math.round(mb)} MB`;
}
