import type { AlertPoint, AlertType } from './alerts';
import type { RoadSegment } from './speedlimit';

export interface CellData {
  segments: RoadSegment[];
  alerts: AlertPoint[];
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const okLat = (x: unknown): x is number => num(x) && x >= 8 && x <= 24;
const okLng = (x: unknown): x is number => num(x) && x >= 102 && x <= 110;
const nonEmpty = (x: unknown): x is string => typeof x === 'string' && x.length > 0;

function point(x: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(x) || x.length !== 2) return null;
  const [lat, lng] = x as unknown[];
  return okLat(lat) && okLng(lng) ? { lat, lng } : null;
}

/**
 * Đọc tệp ô lưới (định dạng v1). Trả null nếu tệp không dùng được;
 * từng mục hỏng bị bỏ qua, mục tốt vẫn giữ — một dòng lỗi không làm mất cả ô.
 */
export function parseCell(raw: unknown): CellData | null {
  if (!isObj(raw) || raw.v !== 1) return null;

  const segments: RoadSegment[] = [];
  if (Array.isArray(raw.segments)) {
    for (const s of raw.segments as unknown[]) {
      if (!isObj(s) || !nonEmpty(s.id)) continue;
      const a = point(s.a);
      const b = point(s.b);
      if (!a || !b) continue;
      segments.push({ id: s.id, a, b, maxspeed: num(s.maxspeed) ? s.maxspeed : null });
    }
  }

  const alerts: AlertPoint[] = [];
  if (Array.isArray(raw.alerts)) {
    for (const p of raw.alerts as unknown[]) {
      if (!isObj(p) || !nonEmpty(p.id)) continue;
      if (p.type !== 'camera' && p.type !== 'blackspot') continue;
      if (!okLat(p.lat) || !okLng(p.lng)) continue;
      const item: AlertPoint = { id: p.id, type: p.type as AlertType, lat: p.lat, lng: p.lng };
      if (num(p.dir) && p.dir >= 0 && p.dir <= 360) item.dir = p.dir;
      alerts.push(item);
    }
  }
  return { segments, alerts };
}
