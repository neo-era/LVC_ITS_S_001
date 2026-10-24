import { haversine } from '../core/geo';

export interface TripSample {
  t: number;
  lat: number;
  lng: number;
  kmh: number | null;
  limit: number | null;
  limitEstimated: boolean;
}

export interface TripSummary {
  startT: number;
  endT: number;
  distM: number;
  maxKmh: number;
  movingS: number;
  avgKmh: number;
  overCount: number;
  overSeconds: number;
  hardBrakes: number;
  score: number;
}

const MAX_JUMP_MS = 70; // m/s (~250 km/h): nhanh hơn là GPS nhảy
const HARD_BRAKE = 3.5; // m/s² (~0,36 g)
const BRAKE_GAP_MS = 3000;

/** Điểm lái an toàn 0–100: trừ 5 điểm mỗi lần vượt tốc độ (biển thật), 5 điểm mỗi lần phanh gấp, 1 điểm mỗi 10 giây chạy quá tốc độ. */
export function tripScore(s: { overCount: number; hardBrakes: number; overSeconds: number; distM: number }): number {
  const pen = s.overCount * 5 + s.hardBrakes * 5 + s.overSeconds / 10;
  return Math.max(0, Math.min(100, Math.round(100 - pen)));
}

export class TripRecorder {
  private last: { t: number; lat: number; lng: number; kmh: number | null };
  private distM = 0;
  private maxKmh = 0;
  private movingMs = 0;
  private overCount = 0;
  private overMs = 0;
  private inOver = false;
  private hardBrakes = 0;
  private lastBrakeT = -Infinity;

  constructor(
    private readonly startT: number,
    lat: number,
    lng: number,
  ) {
    this.last = { t: startT, lat, lng, kmh: null };
  }

  push(s: TripSample): void {
    const dt = s.t - this.last.t;
    if (dt <= 0 || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return;
    const d = haversine(this.last, s);
    if (d / (dt / 1000) > MAX_JUMP_MS) return; // bỏ điểm nhảy, giữ điểm cũ làm mốc
    this.distM += d;
    const kmh = s.kmh ?? 0;
    if (kmh > this.maxKmh) this.maxKmh = Math.round(kmh);
    if (kmh > 5) this.movingMs += dt;
    const over = !s.limitEstimated && s.limit !== null && Math.round(kmh) > s.limit;
    if (over) {
      if (!this.inOver) this.overCount++;
      this.overMs += dt;
    }
    this.inOver = over;
    if (this.last.kmh !== null && dt <= 2000) {
      const decel = (this.last.kmh - kmh) / 3.6 / (dt / 1000);
      if (decel >= HARD_BRAKE && s.t - this.lastBrakeT > BRAKE_GAP_MS) {
        this.hardBrakes++;
        this.lastBrakeT = s.t;
      }
    }
    this.last = { t: s.t, lat: s.lat, lng: s.lng, kmh };
  }

  summary(endT: number): TripSummary {
    const movingS = Math.round(this.movingMs / 1000);
    const base = { overCount: this.overCount, hardBrakes: this.hardBrakes, overSeconds: Math.round(this.overMs / 1000), distM: Math.round(this.distM) };
    return {
      startT: this.startT,
      endT,
      distM: base.distM,
      maxKmh: this.maxKmh,
      movingS,
      avgKmh: movingS > 0 ? Math.round((this.distM / movingS) * 3.6) : 0,
      overCount: base.overCount,
      overSeconds: base.overSeconds,
      hardBrakes: base.hardBrakes,
      score: tripScore(base),
    };
  }
}
