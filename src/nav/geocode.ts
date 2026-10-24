export interface Place {
  name: string;
  detail: string;
  lat: number;
  lng: number;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown): string => (typeof x === 'string' ? x.trim() : '');

export const PHOTON_URL = 'https://photon.komoot.io/api/';

/** Photon (OpenStreetMap) → danh sách địa điểm gọn. Mục thiếu toạ độ bị bỏ. */
export function parsePhoton(raw: unknown): Place[] {
  if (!isObj(raw) || !Array.isArray(raw.features)) return [];
  const out: Place[] = [];
  for (const f of raw.features as unknown[]) {
    if (!isObj(f) || !isObj(f.geometry) || !Array.isArray(f.geometry.coordinates)) continue;
    const [lng, lat] = f.geometry.coordinates as unknown[];
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const p = isObj(f.properties) ? f.properties : {};
    const street = str(p.street);
    const house = str(p.housenumber);
    let name = str(p.name);
    const parts: string[] = [];
    if (!name) {
      name = [house, street].filter(Boolean).join(' ');
    } else if (street && street !== name) {
      parts.push(street);
    }
    if (!name) continue;
    for (const k of ['district', 'locality', 'county'] as const) {
      const v = str(p[k]);
      if (v && v !== name && !parts.includes(v)) {
        parts.push(v);
        break;
      }
    }
    const city = str(p.city) || str(p.state);
    if (city && city !== name && !parts.includes(city)) parts.push(city);
    out.push({ name, detail: parts.join(', '), lat, lng });
  }
  return out;
}

export async function searchPlaces(q: string, near: { lat: number; lng: number } | null, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL(PHOTON_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '6');
  url.searchParams.set('lang', 'default');
  url.searchParams.set('bbox', '102,8,110,24'); // chỉ trong lãnh thổ Việt Nam
  if (near) {
    url.searchParams.set('lat', String(near.lat));
    url.searchParams.set('lon', String(near.lng));
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Máy chủ tìm địa điểm trả lỗi ${res.status}`);
  return parsePhoton(await res.json());
}
