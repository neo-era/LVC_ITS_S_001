import { formatDistance } from '../core/format';
import { haversine } from '../core/geo';
import { foldName } from '../pipeline/names';
import type { Place } from './geocode';

export interface NameEntry {
  name: string;
  folded: string;
  lat: number;
  lng: number;
  kind: 's' | 'p';
}

export function parseNameShard(rows: unknown): NameEntry[] {
  if (!Array.isArray(rows)) return [];
  const out: NameEntry[] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || typeof r[0] !== 'string' || !Number.isInteger(r[1]) || !Number.isInteger(r[2])) continue;
    const lat = r[1] / 1e5;
    const lng = r[2] / 1e5;
    if (lat < 8 || lat > 24 || lng < 102 || lng > 110) continue;
    out.push({ name: r[0], folded: foldName(r[0]), lat, lng, kind: r[3] === 'p' ? 'p' : 's' });
  }
  return out;
}

/** Tìm tên đường/địa danh trên máy: mọi từ khoá phải có trong tên (không dấu); khớp trọn tên và gần vị trí lên trước. */
export function searchLocal(entries: NameEntry[], q: string, near: { lat: number; lng: number } | null, limit = 6): Place[] {
  const fq = foldName(q);
  if (fq.length < 1 || !fq.trim()) return [];
  const toks = fq.split(' ');
  const hits: { e: NameEntry; score: number; d: number }[] = [];
  for (const e of entries) {
    const words = ` ${e.folded} `;
    // Từ chữ: khớp đầu từ (gõ "lien" ra "liên"); từ số: phải khớp trọn ("4" không ra "45").
    if (!toks.every((t) => (/^\d+$/.test(t) ? words.includes(` ${t} `) : words.includes(` ${t}`)))) continue;
    const exact = e.folded === fq ? 0 : e.folded.startsWith(fq) ? 1 : 2;
    const d = near ? haversine(near, e) : 0;
    hits.push({ e, score: exact, d });
  }
  hits.sort((a, b) => a.score - b.score || a.d - b.d);
  return hits.slice(0, limit).map(({ e, d }) => ({
    name: e.name,
    detail: `${e.kind === 'p' ? 'Khu vực' : 'Đường'}${near ? ` · cách ${formatDistance(d)}` : ''}`,
    lat: e.lat,
    lng: e.lng,
  }));
}
