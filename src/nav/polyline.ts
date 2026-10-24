import type { LatLng } from '../core/geo';

/** Giải mã polyline (Google/Valhalla). Chuỗi cụt: trả những điểm đọc được, không ném lỗi. */
export function decodePolyline(str: string, precision: 5 | 6): LatLng[] {
  const f = 10 ** precision;
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (i >= str.length) return null;
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < str.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    out.push({ lat: lat / f, lng: lng / f });
  }
  return out;
}

export function encodePolyline(pts: LatLng[], precision: 5 | 6): string {
  const f = 10 ** precision;
  let pLat = 0;
  let pLng = 0;
  let s = '';
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      s += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    s += String.fromCharCode(n + 63);
  };
  for (const p of pts) {
    const la = Math.round(p.lat * f);
    const ln = Math.round(p.lng * f);
    enc(la - pLat);
    enc(ln - pLng);
    pLat = la;
    pLng = ln;
  }
  return s;
}
