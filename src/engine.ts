import type { Vehicle } from './core/vehicle';
import { AlertDeduper, findAlerts, type AlertHit, type AlertPoint } from './core/alerts';
import type { CellData } from './core/cells';
import { alertVoiceText, overspeedVoiceText, speedState, type SpeedState } from './core/format';
import { bearing, cellKey, cellsAround, haversine, type LatLng } from './core/geo';
import { SpeedFilter, type GpsSample, type GpsStatus } from './core/gps';
import { findLimit, matchSegment, type RoadSegment } from './core/speedlimit';

export interface ViewState {
  status: GpsStatus | 'idle';
  kmh: number | null;
  limit: number | null;
  /** Giới hạn đang hiện là ước tính theo luật (không phải biển thật). */
  limitEstimated: boolean;
  state: SpeedState;
  /** Cảnh báo gần nhất phía trước; null nếu không có. */
  alert: AlertHit | null;
  /** Các cảnh báo kế tiếp (không gồm cảnh báo gần nhất). */
  upcoming: AlertHit[];
  /** Đang chạy trên tuyến đường được báo chí nêu có camera phạt nguội. */
  camRoute: boolean;
}

export interface EngineOptions {
  radiusM: number;
  speak: (text: string) => void;
  vehicle?: Vehicle;
}

const OVERSPEED_REPEAT_MS = 20_000;
const MIN_MOVE_M = 5;

const idleView = (): ViewState => ({
  status: 'idle',
  kmh: null,
  limit: null,
  limitEstimated: false,
  state: 'unknown',
  alert: null,
  upcoming: [],
  camRoute: false,
});

/** Gom GPS → tốc độ lọc → giới hạn → cảnh báo → lời đọc. Không phụ thuộc DOM nên kiểm thử được. */
export class Engine {
  private readonly filter = new SpeedFilter();
  private deduper: AlertDeduper;
  private radiusM: number;
  private vehicle: Vehicle;
  private readonly speak: (text: string) => void;
  private readonly cells = new Map<string, CellData>();
  private heading: number | null = null;
  private lastPos: LatLng | null = null;
  private prevState: SpeedState = 'unknown';
  private lastOverAt = Number.NEGATIVE_INFINITY;
  private v: ViewState = idleView();

  constructor(opts: EngineOptions) {
    this.radiusM = opts.radiusM;
    this.vehicle = opts.vehicle ?? 'car';
    this.speak = opts.speak;
    this.deduper = new AlertDeduper(opts.radiusM);
  }

  setVehicle(v: Vehicle): void {
    this.vehicle = v;
  }

  setRadius(m: number): void {
    this.radiusM = m;
    this.deduper = new AlertDeduper(m);
  }

  hasCell(key: string): boolean {
    return this.cells.has(key);
  }

  /** Nạp dữ liệu của một ô lưới đã tải về. */
  loadCell(key: string, data: CellData): void {
    this.cells.set(key, data);
  }

  /** Nạp dữ liệu rời: tự xếp từng mục vào ô lưới chứa nó (đoạn đường vào cả hai ô đầu mút). */
  loadData(data: CellData): void {
    const add = (key: string, part: Partial<CellData>) => {
      const cur = this.cells.get(key) ?? { segments: [], alerts: [] };
      cur.segments.push(...(part.segments ?? []));
      cur.alerts.push(...(part.alerts ?? []));
      this.cells.set(key, cur);
    };
    for (const s of data.segments) {
      const ka = cellKey(s.a.lat, s.a.lng);
      const kb = cellKey(s.b.lat, s.b.lng);
      add(ka, { segments: [s] });
      if (kb !== ka) add(kb, { segments: [s] });
    }
    for (const a of data.alerts) add(cellKey(a.lat, a.lng), { alerts: [a] });
  }

  /** Thêm một điểm cảnh báo vào ô của nó; trùng id thì thay thế (dùng cho dấu người dùng tự đánh dấu). */
  addAlert(a: AlertPoint): void {
    const key = cellKey(a.lat, a.lng);
    const cur = this.cells.get(key) ?? { segments: [], alerts: [] };
    cur.alerts = [...cur.alerts.filter((x) => x.id !== a.id), a];
    this.cells.set(key, cur);
  }

  removeAlert(a: { id: string; lat: number; lng: number }): void {
    const key = cellKey(a.lat, a.lng);
    const cur = this.cells.get(key);
    if (cur) cur.alerts = cur.alerts.filter((x) => x.id !== a.id);
  }

  /** Hướng đi hiện tại (độ) nếu đã xác định. */
  currentHeading(): number | null {
    return this.heading;
  }

  /** Các điểm cảnh báo đã nạp trong bán kính (m) quanh vị trí — để vẽ trên bản đồ. */
  alertsNear(pos: LatLng, radiusM: number): AlertPoint[] {
    const out = new Map<string, AlertPoint>();
    for (const key of cellsAround(pos.lat, pos.lng, radiusM)) {
      for (const a of this.cells.get(key)?.alerts ?? []) if (haversine(pos, a) <= radiusM) out.set(a.id, a);
    }
    return [...out.values()];
  }

  view(): ViewState {
    return this.v;
  }

  push(s: GpsSample, apiHeading: number | null = null): ViewState {
    const r = this.filter.push(s);
    if (!Number.isFinite(s.lat) || !Number.isFinite(s.lng)) return this.v;
    const pos = { lat: s.lat, lng: s.lng };
    this.updateHeading(pos, r.kmh, apiHeading);
    this.lastPos = pos;
    if (r.status === 'lost') return (this.v = { ...idleView(), status: 'lost' });
    this.compute(r.kmh, r.status, pos, s.t);
    return this.v;
  }

  /** Gọi định kỳ để phát hiện mất tín hiệu khi không còn mẫu mới. */
  tick(now: number): ViewState {
    const r = this.filter.statusAt(now);
    if (r.status === 'lost') this.v = { ...idleView(), status: 'lost' };
    return this.v;
  }

  private updateHeading(pos: LatLng, kmh: number | null, apiHeading: number | null): void {
    if (apiHeading !== null && Number.isFinite(apiHeading) && (kmh ?? 0) > 5) {
      this.heading = ((apiHeading % 360) + 360) % 360;
    } else if (this.lastPos && haversine(this.lastPos, pos) >= MIN_MOVE_M) {
      this.heading = bearing(this.lastPos, pos);
    }
  }

  private nearby(pos: LatLng): { segments: RoadSegment[]; alerts: AlertPoint[] } {
    const segs = new Map<string, RoadSegment>();
    for (const key of cellsAround(pos.lat, pos.lng, 60)) {
      for (const s of this.cells.get(key)?.segments ?? []) segs.set(s.id, s);
    }
    const alerts = new Map<string, AlertPoint>();
    for (const key of cellsAround(pos.lat, pos.lng, this.radiusM * 1.6)) {
      for (const a of this.cells.get(key)?.alerts ?? []) alerts.set(a.id, a);
    }
    return { segments: [...segs.values()], alerts: [...alerts.values()] };
  }

  private compute(kmh: number | null, status: GpsStatus, pos: LatLng, t: number): void {
    const { segments, alerts } = this.nearby(pos);
    const lim = kmh !== null ? findLimit(segments, pos, this.heading, this.vehicle) : null;
    const camRoute = matchSegment(segments, pos, this.heading)?.cam === true;
    const limit = lim ? lim.kmh : null;
    const state = speedState(kmh, limit);

    const estimated = lim?.estimated ?? false;
    // Chỉ đọc cảnh báo vượt tốc độ với biển thật; số ước tính chỉ đổi màu trên màn hình.
    if (!estimated && state === 'over' && this.prevState !== 'over' && t - this.lastOverAt > OVERSPEED_REPEAT_MS && limit !== null) {
      this.lastOverAt = t;
      this.speak(overspeedVoiceText(limit));
    }
    this.prevState = state;

    const hits = findAlerts(alerts, pos, this.heading, this.radiusM);
    const hitIds = new Set(hits.map((h) => h.id));
    for (const h of hits) {
      if (this.deduper.shouldAnnounce(h.id, h.distM)) this.speak(alertVoiceText(h.type, h.distM));
    }
    for (const a of alerts) {
      if (!hitIds.has(a.id)) this.deduper.shouldAnnounce(a.id, haversine(pos, a));
    }

    this.v = {
      status,
      kmh,
      limit,
      limitEstimated: estimated,
      state,
      alert: hits[0] ?? null,
      upcoming: hits.slice(1, 4),
      camRoute,
    };
  }
}
