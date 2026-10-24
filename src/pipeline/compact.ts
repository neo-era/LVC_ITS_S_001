import type { AlertPoint } from '../core/alerts';
import { cellKey, type LatLng } from '../core/geo';

/**
 * Định dạng ô lưới v2 (gọn cho dữ liệu toàn quốc):
 *   { v: 2, cell, w: [[wayId, start, maxspeed|0, cam 0/1, lat0, lng0, dlat1, dlng1, …]], alerts: [...] }
 * Toạ độ nhân 1e5 (≈1,1 m), điểm đầu tuyệt đối, các điểm sau là hiệu số. Đoạn thứ i của mục có id `w{wayId}_{start+i}`
 * — trùng id với định dạng v1 nên đoạn nằm ở nhiều ô vẫn được gộp đúng.
 */
export const E5 = 1e5;

export interface CellFileV2 {
  v: 2;
  cell: string;
  w: number[][];
  alerts: AlertPoint[];
}

const M = 111195;

function perpDist(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos((a.lat * Math.PI) / 180);
  const ax = 0;
  const ay = 0;
  const bx = (b.lng - a.lng) * k * M;
  const by = (b.lat - a.lat) * M;
  const px = (p.lng - a.lng) * k * M;
  const py = (p.lat - a.lat) * M;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Rút gọn polyline (Douglas–Peucker, sai số tối đa tolM mét), luôn giữ hai đầu. */
export function simplify(pts: LatLng[], tolM: number): LatLng[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = perpDist(pts[k], pts[i], pts[j]);
      if (d > maxD) {
        maxD = d;
        idx = k;
      }
    }
    if (idx >= 0 && maxD > tolM) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** Chia các đoạn của way theo ô: đoạn i thuộc ô của 2 đầu mút và điểm giữa. Trả các khoảng điểm liên tiếp [start, end]. */
export function splitWay(pts: LatLng[]): Map<string, { start: number; end: number }[]> {
  const byCell = new Map<string, number[]>();
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const keys = new Set([cellKey(a.lat, a.lng), cellKey(b.lat, b.lng), cellKey((a.lat + b.lat) / 2, (a.lng + b.lng) / 2)]);
    for (const k of keys) {
      const l = byCell.get(k) ?? [];
      l.push(i);
      byCell.set(k, l);
    }
  }
  const out = new Map<string, { start: number; end: number }[]>();
  for (const [k, segs] of byCell) {
    const runs: { start: number; end: number }[] = [];
    for (const s of segs) {
      const last = runs[runs.length - 1];
      if (last && last.end === s) last.end = s + 1;
      else runs.push({ start: s, end: s + 1 });
    }
    out.set(k, runs);
  }
  return out;
}

export function encodeRun(wayId: number, start: number, pts: LatLng[], maxspeed: number | null, cam: boolean): number[] {
  const out = [wayId, start, maxspeed ?? 0, cam ? 1 : 0];
  let pLat = 0;
  let pLng = 0;
  pts.forEach((p, i) => {
    const la = Math.round(p.lat * E5);
    const ln = Math.round(p.lng * E5);
    if (i === 0) out.push(la, ln);
    else out.push(la - pLat, ln - pLng);
    pLat = la;
    pLng = ln;
  });
  return out;
}

/** Gom dữ liệu toàn quốc vào các ô, giữ ở dạng đã mã hoá để tốn ít bộ nhớ. */
export class CellWriter {
  private readonly ways = new Map<string, number[][]>();
  private readonly alerts = new Map<string, AlertPoint[]>();
  private readonly alertIds = new Set<string>();

  addWay(wayId: number, pts: LatLng[], maxspeed: number | null, cam: boolean): void {
    if (pts.length < 2) return;
    for (const [key, runs] of splitWay(pts)) {
      const list = this.ways.get(key) ?? [];
      for (const r of runs) list.push(encodeRun(wayId, r.start, pts.slice(r.start, r.end + 1), maxspeed, cam));
      this.ways.set(key, list);
    }
  }

  addAlert(a: AlertPoint): void {
    if (this.alertIds.has(a.id)) return;
    this.alertIds.add(a.id);
    const key = cellKey(a.lat, a.lng);
    const list = this.alerts.get(key) ?? [];
    list.push(a);
    this.alerts.set(key, list);
  }

  files(): Map<string, CellFileV2> {
    const out = new Map<string, CellFileV2>();
    const keys = new Set([...this.ways.keys(), ...this.alerts.keys()]);
    for (const k of keys) out.set(k, { v: 2, cell: k, w: this.ways.get(k) ?? [], alerts: this.alerts.get(k) ?? [] });
    return out;
  }
}
