import { angleDiff, bearing, distToSegment, type LatLng } from './geo';

export interface RoadSegment {
  id: string;
  a: LatLng;
  b: LatLng;
  /** Giới hạn tốc độ (km/h); null nếu dữ liệu chưa có. */
  maxspeed: number | null;
}

export interface LimitResult {
  kmh: number;
  segmentId: string;
  distM: number;
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

/**
 * Tìm giới hạn tốc độ tại vị trí hiện tại.
 * Trả null (ẩn biển) khi không có đoạn nào trong 25 m hoặc đoạn khớp nhất chưa có dữ liệu hợp lệ —
 * không bao giờ mượn số của đoạn xa hơn.
 */
export function findLimit(
  segments: RoadSegment[],
  pos: LatLng,
  heading: number | null,
): LimitResult | null {
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

  if (!validSpeed(best.seg.maxspeed)) return null;
  return { kmh: best.seg.maxspeed, segmentId: best.seg.id, distM: best.d };
}
