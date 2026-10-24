import { haversine } from './geo';

export interface GpsSample {
  /** Thời điểm mẫu, mili giây. */
  t: number;
  lat: number;
  lng: number;
  /** Tốc độ do GPS báo (m/s); null nếu thiết bị không cung cấp. */
  speed: number | null;
  /** Sai số vị trí (m). */
  accuracy: number;
}

export type GpsStatus = 'ok' | 'weak' | 'lost';

export interface SpeedReading {
  /** Tốc độ đã lọc (km/h); null nếu chưa có dữ liệu tin cậy. */
  kmh: number | null;
  status: GpsStatus;
}

const MAX_ACCURACY_M = 50;
const MAX_ACCEL = 12; // m/s², vượt mức này coi là gai nhiễu
const MAX_SPEED = 100; // m/s (360 km/h) — trên mức này là dữ liệu hỏng
const STATIONARY_KMH = 1.5;
const LOST_AFTER_MS = 5000;
const ALPHA = 0.6;

/** Lọc nhiễu tốc độ GPS: bỏ gai, làm mượt, suy ra tốc độ từ vị trí khi thiếu, phát hiện mất tín hiệu. */
export class SpeedFilter {
  private lastPos: { t: number; lat: number; lng: number } | null = null;
  private lastRaw: number | null = null;
  private smooth: number | null = null;
  private lastArrival: number | null = null;
  private weak = false;

  push(s: GpsSample): SpeedReading {
    if (![s.t, s.lat, s.lng, s.accuracy].every(Number.isFinite)) return this.current();
    if (this.lastArrival !== null && s.t <= this.lastArrival) return this.current();
    this.lastArrival = s.t;

    if (s.accuracy > MAX_ACCURACY_M) {
      this.weak = true;
      return this.current();
    }
    this.weak = false;

    const dt = this.lastPos ? (s.t - this.lastPos.t) / 1000 : 0;
    let v: number | null = null;
    if (s.speed !== null && Number.isFinite(s.speed) && s.speed >= 0) {
      v = s.speed;
    } else if (this.lastPos && dt > 0) {
      v = haversine(this.lastPos, s) / dt;
    }

    if (v === null) {
      this.lastPos = { t: s.t, lat: s.lat, lng: s.lng };
      return this.current();
    }
    if (v > MAX_SPEED) return this.current();
    if (this.lastRaw !== null && dt > 0 && Math.abs(v - this.lastRaw) / dt > MAX_ACCEL) {
      return this.current();
    }

    this.lastPos = { t: s.t, lat: s.lat, lng: s.lng };
    this.lastRaw = v;
    this.smooth = this.smooth === null ? v : this.smooth + ALPHA * (v - this.smooth);
    return this.current();
  }

  /** Trạng thái tại thời điểm `now` — dùng để phát hiện mất tín hiệu khi không còn mẫu mới. */
  statusAt(now: number): SpeedReading {
    if (this.lastArrival === null || now - this.lastArrival > LOST_AFTER_MS) {
      return { kmh: null, status: 'lost' };
    }
    return this.current();
  }

  private current(): SpeedReading {
    const status: GpsStatus = this.weak ? 'weak' : 'ok';
    if (this.smooth === null) return { kmh: null, status };
    const kmh = this.smooth * 3.6;
    return { kmh: kmh < STATIONARY_KMH ? 0 : kmh, status };
  }
}
