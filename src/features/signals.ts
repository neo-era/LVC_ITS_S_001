import { angleDiff } from '../core/geo';

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
      p.approaches.length > 0,
  );
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

/** Khoảng tốc độ để tới nút khi đèn xanh (GLOSA). null = không qua được trong lần xanh này với tốc độ hợp lệ. */
export function glosa(distM: number, ph: Phase, limit: number): { minKmh: number; maxKmh: number } | null {
  if (ph.remainS <= 0) return null;
  const v = (distM / ph.remainS) * 3.6;
  if (ph.color === 'green') {
    const min = Math.ceil(v);
    return min <= limit ? { minKmh: min, maxKmh: limit } : null;
  }
  if (ph.color === 'red') {
    const max = Math.min(limit, Math.floor(v));
    return max >= 5 ? { minKmh: 0, maxKmh: max } : null;
  }
  return null;
}
