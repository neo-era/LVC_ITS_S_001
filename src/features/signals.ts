import { angleDiff, bearing } from '../core/geo';

/**
 * Đèn tín hiệu chạy theo kế hoạch pha cố định (thường gặp ở VN). Dữ liệu do đơn vị quản lý nút giao cung cấp
 * (public/rules/signals.json). Giờ tính theo giờ Việt Nam; offsetS = giây kể từ 00:00 khi chu kỳ bắt đầu.
 */
export interface Approach {
  heading: number;
  greenStart: number;
  greenEnd: number;
  yellowS: number;
}
export interface SignalPlan {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cycleS: number;
  offsetS: number;
  approaches: Approach[];
}
export interface Phase {
  color: 'green' | 'yellow' | 'red';
  remainS: number;
}

export function parseSignals(raw: unknown): SignalPlan[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is SignalPlan =>
      !!p &&
      typeof p.id === 'string' &&
      typeof p.lat === 'number' &&
      typeof p.lng === 'number' &&
      typeof p.cycleS === 'number' &&
      p.cycleS > 0 &&
      typeof p.offsetS === 'number' &&
      Array.isArray(p.approaches) &&
      p.approaches.length > 0 &&
      p.approaches.every((a: unknown) => okApproach(a, p.cycleS)),
  );
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function okApproach(a: unknown, cycleS: number): boolean {
  if (!a || typeof a !== 'object') return false;
  const x = a as Record<string, unknown>;
  if (!num(x.heading) || !num(x.greenStart) || !num(x.greenEnd) || !num(x.yellowS)) return false;
  return x.greenStart >= 0 && x.greenEnd > x.greenStart && x.yellowS >= 0 && x.greenEnd + x.yellowS <= cycleS;
}

/** Nút giao nằm PHÍA TRƯỚC xe (±60° quanh hướng đi). Đã đi qua thì nút ở sau lưng → không báo. */
export function signalAhead(pos: { lat: number; lng: number }, plan: { lat: number; lng: number }, heading: number | null): boolean {
  if (heading === null) return false;
  return angleDiff(heading, bearing(pos, plan)) <= 60;
}

export function phaseAt(plan: SignalPlan, approach: number, t: number): Phase {
  const a = plan.approaches[approach];
  const local = (t / 1000 + 7 * 3600) % 86400;
  const pos = (((local - plan.offsetS) % plan.cycleS) + plan.cycleS) % plan.cycleS;
  if (pos >= a.greenStart && pos < a.greenEnd) return { color: 'green', remainS: Math.round(a.greenEnd - pos) };
  if (pos >= a.greenEnd && pos < a.greenEnd + a.yellowS) return { color: 'yellow', remainS: Math.round(a.greenEnd + a.yellowS - pos) };
  return { color: 'red', remainS: Math.round((a.greenStart - pos + plan.cycleS) % plan.cycleS) };
}

export function pickApproach(plan: SignalPlan, heading: number | null): number {
  if (heading === null) return -1;
  return plan.approaches.findIndex((a) => angleDiff(heading, a.heading) <= 45);
}

/**
 * Khoảng tốc độ để tới nút khi đèn xanh (GLOSA). Thận trọng:
 * - không có giới hạn tốc độ → không khuyên;
 * - pha xanh: trừ biên an toàn marginS (lệch đồng hồ, tủ trễ pha), cần còn ≥ 5 s sau khi trừ,
 *   và KHÔNG BAO GIỜ khuyên chạy nhanh hơn tốc độ hiện tại (+2 km/h);
 * - pha đỏ: chỉ khuyên chạy chậm lại.
 */
export function glosa(distM: number, ph: Phase, limit: number | null, curKmh: number, marginS = 3): { minKmh: number; maxKmh: number } | null {
  if (limit === null || ph.remainS <= 0) return null;
  if (ph.color === 'green') {
    const usable = ph.remainS - marginS;
    if (usable < 5) return null;
    const min = Math.ceil((distM / usable) * 3.6);
    if (min > limit || min > curKmh + 2) return null;
    return { minKmh: min, maxKmh: limit };
  }
  if (ph.color === 'red') {
    const max = Math.min(limit, Math.floor((distM / ph.remainS) * 3.6));
    return max >= 5 ? { minKmh: 0, maxKmh: max } : null;
  }
  return null;
}
