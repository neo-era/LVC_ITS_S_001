/** Danh bạ tên đường / địa danh từ OSM để tìm địa điểm ngay trên máy (kể cả khi mất mạng). */
export const SHARD_DEG = 0.5; // mỗi mảnh ~55 km
const MERGE_DEG = 0.02; // đoạn cùng tên trong ~2 km coi là một đường

export function foldName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export const nameShardKey = (lat: number, lng: number): string => `${Math.floor(lat / SHARD_DEG)}_${Math.floor(lng / SHARD_DEG)}`;

export function shardsAround(lat: number, lng: number): string[] {
  const out: string[] = [];
  for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) out.push(nameShardKey(lat + dy * SHARD_DEG, lng + dx * SHARD_DEG));
  return out;
}

/** Dòng trong tệp mảnh: [tên, vĩ độ×1e5, kinh độ×1e5, loại 's' đường | 'p' địa danh]. */
export type NameRow = [string, number, number, 's' | 'p'];

export class NameIndex {
  private readonly rows = new Map<string, NameRow>();

  add(name: string | undefined, lat: number, lng: number, kind: 's' | 'p'): void {
    if (!name || !name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const key = `${foldName(name)}|${kind}|${Math.round(lat / MERGE_DEG)}|${Math.round(lng / MERGE_DEG)}`;
    if (this.rows.has(key)) return;
    this.rows.set(key, [name.trim(), Math.round(lat * 1e5), Math.round(lng * 1e5), kind]);
  }

  files(): Map<string, NameRow[]> {
    const out = new Map<string, NameRow[]>();
    for (const r of this.rows.values()) {
      const k = nameShardKey(r[1] / 1e5, r[2] / 1e5);
      const l = out.get(k) ?? [];
      l.push(r);
      out.set(k, l);
    }
    return out;
  }

  get size(): number {
    return this.rows.size;
  }
}
