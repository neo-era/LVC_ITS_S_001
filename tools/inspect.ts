/**
 * Soi dữ liệu thô của một vùng (chạy trong quy trình dữ liệu, sau khi dựng ô): liệt kê các tuyến chính
 * với thẻ OSM (highway, ref, maxspeed, lanes, oneway), số km, tỉ lệ ô "đô thị", giới hạn app sẽ hiện, camera.
 * In ra dạng ::notice để đọc qua GitHub API. Vùng lấy từ tools/inspect-areas.json.
 */
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { cellKey, haversine } from '../src/core/geo';
import { estimateLimit, EF_URBAN } from '../src/core/cells';
import { wayFlags, URBAN_KM } from '../src/pipeline/compact';
import { matchPosted } from '../src/pipeline/posted-limits';
import { parseMaxspeed } from '../src/pipeline/osm';

interface Area { name: string; s: number; w: number; n: number; e: number }
const areas: Area[] = JSON.parse(readFileSync(join('tools', 'inspect-areas.json'), 'utf8'));
const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified']);
const OUT = process.env.OUT_DIR ?? join(process.cwd(), 'public', 'data');

function cellUrban(k: string): boolean | null {
  const f = join(OUT, 'cells', `${k}.json`);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, 'utf8')).u === 1;
}

async function main(): Promise<void> {
  type Agg = { key: string; hw: string; ref: string; name: string; ms: string; lanes: string; oneway: string; km: number; urbanKm: number; app: Set<string> };
  const agg = new Map<string, Agg>();
  const cams: string[] = [];
  const rl = createInterface({ input: createReadStream(process.env.GEOJSONSEQ ?? 'roads.geojsonseq'), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.replace(/^\x1e/, '').trim();
    if (!line) continue;
    const f = JSON.parse(line) as { geometry?: { type: string; coordinates: number[] | number[][] }; properties?: Record<string, string> };
    const p = f.properties ?? {};
    const g = f.geometry;
    if (!g) continue;
    if (p['@type'] === 'node' && g.type === 'Point') {
      const [lng, lat] = g.coordinates as number[];
      if (areas.some((a) => lat >= a.s && lat <= a.n && lng >= a.w && lng <= a.e) && (p.highway === 'speed_camera' || p.enforcement === 'maxspeed'))
        cams.push(`${lat.toFixed(5)},${lng.toFixed(5)} ${p.maxspeed ?? ''}`);
      continue;
    }
    if (p['@type'] !== 'way' || g.type !== 'LineString' || !MAIN.has(p.highway)) continue;
    const pts = (g.coordinates as number[][]).map(([lng, lat]) => ({ lat, lng }));
    const mid = pts[Math.floor(pts.length / 2)];
    if (!areas.some((a) => mid.lat >= a.s && mid.lat <= a.n && mid.lng >= a.w && mid.lng <= a.e)) continue;
    let km = 0;
    let urbanKm = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = haversine(pts[i], pts[i + 1]) / 1000;
      km += d;
      if (cellUrban(cellKey(pts[i].lat, pts[i].lng))) urbanKm += d;
    }
    const tags = p as Record<string, string>;
    const posted = matchPosted(tags, mid.lat, mid.lng);
    const ms = parseMaxspeed(tags.maxspeed);
    const fl = wayFlags(tags);
    const app = posted
      ? `biển công bố ${posted.mixed}${posted.car ? `/${posted.car}` : ''}`
      : ms
        ? `biển OSM ${ms}`
        : `ước tính ô tô ${estimateLimit(fl | (urbanKm > km / 2 ? EF_URBAN : 0), 'car') ?? '-'} / xe máy ${estimateLimit(fl | (urbanKm > km / 2 ? EF_URBAN : 0), 'motorbike') ?? '-'}`;
    const key = `${p.highway}|${p.ref ?? ''}|${p['name:vi'] ?? p.name ?? '(không tên)'}|${p.maxspeed ?? ''}`;
    const a = agg.get(key) ?? { key, hw: p.highway, ref: p.ref ?? '', name: p['name:vi'] ?? p.name ?? '(không tên)', ms: p.maxspeed ?? '', lanes: p.lanes ?? '', oneway: p.oneway ?? '', km: 0, urbanKm: 0, app: new Set<string>() };
    a.km += km;
    a.urbanKm += urbanKm;
    a.app.add(app);
    if (p.lanes) a.lanes = p.lanes;
    if (p.oneway) a.oneway = p.oneway;
    agg.set(key, a);
  }
  const rows = [...agg.values()].filter((a) => a.km >= 0.3).sort((x, y) => y.km - x.km).slice(0, 60);
  const lines = rows.map(
    (a) => `${a.name}${a.ref ? ` [${a.ref}]` : ''} · ${a.hw} · ${a.km.toFixed(1)} km · maxspeed=${a.ms || '∅'} · lanes=${a.lanes || '∅'} · oneway=${a.oneway || '∅'} · đô thị ${Math.round((100 * a.urbanKm) / Math.max(a.km, 0.001))}% · app: ${[...a.app].join(' | ')}`,
  );
  // mỗi notice tối đa ~4000 ký tự → chia nhóm
  let buf: string[] = [];
  let part = 1;
  const flush = () => {
    if (!buf.length) return;
    console.log(`::notice title=Soi vùng ${part++}::${buf.join('%0A')}`);
    buf = [];
  };
  for (const l of lines) {
    if ((buf.join('\n') + l).length > 3500) flush();
    buf.push(l);
  }
  flush();
  console.log(`::notice title=Camera OSM trong vùng::${cams.length ? cams.join('%0A') : 'không có'} (ngưỡng đô thị ${URBAN_KM} km đường/ô)`);
}

void main();
