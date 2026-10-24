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
function parseAlerts(raw: unknown): AlertPoint[] {
  const alerts: AlertPoint[] = [];
  if (Array.isArray(raw)) {
    for (const p of raw as unknown[]) {
      if (!isObj(p) || !nonEmpty(p.id)) continue;
      if (p.type !== 'camera' && p.type !== 'blackspot') continue;
      if (!okLat(p.lat) || !okLng(p.lng)) continue;
      const item: AlertPoint = { id: p.id, type: p.type as AlertType, lat: p.lat, lng: p.lng };
      if (num(p.dir) && p.dir >= 0 && p.dir <= 360) item.dir = p.dir;
      alerts.push(item);
    }
  }
  return alerts;
}

const validLimit = (x: unknown): x is number => num(x) && x >= 5 && x <= 150;

/**
 * Giới hạn ước tính theo luật cho ô tô con khi OSM chưa có số
 * (Thông tư 38/2024/TT-BGTVT, sửa đổi bởi 09/2025/TT-BXD — VBHN 74/2026/VBHN-BXD):
 * trong khu đông dân cư 60 (đường đôi) / 50; ngoài khu đông dân cư 90 / 80.
 * Cao tốc không ước tính; đường nhỏ ngoài khu dân cư không ước tính.
 */
export function estimateLimit(flags: number, urban: boolean): number | null {
  if (flags & 4) return null;
  const divided = (flags & 2) !== 0;
  if (urban) return divided ? 60 : 50;
  if (flags & 8) return null;
  return divided ? 90 : 80;
}

/** Định dạng v2 (gọn): mỗi mục là một dãy đoạn liên tiếp của một way, toạ độ ×1e5 dạng hiệu số. */
function parseV2(raw: Record<string, unknown>): CellData {
  const segments: RoadSegment[] = [];
  const urban = raw.u === 1;
  if (Array.isArray(raw.w)) {
    for (const e of raw.w as unknown[]) {
      if (!Array.isArray(e) || e.length < 8 || e.length % 2 !== 0) continue;
      if (!e.every((x) => Number.isInteger(x))) continue;
      const [wayId, start, ms, flags] = e as number[];
      const pts: { lat: number; lng: number }[] = [];
      let la = 0;
      let ln = 0;
      let ok = true;
      for (let i = 4; i < e.length; i += 2) {
        la = i === 4 ? (e[i] as number) : la + (e[i] as number);
        ln = i === 4 ? (e[i + 1] as number) : ln + (e[i + 1] as number);
        const p = { lat: la / 1e5, lng: ln / 1e5 };
        if (!okLat(p.lat) || !okLng(p.lng)) {
          ok = false;
          break;
        }
        pts.push(p);
      }
      if (!ok) continue;
      const maxspeed = validLimit(ms) ? ms : null;
      const est = estimateLimit(flags, urban);
      for (let i = 0; i + 1 < pts.length; i++) {
        const seg: RoadSegment = { id: `w${wayId}_${start + i}`, a: pts[i], b: pts[i + 1], maxspeed };
        if (flags & 1) seg.cam = true;
        if (est !== null) seg.est = est;
        segments.push(seg);
      }
    }
  }
  return { segments, alerts: parseAlerts(raw.alerts) };
}

export function parseCell(raw: unknown): CellData | null {
  if (isObj(raw) && raw.v === 2) return parseV2(raw);
  if (!isObj(raw) || raw.v !== 1) return null;

  const segments: RoadSegment[] = [];
  if (Array.isArray(raw.segments)) {
    for (const s of raw.segments as unknown[]) {
      if (!isObj(s) || !nonEmpty(s.id)) continue;
      const a = point(s.a);
      const b = point(s.b);
      if (!a || !b) continue;
      const seg: RoadSegment = { id: s.id, a, b, maxspeed: num(s.maxspeed) ? s.maxspeed : null };
      if (s.cam === 1) seg.cam = true;
      segments.push(seg);
    }
  }

  return { segments, alerts: parseAlerts(raw.alerts) };
}
