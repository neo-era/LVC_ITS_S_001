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

/** Đổi tên điểm đã lưu. Không cho tên rỗng hoặc trùng tên điểm khác. Tên tối đa 40 ký tự. */
export function renamePlace(
  list: SavedPlace[],
  oldName: string,
  newName: string,
): { ok: boolean; list: SavedPlace[]; reason?: 'empty' | 'dup' | 'missing' } {
  const name = newName.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!name) return { ok: false, list, reason: 'empty' };
  const fo = foldName(oldName);
  const i = list.findIndex((x) => foldName(x.name) === fo);
  if (i < 0) return { ok: false, list, reason: 'missing' };
  const fn = foldName(name);
  if (list.some((x, j) => j !== i && foldName(x.name) === fn)) return { ok: false, list, reason: 'dup' };
  const out = [...list];
  out[i] = { ...out[i], name };
  return { ok: true, list: out };
}

/* ===== Chia sẻ điểm đã lưu (link mở app, người nhận bấm là lưu/đi được) ===== */
const r5 = (x: number) => Math.round(x * 1e5) / 1e5;

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Link mở app kèm một hoặc nhiều điểm: <base>?diem=<base64url của [[tên, vĩ độ, kinh độ], …]>. */
export function placesShareUrl(base: string, list: SavedPlace[]): string {
  const data = list.slice(0, 30).map((p) => [p.name.trim().slice(0, 40), r5(p.lat), r5(p.lng)]);
  return `${base}?diem=${b64urlEncode(JSON.stringify(data))}`;
}

export function placeShareText(base: string, p: SavedPlace): string {
  return `${p.name}\nBản đồ: https://www.google.com/maps?q=${r5(p.lat)},${r5(p.lng)}\nMở bằng Lái An Toàn: ${placesShareUrl(base, [p])}`;
}

/** Đọc điểm từ link chia sẻ; dữ liệu hỏng hoặc ngoài Việt Nam bị bỏ. */
export function parseSharedPlaces(search: string): SavedPlace[] {
  const v = new URLSearchParams(search).get('diem');
  if (!v || v.length > 8000) return [];
  try {
    const raw = JSON.parse(b64urlDecode(v));
    if (!Array.isArray(raw)) return [];
    const list = raw
      .filter((e): e is [string, number, number] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number' && typeof e[2] === 'number')
      .map(([name, lat, lng]) => ({ name: name.trim().slice(0, 40), lat: r5(lat), lng: r5(lng) }));
    return parsePlaces(list).slice(0, 30);
  } catch {
    return [];
  }
}
