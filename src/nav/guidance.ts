import { haversine } from '../core/geo';
import { speakDistance } from '../core/format';
import type { Route } from './route';

export interface NavState {
  /** Bước rẽ kế tiếp phía trước; null khi đã tới nơi. */
  next: { text: string; type: number } | null;
  distToNextM: number;
  remainingM: number;
  offRoute: boolean;
  arrived: boolean;
}

export interface NavFix {
  lat: number;
  lng: number;
  t: number;
}

const OFF_ROUTE_M = 40;
const OFF_ROUTE_COUNT = 3;
const ARRIVE_M = 30;
const ANNOUNCE_AT = [300, 100];
const WINDOW_AHEAD = 40; // số đoạn xét phía trước vị trí hiện tại

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Theo dõi xe trên tuyến: tiến độ, bước rẽ kế tiếp, nhắc rẽ bằng giọng nói, lệch đường, đến nơi. */
export class Guidance {
  private readonly cum: number[] = [0];
  private seg = 0;
  private offCount = 0;
  private offNotified = false;
  private arrived = false;
  private readonly done = new Set<string>();
  private state: NavState;

  constructor(
    private readonly route: Route,
    private readonly speak: (text: string) => void,
    private readonly onOffRoute: () => void = () => {},
  ) {
    const p = route.points;
    for (let i = 1; i < p.length; i++) this.cum.push(this.cum[i - 1] + haversine(p[i - 1], p[i]));
    this.state = {
      next: this.firstNext(0),
      distToNextM: 0,
      remainingM: this.cum[this.cum.length - 1],
      offRoute: false,
      arrived: false,
    };
  }

  private get total(): number {
    return this.cum[this.cum.length - 1];
  }

  private nextIndex(progress: number): number {
    const ms = this.route.maneuvers;
    for (let i = 0; i < ms.length; i++) {
      if (ms[i].startIdx > 0 && this.cum[ms[i].startIdx] > progress) return i;
    }
    return -1;
  }

  private firstNext(progress: number) {
    const i = this.nextIndex(progress);
    return i < 0 ? null : { text: this.route.maneuvers[i].text, type: this.route.maneuvers[i].type };
  }

  /** Chiếu vị trí lên các đoạn trong cửa sổ [from, to]; trả đoạn gần nhất, khoảng lệch và quãng đã đi. */
  private project(lat: number, lng: number, from: number, to: number) {
    const pts = this.route.points;
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const M = 111195;
    let best = { seg: from, dist: Number.POSITIVE_INFINITY, progress: 0 };
    for (let i = from; i <= to; i++) {
      const ax = (pts[i].lng - lng) * cosLat * M;
      const ay = (pts[i].lat - lat) * M;
      const bx = (pts[i + 1].lng - lng) * cosLat * M;
      const by = (pts[i + 1].lat - lat) * M;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const px = ax + t * dx;
      const py = ay + t * dy;
      const d = Math.hypot(px, py);
      if (d < best.dist) best = { seg: i, dist: d, progress: this.cum[i] + t * Math.sqrt(len2) };
    }
    return best;
  }

  update(fix: NavFix): NavState {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng) || this.arrived) return this.state;
    const last = this.route.points.length - 2;
    let best = this.project(fix.lat, fix.lng, Math.max(0, this.seg - 1), Math.min(last, this.seg + WINDOW_AHEAD));
    if (best.dist > OFF_ROUTE_M) {
      const wide = this.project(fix.lat, fix.lng, 0, last); // có thể đã quay lại đoạn khác của tuyến
      if (wide.dist < best.dist) best = wide;
    }

    if (best.dist > OFF_ROUTE_M) {
      this.offCount++;
      if (this.offCount >= OFF_ROUTE_COUNT && !this.offNotified) {
        this.offNotified = true;
        this.onOffRoute();
      }
    } else {
      this.offCount = 0;
      this.offNotified = false;
      this.seg = best.seg;
    }
    const offRoute = this.offCount >= OFF_ROUTE_COUNT;
    const progress = best.dist > OFF_ROUTE_M ? (this.state.remainingM > 0 ? this.total - this.state.remainingM : 0) : best.progress;
    const remainingM = Math.max(0, this.total - progress);

    const ni = this.nextIndex(progress);
    const next = ni < 0 ? null : this.route.maneuvers[ni];
    const distToNextM = next ? Math.max(0, this.cum[next.startIdx] - progress) : remainingM;

    if (!offRoute && next) {
      for (const thr of ANNOUNCE_AT) {
        const key = `${ni}:${thr}`;
        if (distToNextM <= thr && !this.done.has(key)) {
          // đã qua các mốc xa hơn thì coi như đã báo, tránh đọc dồn
          for (const t2 of ANNOUNCE_AT) if (t2 >= thr) this.done.add(`${ni}:${t2}`);
          this.speak(`Sau ${speakDistance(thr)}, ${lowerFirst(next.spoken)}`);
          break;
        }
      }
    }

    if (!offRoute && remainingM <= ARRIVE_M) {
      this.arrived = true;
      this.speak('Bạn đã đến nơi.');
    }

    this.state = {
      next: next ? { text: next.text, type: next.type } : null,
      distToNextM,
      remainingM,
      offRoute,
      arrived: this.arrived,
    };
    return this.state;
  }
}
