/** Nhắc nghỉ khi lái lâu. Luật TTATGT đường bộ 2024 (Điều 64) áp cho xe kinh doanh vận tải/vận tải nội bộ:
 * lái liên tục ≤ 4 giờ, ≤ 10 giờ/ngày; nghỉ ≥ 15 phút (TT 05/2024/TT-BGTVT). Xe cá nhân: chỉ là khuyến nghị. */
export const REST_STOP_MS = 15 * 60_000;
const MOVING_KMH = 5;
const GAP_MS = 5 * 60_000; // không có mẫu quá lâu (tắt app) → không cộng giờ lái
const REPEAT_MS = 15 * 60_000;
export const DAY_LIMIT_MS = 10 * 3_600_000;

const dayOf = (t: number) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

const MOVING_CONFIRM_MS = 30_000; // chạy liên tục 30 giây mới coi là đã đi tiếp (lọc nhiễu GPS khi đỗ)

export interface RestSnapshot {
  drivingMs: number;
  dayMs: number;
  lastT: number | null;
  stoppedMs: number;
  nextRemindMs: number | null;
  dayWarned: boolean;
  day: string;
}

export class RestTracker {
  drivingMs = 0;
  dayMs = 0;
  private lastT: number | null = null;
  private stoppedMs = 0;
  private movingMs = 0;
  private nextRemindMs: number | null = null;
  private dayWarned = false;
  private day = '';

  /** thresholdMin: số phút lái liên tục thì nhắc (0 = tắt). */
  constructor(private thresholdMin: number) {}

  snapshot(): RestSnapshot {
    return { drivingMs: this.drivingMs, dayMs: this.dayMs, lastT: this.lastT, stoppedMs: this.stoppedMs, nextRemindMs: this.nextRemindMs, dayWarned: this.dayWarned, day: this.day };
  }

  static restore(thresholdMin: number, s: Partial<RestSnapshot> | null | undefined): RestTracker {
    const r = new RestTracker(thresholdMin);
    if (!s || typeof s !== 'object') return r;
    r.drivingMs = Number(s.drivingMs) || 0;
    r.dayMs = Number(s.dayMs) || 0;
    r.lastT = typeof s.lastT === 'number' ? s.lastT : null;
    r.stoppedMs = Number(s.stoppedMs) || 0;
    r.nextRemindMs = typeof s.nextRemindMs === 'number' ? s.nextRemindMs : null;
    r.dayWarned = !!s.dayWarned;
    r.day = typeof s.day === 'string' ? s.day : '';
    return r;
  }

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
      this.movingMs += dt;
      if (this.movingMs >= MOVING_CONFIRM_MS) this.stoppedMs = 0; // đi tiếp thật sự mới huỷ thời gian đã nghỉ
    } else {
      this.movingMs = 0;
      this.stoppedMs += dt;
      if (this.stoppedMs >= REST_STOP_MS) this.reset();
    }
    if (this.thresholdMin > 0 && !this.dayWarned && this.dayMs >= DAY_LIMIT_MS) {
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
