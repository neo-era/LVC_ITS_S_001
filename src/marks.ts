import type { AlertPoint, AlertType } from './core/alerts';
import { angleDiff, haversine } from './core/geo';

export interface Mark {
  id: string;
  type: AlertType;
  lat: number;
  lng: number;
  /** Hướng xe lúc đánh dấu (độ); bỏ trống nếu không rõ. */
  dir?: number;
  t: number;
  synced?: boolean;
}

const DUP_M = 30;
const DUP_ANGLE = 60;
const MAX_MARKS = 500;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function createMark(
  pos: { lat: number; lng: number },
  heading: number | null,
  type: AlertType,
  now: number,
  rand: () => number = Math.random,
): Mark {
  const m: Mark = {
    id: `m${now.toString(36)}${rand().toString(36).slice(2, 6)}`,
    type,
    lat: pos.lat,
    lng: pos.lng,
    t: now,
  };
  if (heading !== null && Number.isFinite(heading)) m.dir = Math.round(((heading % 360) + 360) % 360) % 360;
  return m;
}

export function isDuplicate(list: Mark[], c: Mark): boolean {
  return list.some(
    (m) =>
      m.type === c.type &&
      haversine(m, c) < DUP_M &&
      (m.dir === undefined || c.dir === undefined || angleDiff(m.dir, c.dir) < DUP_ANGLE),
  );
}

/** Thêm dấu (bỏ nếu trùng). Quá 500 dấu thì bỏ dấu cũ nhất đã đồng bộ, rồi cũ nhất nói chung. */
export function addMark(list: Mark[], m: Mark): { marks: Mark[]; added: boolean } {
  if (isDuplicate(list, m)) return { marks: list, added: false };
  const out = [...list, m];
  while (out.length > MAX_MARKS) {
    const i = out.findIndex((x) => x.synced);
    out.splice(i >= 0 ? i : 0, 1);
  }
  return { marks: out, added: true };
}

export function removeMark(list: Mark[], id: string): Mark[] {
  return list.some((m) => m.id === id) ? list.filter((m) => m.id !== id) : list;
}

export function markToAlert(m: Mark): AlertPoint {
  const a: AlertPoint = { id: m.id, type: m.type, lat: m.lat, lng: m.lng };
  if (m.dir !== undefined) a.dir = m.dir;
  return a;
}

export function parseMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) return [];
  const out: Mark[] = [];
  for (const r of raw as unknown[]) {
    if (!isObj(r) || typeof r.id !== 'string' || !r.id) continue;
    if (r.type !== 'camera' && r.type !== 'blackspot') continue;
    if (!num(r.lat) || !num(r.lng) || r.lat < 8 || r.lat > 24 || r.lng < 102 || r.lng > 110) continue;
    const m: Mark = { id: r.id, type: r.type, lat: r.lat, lng: r.lng, t: num(r.t) ? r.t : 0 };
    if (num(r.dir) && r.dir >= 0 && r.dir <= 360) m.dir = r.dir;
    if (r.synced === true) m.synced = true;
    out.push(m);
  }
  return out;
}

/** Dữ liệu đã duyệt từ Google Sheet ({marks:[…]}) → điểm cảnh báo; id có tiền tố "s" để không đụng id dấu trên máy. */
export function parseRemoteMarks(raw: unknown): AlertPoint[] {
  if (!isObj(raw)) return [];
  return parseMarks(raw.marks).map((m) => ({ ...markToAlert(m), id: `s${m.id}` }));
}
