import type { AlertPoint } from '../core/alerts';
import { cellKey, haversine } from '../core/geo';
import { matchCameraRoute } from './camera-routes';
import type { RoadSegment } from '../core/speedlimit';

/** Phần Overpass (out geom) mà ta dùng. */
export interface OverpassElement {
  type: 'way' | 'node';
  id: number;
  lat?: number;
  lon?: number;
  geometry?: { lat: number; lon: number }[];
  tags?: Record<string, string>;
}

export interface CellFile {
  v: 1;
  cell: string;
  segments: { id: string; a: [number, number]; b: [number, number]; maxspeed: number | null; cam?: 1 }[];
  alerts: { id: string; type: 'camera' | 'blackspot'; lat: number; lng: number; dir?: number }[];
}

/** "50", "50 km/h" → 50; mph, "none", "signals", "VN:urban"… → null (không đoán). */
export function parseMaxspeed(tag: string | undefined): number | null {
  if (!tag) return null;
  const m = /^\s*(\d{1,3})\s*(km\/h)?\s*$/i.exec(tag);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 5 && n <= 150 ? n : null;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'living_street',
]);

/** Hướng camera: thẻ direction dạng số 0–360; chữ (N, NE…) hoặc sai → bỏ (áp dụng mọi hướng). */
function cameraDir(tags: Record<string, string>): number | undefined {
  const raw = tags.direction ?? tags['camera:direction'];
  if (!raw || !/^\d{1,3}(\.\d+)?$/.test(raw.trim())) return undefined;
  const d = Number(raw);
  return d >= 0 && d <= 360 ? d : undefined;
}

export function convertElements(els: OverpassElement[]): { segments: RoadSegment[]; alerts: AlertPoint[] } {
  const segments: RoadSegment[] = [];
  const alerts: AlertPoint[] = [];
  for (const e of els) {
    const tags = e.tags ?? {};
    if (e.type === 'way' && tags.highway && DRIVABLE.has(tags.highway) && e.geometry && e.geometry.length >= 2) {
      const maxspeed = parseMaxspeed(tags.maxspeed);
      const mid = e.geometry[Math.floor(e.geometry.length / 2)];
      const cam = matchCameraRoute(tags.name, mid.lat, mid.lon);
      for (let i = 0; i + 1 < e.geometry.length; i++) {
        const p = e.geometry[i];
        const q = e.geometry[i + 1];
        if (p.lat === q.lat && p.lon === q.lon) continue;
        const seg: RoadSegment = {
          id: `w${e.id}_${i}`,
          a: { lat: r6(p.lat), lng: r6(p.lon) },
          b: { lat: r6(q.lat), lng: r6(q.lon) },
          maxspeed,
        };
        if (cam) seg.cam = true;
        segments.push(seg);
      }
    } else if (
      e.type === 'node' &&
      typeof e.lat === 'number' &&
      typeof e.lon === 'number' &&
      (tags.highway === 'speed_camera' || tags.enforcement === 'maxspeed')
    ) {
      const a: AlertPoint = { id: `n${e.id}`, type: 'camera', lat: r6(e.lat), lng: r6(e.lon) };
      const dir = cameraDir(tags);
      if (dir !== undefined) a.dir = dir;
      alerts.push(a);
    }
  }
  return { segments, alerts };
}

/** Chia vào ô lưới ~1 km. Đoạn đường nằm ở ô của hai đầu mút và điểm giữa; trùng lặp được loại. */
export function bucketCells(data: { segments: RoadSegment[]; alerts: AlertPoint[] }): Map<string, CellFile> {
  const cells = new Map<string, CellFile>();
  const get = (key: string): CellFile => {
    let c = cells.get(key);
    if (!c) cells.set(key, (c = { v: 1, cell: key, segments: [], alerts: [] }));
    return c;
  };
  for (const s of data.segments) {
    const keys = new Set([
      cellKey(s.a.lat, s.a.lng),
      cellKey(s.b.lat, s.b.lng),
      cellKey((s.a.lat + s.b.lat) / 2, (s.a.lng + s.b.lng) / 2),
    ]);
    for (const k of keys) {
      const out: CellFile['segments'][number] = { id: s.id, a: [s.a.lat, s.a.lng], b: [s.b.lat, s.b.lng], maxspeed: s.maxspeed };
      if (s.cam) out.cam = 1;
      get(k).segments.push(out);
    }
  }
  const seen = new Set<string>();
  for (const a of data.alerts) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    const item: CellFile['alerts'][number] = { id: a.id, type: a.type, lat: a.lat, lng: a.lng };
    if (a.dir !== undefined) item.dir = a.dir;
    get(cellKey(a.lat, a.lng)).alerts.push(item);
  }
  return cells;
}

export interface WayInfo {
  hw: string;
  km: number;
  has: boolean;
}

/** Thông tin một con đường dành cho xe: lớp đường, chiều dài (km), có giới hạn tốc độ hợp lệ không. */
export function wayInfo(e: OverpassElement): WayInfo | null {
  const tags = e.tags ?? {};
  if (e.type !== 'way' || !tags.highway || !DRIVABLE.has(tags.highway) || !e.geometry || e.geometry.length < 2) return null;
  let m = 0;
  for (let i = 0; i + 1 < e.geometry.length; i++) {
    m += haversine({ lat: e.geometry[i].lat, lng: e.geometry[i].lon }, { lat: e.geometry[i + 1].lat, lng: e.geometry[i + 1].lon });
  }
  return { hw: tags.highway, km: m / 1000, has: parseMaxspeed(tags.maxspeed) !== null };
}

export interface Coverage {
  km: number;
  kmWithLimit: number;
  pct: number;
}

const cov = (km: number, kmWithLimit: number): Coverage => ({
  km: Math.round(km * 10) / 10,
  kmWithLimit: Math.round(kmWithLimit * 10) / 10,
  pct: km > 0 ? Math.round((kmWithLimit / km) * 1000) / 10 : 0,
});

export function summarizeWays(ways: WayInfo[]): { total: Coverage; byClass: Record<string, Coverage> } {
  const acc = new Map<string, { km: number; w: number }>();
  let tk = 0;
  let tw = 0;
  for (const w of ways) {
    const c = acc.get(w.hw) ?? { km: 0, w: 0 };
    c.km += w.km;
    if (w.has) c.w += w.km;
    acc.set(w.hw, c);
    tk += w.km;
    if (w.has) tw += w.km;
  }
  const byClass: Record<string, Coverage> = {};
  for (const [k, c] of acc) byClass[k] = cov(c.km, c.w);
  return { total: cov(tk, tw), byClass };
}
