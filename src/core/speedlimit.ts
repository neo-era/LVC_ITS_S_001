import { estimateLimit } from './cells';
import type { Vehicle } from './vehicle';
import { angleDiff, bearing, distToSegment, type LatLng } from './geo';

export interface RoadSegment {
  id: string;
  a: LatLng;
  b: LatLng;
  /** Giới hạn tốc độ (km/h); null nếu dữ liệu chưa có. */
  maxspeed: number | null;
  /** Tuyến đường này nằm trong danh sách có camera phạt nguội (theo báo chí). */
  cam?: boolean;
  /** Cờ để ước tính giới hạn theo luật khi chưa có số thật (xem estimateLimit). */
  ef?: number;
  /** Giới hạn ước tính cố định (dùng cho dữ liệu mô phỏng). */
  est?: number;
  /** Giờ cấm xe tải (phút trong ngày, giờ VN). */
  hgv?: [number, number][];
  /** Giới hạn làn dành cho ô tô (maxspeed khi đó là làn hỗn hợp). */
  carLane?: number;
}

export interface LimitResult {
  kmh: number;
  segmentId: string;
  distM: number;
  /** true = số ước tính theo luật, không phải biển thật. */
  estimated: boolean;
  /** Ghi chú dưới biển (vd "Làn ô tô · hỗn hợp 50"). */
  note?: string;
}

const MAX_MATCH_DIST_M = 25;
const TIE_M = 5;
const MIN_VALID = 5;
const MAX_VALID = 150;

const validSpeed = (v: number | null): v is number =>
  v !== null && Number.isFinite(v) && v >= MIN_VALID && v <= MAX_VALID;

/** Độ lệch giữa hướng xe và trục đường (không phân biệt chiều), 0–90°. */
function alignment(heading: number, seg: RoadSegment): number {
  const d = angleDiff(heading, bearing(seg.a, seg.b));
  return Math.min(d, 180 - d);
}

/** Đoạn đường khớp nhất với vị trí (trong 25 m, ưu tiên cùng hướng); null nếu không có. */
export function matchSegment(
  segments: RoadSegment[],
  pos: LatLng,
  heading: number | null,
): RoadSegment | null {
  const near = segments
    .map((seg) => ({ seg, d: distToSegment(pos, seg.a, seg.b) }))
    .filter((x) => x.d <= MAX_MATCH_DIST_M);
  if (!near.length) return null;

  const minD = Math.min(...near.map((x) => x.d));
  const candidates = near.filter((x) => x.d <= minD + TIE_M);

  let best = candidates[0];
  if (heading !== null && Number.isFinite(heading)) {
    best = candidates.reduce((p, c) => {
      const ap = alignment(heading, p.seg);
      const ac = alignment(heading, c.seg);
      return ac < ap || (ac === ap && c.d < p.d) ? c : p;
    });
  } else {
    best = candidates.reduce((p, c) => (c.d < p.d ? c : p));
  }
  return best.seg;
}

/**
 * Tìm giới hạn tốc độ tại vị trí hiện tại.
 * Trả null (ẩn biển) khi không có đoạn nào trong 25 m hoặc đoạn khớp nhất chưa có dữ liệu hợp lệ —
 * không bao giờ mượn số của đoạn xa hơn.
 */
export function findLimit(
  segments: RoadSegment[],
  pos: LatLng,
  heading: number | null,
  vehicle: Vehicle = 'car',
): LimitResult | null {
  const seg = matchSegment(segments, pos, heading);
  if (!seg) return null;
  const r = limitOf(seg, vehicle);
  return r ? { ...r, distM: distToSegment(pos, seg.a, seg.b) } : null;
}

/** Giới hạn của một đoạn: số thật nếu có, không thì ước tính theo luật; null nếu không có dữ liệu. */
export function limitOf(seg: RoadSegment | null, vehicle: Vehicle = 'car'): Omit<LimitResult, 'distM'> | null {
  if (!seg) return null;
  if (validSpeed(seg.maxspeed)) {
    // tuyến tách làn: xe máy theo làn hỗn hợp; ô tô theo làn ô tô (kèm nhắc mức làn hỗn hợp)
    if (seg.carLane && validSpeed(seg.carLane) && vehicle !== 'motorbike')
      return { kmh: seg.carLane, segmentId: seg.id, estimated: false, note: `Làn ô tô · hỗn hợp ${seg.maxspeed}` };
    return { kmh: seg.maxspeed, segmentId: seg.id, estimated: false };
  }
  const est = seg.ef !== undefined ? estimateLimit(seg.ef, vehicle) : (seg.est ?? null);
  if (est !== null && validSpeed(est)) return { kmh: est, segmentId: seg.id, estimated: true };
  return null;
}

/** Mã con đường của đoạn: "w123_4" → "w123" (các đoạn cùng một đường OSM). */
const wayOf = (id: string) => {
  const i = id.lastIndexOf('_');
  return i > 0 ? id.slice(0, i) : id;
};

/**
 * Khớp đường có "trí nhớ": đường chính và đường song hành/nhánh rẽ chạy sát nhau (cách 5–20 m)
 * thì GPS nhiễu làm đoạn gần nhất đổi qua lại → biển nhảy 50↔60. Giữ con đường đang đi chừng nào
 * nó còn trong 25 m và cùng hướng; chỉ đổi khi đường khác thắng liên tiếp 3 mẫu,
 * hoặc ngay lập tức khi đường cũ không còn hợp lệ (đã rẽ).
 */
export class SegmentTracker {
  private way: string | null = null;
  private pend: string | null = null;
  private pendN = 0;

  match(segments: RoadSegment[], pos: LatLng, heading: number | null): RoadSegment | null {
    const best = matchSegment(segments, pos, heading);
    if (!best) {
      this.reset();
      return null;
    }
    const bw = wayOf(best.id);
    if (this.way === null || bw === this.way) return this.take(bw, best);
    const prev = this.stillOn(segments, pos, heading);
    if (!prev) return this.take(bw, best);
    if (this.pend === bw) this.pendN++;
    else {
      this.pend = bw;
      this.pendN = 1;
    }
    return this.pendN >= 3 ? this.take(bw, best) : prev;
  }

  reset(): void {
    this.way = null;
    this.pend = null;
    this.pendN = 0;
  }

  private take(way: string, seg: RoadSegment): RoadSegment {
    this.way = way;
    this.pend = null;
    this.pendN = 0;
    return seg;
  }

  /** Đoạn gần nhất của con đường đang đi, nếu còn trong 25 m và cùng hướng (≤ 35°). */
  private stillOn(segments: RoadSegment[], pos: LatLng, heading: number | null): RoadSegment | null {
    let best: RoadSegment | null = null;
    let bd = Infinity;
    for (const s of segments) {
      if (wayOf(s.id) !== this.way) continue;
      const d = distToSegment(pos, s.a, s.b);
      if (d > MAX_MATCH_DIST_M || d >= bd) continue;
      if (heading !== null && Number.isFinite(heading) && alignment(heading, s) > 35) continue;
      best = s;
      bd = d;
    }
    return best;
  }
}
