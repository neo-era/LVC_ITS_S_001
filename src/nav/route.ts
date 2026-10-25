import { COSTING, type Vehicle } from '../core/vehicle';
import type { LatLng } from '../core/geo';
import { decodePolyline } from './polyline';

export interface Maneuver {
  /** Câu hiển thị. */
  text: string;
  /** Câu đọc (ưu tiên câu "trước khi rẽ" của máy chủ). */
  spoken: string;
  /** Chỉ số điểm trên tuyến nơi bước này bắt đầu. */
  startIdx: number;
  /** Độ dài đoạn của bước này (m). */
  lenM: number;
  type: number;
}

export interface Route {
  points: LatLng[];
  maneuvers: Maneuver[];
  distM: number;
  durS: number;
}

/** Máy chủ tìm đường công cộng (FOSSGIS Valhalla). Có thể đổi sang nhà cung cấp khác — điều khoản dùng cần xem lại khi đưa ra rộng rãi. */
export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/route';

export function buildRouteBody(from: LatLng, to: LatLng, vehicle: Vehicle = 'car', alternates = 0): string {
  return JSON.stringify({
    ...(alternates > 0 ? { alternates } : {}),
    locations: [
      { lat: from.lat, lon: from.lng, type: 'break' },
      { lat: to.lat, lon: to.lng, type: 'break' },
    ],
    costing: COSTING[vehicle],
    directions_options: { language: 'vi-VN', units: 'kilometers' },
  });
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function parseValhalla(raw: unknown): Route | null {
  if (!isObj(raw) || !isObj(raw.trip) || !Array.isArray(raw.trip.legs)) return null;
  const leg = raw.trip.legs[0];
  if (!isObj(leg) || typeof leg.shape !== 'string' || !Array.isArray(leg.maneuvers)) return null;
  const points = decodePolyline(leg.shape, 6);
  if (points.length < 2) return null;

  const maneuvers: Maneuver[] = [];
  for (const m of leg.maneuvers as unknown[]) {
    if (!isObj(m) || typeof m.instruction !== 'string' || !num(m.begin_shape_index)) continue;
    if (m.begin_shape_index < 0 || m.begin_shape_index >= points.length) continue;
    maneuvers.push({
      text: m.instruction,
      spoken: typeof m.verbal_pre_transition_instruction === 'string' ? m.verbal_pre_transition_instruction : m.instruction,
      startIdx: m.begin_shape_index,
      lenM: num(m.length) ? Math.round(m.length * 1000) : 0,
      type: num(m.type) ? m.type : 0,
    });
  }
  if (maneuvers.length === 0) return null;

  const summary = isObj(raw.trip.summary) ? raw.trip.summary : {};
  const distM = num(summary.length) ? Math.round(summary.length * 1000) : maneuvers.reduce((a, m) => a + m.lenM, 0);
  const durS = num(summary.time) ? Math.round(summary.time) : 0;
  return { points, maneuvers, distM, durS };
}

/** Gọi bằng GET (tham số json) để tránh yêu cầu tiền kiểm CORS. */
export async function fetchRoute(from: LatLng, to: LatLng, vehicle: Vehicle = 'car', signal?: AbortSignal): Promise<Route> {
  const url = `${VALHALLA_URL}?json=${encodeURIComponent(buildRouteBody(from, to, vehicle))}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Máy chủ tìm đường trả lỗi ${res.status}`);
  const route = parseValhalla(await res.json());
  if (!route) throw new Error('Không tìm được đường đi tới nơi này.');
  return route;
}

/** Tuyến chính + các tuyến thay thế (Valhalla "alternates"); tuyến hỏng bị bỏ. */
export function parseValhallaAll(raw: unknown): Route[] {
  const out: Route[] = [];
  const main = parseValhalla(raw);
  if (main) out.push(main);
  if (isObj(raw) && Array.isArray(raw.alternates)) {
    for (const a of raw.alternates as unknown[]) {
      const r = parseValhalla(a);
      if (r) out.push(r);
    }
  }
  return out;
}

const km = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const min = (s: number) => `${Math.max(1, Math.round(s / 60))} phút`;

/** Nhãn ngắn để chọn tuyến: so với tuyến nhanh nhất. */
export function routeLabel(r: Route, fastest: Route): string {
  if (r === fastest) return `Nhanh nhất · ${km(r.distM)} · ${min(r.durS)}`;
  const d = Math.round((r.durS - fastest.durS) / 60);
  return `${km(r.distM)} · ${min(r.durS)}${d > 0 ? ` (+${d} phút)` : ''}`;
}

/** Lấy tối đa 1 + alternates tuyến; xếp nhanh nhất lên đầu. */
export async function fetchRoutes(from: LatLng, to: LatLng, vehicle: Vehicle = 'car', alternates = 2, signal?: AbortSignal): Promise<Route[]> {
  const url = `${VALHALLA_URL}?json=${encodeURIComponent(buildRouteBody(from, to, vehicle, alternates))}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Máy chủ tìm đường trả lỗi ${res.status}`);
  const all = parseValhallaAll(await res.json());
  if (!all.length) throw new Error('Không tìm được đường đi tới nơi này.');
  return all.sort((a, b) => a.durS - b.durS);
}
