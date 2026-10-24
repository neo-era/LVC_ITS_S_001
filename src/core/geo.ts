export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_R = 6_371_000;
const M_PER_DEG = (EARTH_R * Math.PI) / 180;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Khoảng cách mặt cầu giữa hai điểm, đơn vị mét. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Góc phương vị từ a đến b, 0–360° (0 = bắc, 90 = đông). */
export function bearing(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Chênh lệch góc theo cung ngắn, 0–180°. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Khoảng cách (m) từ điểm p tới đoạn thẳng a–b (xấp xỉ phẳng cục bộ, đủ chính xác trong vài km). */
export function distToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos(toRad(p.lat));
  const ax = (a.lng - p.lng) * k * M_PER_DEG;
  const ay = (a.lat - p.lat) * M_PER_DEG;
  const bx = (b.lng - p.lng) * k * M_PER_DEG;
  const by = (b.lat - p.lat) * M_PER_DEG;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const CELL_DEG = 0.01; // ~1,1 km
const EPS = 1e-9;
const cellIndex = (v: number) => Math.floor(v / CELL_DEG + EPS);

/** Khoá ô lưới ~1 km chứa điểm (lat, lng). Dạng "<hàng>_<cột>". */
export function cellKey(lat: number, lng: number): string {
  return `${cellIndex(lat)}_${cellIndex(lng)}`;
}

/** Danh sách khoá ô lưới phủ hình vuông bán kính radiusM quanh điểm (không trùng lặp). */
export function cellsAround(lat: number, lng: number, radiusM: number): string[] {
  const dLat = radiusM / M_PER_DEG;
  const dLng = radiusM / (M_PER_DEG * Math.max(0.01, Math.cos(toRad(lat))));
  const y0 = cellIndex(lat - dLat);
  const y1 = cellIndex(lat + dLat);
  const x0 = cellIndex(lng - dLng);
  const x1 = cellIndex(lng + dLng);
  const keys: string[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) keys.push(`${y}_${x}`);
  return keys;
}
