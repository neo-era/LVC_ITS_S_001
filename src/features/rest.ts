/** Nhắc nghỉ khi lái lâu. Luật TTATGT đường bộ 2024 (Điều 64) áp cho xe kinh doanh vận tải/vận tải nội bộ:
 * lái liên tục ≤ 4 giờ, ≤ 10 giờ/ngày; nghỉ ≥ 15 phút (TT 05/2024/TT-BGTVT). Xe cá nhân: chỉ là khuyến nghị. */
export const REST_STOP_MS = 15 * 60_000;
const MOVING_KMH = 5;
const GAP_MS = 5 * 60_000; // không có mẫu quá lâu (tắt app) → không cộng giờ lái
const REPEAT_MS = 15 * 60_000;
export const DAY_LIMIT_MS = 10 * 3_600_000;

const dayOf = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

export class RestTracker {
  drivingMs = 0;
  dayMs = 0;
  private lastT: number | null = null;
  private stoppedMs = 0;
  private nextRemindMs: number | null = null;
  private dayWarned = false;
  private day = '';

  /** thresholdMin: số phút lái liên tục thì nhắc (0 = tắt). */
  constructor(private thresholdMin: number) {}

  setThreshold(min: number): void {
    this.thresholdMin = min;
    this.nextRemindMs = null;
  }

  push(t: number, kmh: number | null): 'remind' | 'day_limit' | null {
    const d = dayOf(t);
    if (d !== this.day) {
      this.day = d;
      this.dayMs = 0;
      this.dayWarned = false;
    }
    if (this.lastT === null) {
      this.lastT = t;
      return null;
    }
    const dt = t - this.lastT;
    this.lastT = t;
    if (dt <= 0) return null;
    if (dt > GAP_MS) {
      this.stoppedMs += dt;
      if (this.stoppedMs >= REST_STOP_MS) this.reset();
      return null;
    }
    if (kmh !== null && kmh > MOVING_KMH) {
      this.drivingMs += dt;
      this.dayMs += dt;
      this.stoppedMs = 0;
    } else {
      this.stoppedMs += dt;
      if (this.stoppedMs >= REST_STOP_MS) this.reset();
    }
    if (!this.dayWarned && this.dayMs >= DAY_LIMIT_MS) {
      this.dayWarned = true;
      return 'day_limit';
    }
    if (this.thresholdMin > 0) {
      const next = this.nextRemindMs ?? this.thresholdMin * 60_000;
      if (this.drivingMs >= next) {
        this.nextRemindMs = next + REPEAT_MS;
        return 'remind';
      }
    }
    return null;
  }

  private reset(): void {
    this.drivingMs = 0;
    this.nextRemindMs = null;
  }
}
