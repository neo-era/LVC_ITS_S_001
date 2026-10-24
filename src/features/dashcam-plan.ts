import { detectImpact, type AccelSample } from '../core/dashcam';

export interface ClipMeta {
  id: string;
  bytes: number;
  startedAt: number;
  endedAt?: number;
  locked: boolean;
  auto?: boolean;
  mime?: string;
}

/** Các đoạn video giao với cửa sổ thời gian (vd ±15 giây quanh va chạm). */
export function clipsToLock(clips: ClipMeta[], w: { from: number; to: number }): string[] {
  return clips.filter((c) => c.startedAt <= w.to && (c.endedAt ?? Infinity) >= w.from).map((c) => c.id);
}

/** Va chạm thật: ≥ 3 mẫu vượt ngưỡng trong 500 ms (ổ gà, điện thoại rơi giá đỡ chỉ cho 1–2 mẫu). Sau khi báo, nghỉ 10 giây. */
export class ImpactDetector {
  private hits: number[] = [];
  private lastFire = -Infinity;
  constructor(private readonly thresholdG = 2.5) {}
  push(s: AccelSample, t: number): boolean {
    if (!detectImpact(s, this.thresholdG)) return false;
    this.hits = this.hits.filter((h) => t - h <= 500);
    this.hits.push(t);
    if (this.hits.length >= 3 && t - this.lastFire > 10_000) {
      this.lastFire = t;
      this.hits = [];
      return true;
    }
    return false;
  }
}
