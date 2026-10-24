import { angleDiff, bearing, haversine, type LatLng } from './geo';

export type AlertType = 'camera' | 'blackspot';

export interface AlertPoint {
  id: string;
  type: AlertType;
  lat: number;
  lng: number;
  /** Hướng giao thông mà điểm này áp dụng (độ); bỏ trống = mọi hướng. */
  dir?: number;
}

export interface AlertHit {
  id: string;
  type: AlertType;
  distM: number;
}

const AHEAD_DEG = 60;

/** Các cảnh báo phía trước trong bán kính, gần → xa. heading = null thì chỉ xét khoảng cách. */
export function findAlerts(
  points: AlertPoint[],
  pos: LatLng,
  heading: number | null,
  radiusM: number,
): AlertHit[] {
  const hits: AlertHit[] = [];
  for (const p of points) {
    const distM = haversine(pos, p);
    if (distM > radiusM) continue;
    if (heading !== null) {
      if (angleDiff(heading, bearing(pos, p)) > AHEAD_DEG) continue;
      if (p.dir !== undefined && angleDiff(heading, p.dir) > AHEAD_DEG) continue;
    }
    hits.push({ id: p.id, type: p.type, distM });
  }
  return hits.sort((a, b) => a.distM - b.distM);
}

/** Chống báo lặp: mỗi điểm chỉ báo một lần mỗi lượt tiến lại gần; đi xa quá 1,5 × bán kính thì được báo lại. */
export class AlertDeduper {
  private announced = new Set<string>();

  constructor(private readonly radiusM: number) {}

  shouldAnnounce(id: string, distM: number): boolean {
    if (distM > this.radiusM * 1.5) {
      this.announced.delete(id);
      return false;
    }
    if (distM > this.radiusM) return false;
    if (this.announced.has(id)) return false;
    this.announced.add(id);
    return true;
  }
}
