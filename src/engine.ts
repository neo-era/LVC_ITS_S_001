import { isHeavy } from './core/vehicle';
import type { Vehicle } from './core/vehicle';
import { hgvBlockedAt } from './pipeline/hgv';
import { AlertDeduper, findAlerts, TOLL_RADIUS_M, type AlertHit, type AlertPoint } from './core/alerts';
import type { CellData } from './core/cells';
import { alertVoiceText, overspeedVoiceText, speedState, type SpeedState } from './core/format';
import { bearing, cellKey, cellsAround, haversine, type LatLng } from './core/geo';
import { SpeedFilter, type GpsSample, type GpsStatus } from './core/gps';
import { limitOf, SegmentTracker, type RoadSegment } from './core/speedlimit';

export interface ViewState {
  status: GpsStatus | 'idle';
  kmh: number | null;
  limit: number | null;
  /** Giới hạn đang hiện là ước tính theo luật (không phải biển thật). */
  limitEstimated: boolean;
  /** Ghi chú dưới biển (làn ô tô / làn hỗn hợp), null nếu không có. */
  limitNote?: string | null;
  state: SpeedState;
  /** Cảnh báo gần nhất phía trước; null nếu không có. */
  alert: AlertHit | null;
  /** Các cảnh báo kế tiếp (không gồm cảnh báo gần nhất). */
  upcoming: AlertHit[];
  /** Đang chạy trên tuyến đường được báo chí nêu có camera phạt nguội. */
  camRoute: boolean;
  /** Xe tải đang trên đường cấm xe tải vào giờ này (theo biển ghi trong OSM). */
  truckBan: boolean;
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
  truckBan: false,
});

/** Gom GPS → tốc độ lọc → giới hạn → cảnh báo → lời đọc. Không phụ thuộc DOM nên kiểm thử được. */
export class Engine {
  private readonly filter = new SpeedFilter();
  private deduper: AlertDeduper;
  private readonly tollDeduper = new AlertDeduper(TOLL_RADIUS_M);
  private radiusM: number;
  private vehicle: Vehicle;
  private readonly speak: (text: string) => void;
  private readonly cells = new Map<string, CellData>();
  /** Dấu người dùng tự đánh dấu, tách riêng khỏi dữ liệu ô (không chặn nạp ô, không mất khi bỏ ô). */
  private readonly own = new Map<string, AlertPoint[]>();
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

  /** Thêm một điểm cảnh báo của người dùng (dấu tự đánh dấu); trùng id thì thay thế. */
  addAlert(a: AlertPoint): void {
    const key = cellKey(a.lat, a.lng);
    this.own.set(key, [...(this.own.get(key) ?? []).filter((x) => x.id !== a.id), a]);
  }

  removeAlert(a: { id: string; lat: number; lng: number }): void {
    const key = cellKey(a.lat, a.lng);
    const left = (this.own.get(key) ?? []).filter((x) => x.id !== a.id);
    if (left.length) this.own.set(key, left);
    else this.own.delete(key);
  }

  /** Số ô dữ liệu đang giữ trong bộ nhớ. */
  cellCount(): number {
    return this.cells.size;
  }

  /** Bỏ các ô xa hơn keepM khỏi bộ nhớ; vẫn quá maxCells thì bỏ tiếp ô xa nhất. Ô bị bỏ sẽ được nạp lại khi quay lại. */
  evictFar(lat: number, lng: number, keepM: number, maxCells: number): void {
    const here = { lat, lng };
    const dist: [string, number][] = [];
    for (const key of this.cells.keys()) {
      const [y, x] = key.split('_').map(Number);
      const d = haversine(here, { lat: (y + 0.5) * 0.01, lng: (x + 0.5) * 0.01 });
      if (d > keepM) this.cells.delete(key);
      else dist.push([key, d]);
    }
    if (dist.length > maxCells) {
      dist.sort((a, b) => b[1] - a[1]);
      for (const [key] of dist.slice(0, dist.length - maxCells)) this.cells.delete(key);
    }
  }

  private alertsOf(key: string): AlertPoint[] {
    const own = this.own.get(key);
    const base = this.cells.get(key)?.alerts ?? [];
    return own ? [...base, ...own] : base;
  }

  /** Hướng đi hiện tại (độ) nếu đã xác định. */
  currentHeading(): number | null {
    return this.heading;
  }

  /** Các điểm cảnh báo đã nạp trong bán kính (m) quanh vị trí — để vẽ trên bản đồ. */
  alertsNear(pos: LatLng, radiusM: number): AlertPoint[] {
    const out = new Map<string, AlertPoint>();
    for (const key of cellsAround(pos.lat, pos.lng, radiusM)) {
      for (const a of this.alertsOf(key)) if (haversine(pos, a) <= radiusM) out.set(a.id, a);
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

  private readonly tracker = new SegmentTracker();
  private segId: string | null = null;
  /** Mã đoạn đường đang khớp (để báo sai tốc độ chính xác đoạn). */
  currentSegment(): string | null {
    return this.segId;
  }

  private nearby(pos: LatLng): { segments: RoadSegment[]; alerts: AlertPoint[] } {
    const segs = new Map<string, RoadSegment>();
    for (const key of cellsAround(pos.lat, pos.lng, 60)) {
      for (const s of this.cells.get(key)?.segments ?? []) segs.set(s.id, s);
    }
    const alerts = new Map<string, AlertPoint>();
    for (const key of cellsAround(pos.lat, pos.lng, Math.max(this.radiusM, TOLL_RADIUS_M) * 1.6)) {
      for (const a of this.alertsOf(key)) alerts.set(a.id, a);
    }
    return { segments: [...segs.values()], alerts: [...alerts.values()] };
  }

  private compute(kmh: number | null, status: GpsStatus, pos: LatLng, t: number): void {
    const { segments, alerts } = this.nearby(pos);
    const seg = this.tracker.match(segments, pos, this.heading);
    this.segId = seg?.id ?? null;
    const lim = kmh !== null ? limitOf(seg, this.vehicle) : null;
    const camRoute = seg?.cam === true;
    const truckBan = isHeavy(this.vehicle) && !!seg?.hgv && hgvBlockedAt(seg.hgv, t);
    const limit = lim ? lim.kmh : null;
    const state = speedState(kmh, limit);

    const estimated = lim?.estimated ?? false;
    // Chỉ đọc cảnh báo vượt tốc độ với biển thật; số ước tính chỉ đổi màu trên màn hình.
    if (!estimated && state === 'over' && this.prevState !== 'over' && t - this.lastOverAt > OVERSPEED_REPEAT_MS && limit !== null) {
      this.lastOverAt = t;
      this.speak(overspeedVoiceText(limit));
    }
    this.prevState = state;

    const tolls = alerts.filter((a) => a.type === 'toll');
    const hits = findAlerts(alerts.filter((a) => a.type !== 'toll'), pos, this.heading, this.radiusM);
    const hitIds = new Set(hits.map((h) => h.id));
    for (const h of hits) {
      if (this.deduper.shouldAnnounce(h.id, h.distM)) this.speak(alertVoiceText(h.type, h.distM));
    }
    for (const a of alerts) {
      if (a.type !== 'toll' && !hitIds.has(a.id)) this.deduper.shouldAnnounce(a.id, haversine(pos, a));
    }
    // Trạm thu phí: báo ở ~1 km phía trước; trạm hai chiều sát nhau (cùng ô ~300 m) tính là một.
    const tollHits = findAlerts(tolls, pos, this.heading, TOLL_RADIUS_M);
    const tollKey = (a: { lat: number; lng: number }) => `${Math.round(a.lat / 0.003)}_${Math.round(a.lng / 0.003)}`;
    const tollPt = new Map(tolls.map((a) => [a.id, a]));
    const seenTollKeys = new Set<string>();
    for (const h of tollHits) {
      const k = tollKey(tollPt.get(h.id)!);
      if (seenTollKeys.has(k)) continue;
      seenTollKeys.add(k);
      if (this.tollDeduper.shouldAnnounce(k, h.distM)) this.speak(alertVoiceText('toll', h.distM));
    }
    for (const a of tolls) if (!seenTollKeys.has(tollKey(a))) this.tollDeduper.shouldAnnounce(tollKey(a), haversine(pos, a));
    const allHits = [...hits, ...tollHits.filter((h, i, arr) => arr.findIndex((x) => tollKey(tollPt.get(x.id)!) === tollKey(tollPt.get(h.id)!)) === i)].sort(
      (a, b) => a.distM - b.distM,
    );

    this.v = {
      status,
      kmh,
      limit,
      limitEstimated: estimated,
      limitNote: lim?.note ?? null,
      state,
      alert: allHits[0] ?? null,
      upcoming: allHits.slice(1, 4),
      camRoute,
      truckBan,
    };
  }
}
