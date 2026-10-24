import { foldName } from '../pipeline/names';

export interface SavedPlace {
  name: string;
  lat: number;
  lng: number;
}

const MAX = 30;

export function parsePlaces(raw: unknown): SavedPlace[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is SavedPlace =>
      !!p &&
      typeof p.name === 'string' &&
      p.name.trim() !== '' &&
      typeof p.lat === 'number' &&
      typeof p.lng === 'number' &&
      p.lat >= 8 &&
      p.lat <= 24 &&
      p.lng >= 102 &&
      p.lng <= 110,
  );
}

/** Thêm địa điểm; trùng tên (không phân biệt dấu/hoa) thì thay; quá 30 bỏ mục cũ nhất. */
export function addPlace(list: SavedPlace[], p: SavedPlace): SavedPlace[] {
  const f = foldName(p.name);
  const out = [...list.filter((x) => foldName(x.name) !== f), { name: p.name.trim(), lat: p.lat, lng: p.lng }];
  return out.slice(Math.max(0, out.length - MAX));
}

export function removePlace(list: SavedPlace[], name: string): SavedPlace[] {
  const f = foldName(name);
  return list.filter((x) => foldName(x.name) !== f);
}

/** Khớp trọn tên, hoặc khớp nguyên từ ("bàn cờ" ra "Chợ Bàn Cờ"; "ba" thì không). */
export function findPlaceByName(list: SavedPlace[], q: string): SavedPlace | null {
  const f = foldName(q);
  if (!f) return null;
  return list.find((x) => foldName(x.name) === f) ?? list.find((x) => ` ${foldName(x.name)} `.includes(` ${f} `)) ?? null;
}
