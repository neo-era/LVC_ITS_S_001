/**
 * Tạo dữ liệu cảnh báo TOÀN QUỐC từ bản trích OpenStreetMap Việt Nam (Geofabrik) đã lọc bằng osmium:
 *   osmium tags-filter … → osmium export -f geojsonseq -a type,id → tệp GEOJSONSEQ
 * rồi ghi public/data/cells/<ô>.json (định dạng v2 gọn) + version.json.
 * Chạy: GEOJSONSEQ=roads.geojsonseq npm run data   (GitHub Actions chạy hằng đêm — xem .github/workflows/data.yml)
 */
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseCell } from '../src/core/cells';
import { parseRemoteMarks } from '../src/marks';
import { matchCameraRoute } from '../src/pipeline/camera-routes';
import { CellWriter, FLAG, simplify, wayFlags } from '../src/pipeline/compact';
import { NameIndex } from '../src/pipeline/names';
import { parseHgv } from '../src/pipeline/hgv';
import { matchPosted } from '../src/pipeline/posted-limits';
import { convertElements, DRIVABLE, parseMaxspeed, summarizeWays, wayInfo, type OverpassElement, type WayInfo } from '../src/pipeline/osm';
import { approvedUrl, authHeaders } from '../src/sync';

const IN = process.env.GEOJSONSEQ ?? 'roads.geojsonseq';
const OUT = process.env.OUT_DIR ?? join(process.cwd(), 'public', 'data');
const SIMPLIFY_M = 2;
const MAX_TOTAL_BYTES = 900 * 1024 * 1024; // GitHub Pages giới hạn 1 GB cho cả trang

interface Feature {
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
}

function lineOf(g: Feature['geometry']): { lat: number; lon: number }[] | null {
  if (!g) return null;
  let coords: unknown = null;
  if (g.type === 'LineString') coords = g.coordinates;
  else if (g.type === 'Polygon' && Array.isArray(g.coordinates)) coords = g.coordinates[0]; // way khép kín (vòng xoay)
  else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) coords = g.coordinates[0][0];
  if (!Array.isArray(coords)) return null;
  const out: { lat: number; lon: number }[] = [];
  for (const c of coords) {
    if (Array.isArray(c) && typeof c[0] === 'number' && typeof c[1] === 'number') out.push({ lon: c[0], lat: c[1] });
  }
  return out.length >= 2 ? out : null;
}

async function main(): Promise<void> {
  const writer = new CellWriter();
  const names = new NameIndex();
  const ways: WayInfo[] = [];
  const seenWays = new Set<number>();
  let nWays = 0;
  let nHgv = 0;
  let nPosted = 0;
  let nCams = 0;
  let lines = 0;

  const rl = createInterface({ input: createReadStream(IN), crlfDelay: Infinity });
  for await (const raw of rl) {
    const line = raw.replace(/^\x1e/, '').trim();
    if (!line) continue;
    lines++;
    let f: Feature;
    try {
      f = JSON.parse(line) as Feature;
    } catch {
      continue;
    }
    const p = f.properties ?? {};
    const id = Number(p['@id']);
    const tags: Record<string, string> = {};
    for (const [k, v] of Object.entries(p)) if (!k.startsWith('@') && typeof v === 'string') tags[k] = v;

    if (p['@type'] === 'way') {
      if (!DRIVABLE.has(tags.highway) || seenWays.has(id)) continue;
      const geom = lineOf(f.geometry);
      if (!geom) continue;
      seenWays.add(id);
      const el: OverpassElement = { type: 'way', id, tags, geometry: geom };
      const info = wayInfo(el);
      if (info) ways.push(info);
      const pts = simplify(geom.map((g) => ({ lat: g.lat, lng: g.lon })), SIMPLIFY_M);
      const mid = geom[Math.floor(geom.length / 2)];
      names.add(tags['name:vi'] ?? tags.name, mid.lat, mid.lon, 's');
      const flags = wayFlags(tags) | (matchCameraRoute(tags.name, mid.lat, mid.lon) ? FLAG.cam : 0);
      const hgv = parseHgv(tags);
      if (hgv) nHgv++;
      // biển báo thật do cơ quan chức năng công bố (tuyến lớn OSM thiếu/cũ) ghi đè maxspeed của OSM
      const posted = matchPosted(tags, mid.lat, mid.lon);
      if (posted) nPosted++;
      writer.addWay(id, pts, posted ? posted.mixed : parseMaxspeed(tags.maxspeed), flags, hgv, posted?.car ?? null);
      nWays++;
    } else if (p['@type'] === 'node' && f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)) {
      const [lon, lat] = f.geometry.coordinates as number[];
      if (tags.place) names.add(tags['name:vi'] ?? tags.name, lat, lon, 'p');
      const r = convertElements([{ type: 'node', id, lat, lon, tags }]);
      for (const a of r.alerts) {
        writer.addAlert(a);
        nCams++;
      }
    }
    if (lines % 500_000 === 0) console.log(`… đã đọc ${lines} dòng, ${nWays} đường, ${nCams} camera`);
  }

  // Dấu camera đã duyệt trong Supabase (đọc bằng khoá công khai; chỉ trả các dấu có trạng thái "duyệt").
  let nMarks = 0;
  try {
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const res = await fetch(approvedUrl(offset, 1000), { headers: authHeaders(), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as unknown[];
      for (const a of parseRemoteMarks({ marks: rows })) {
        writer.addAlert(a);
        nMarks++;
      }
      if (rows.length < 1000) break;
    }
    console.log(`Dấu camera đã duyệt: ${nMarks}`);
  } catch (e) {
    console.warn('Không lấy được dấu camera đã duyệt, bỏ qua:', String(e));
  }

  const files = writer.files();
  if (files.size === 0) throw new Error('Không có ô dữ liệu nào — dừng để không ghi đè bản cũ.');

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'cells'), { recursive: true });
  let bytes = 0;
  let checked = 0;
  for (const [key, cell] of files) {
    const text = JSON.stringify(cell);
    if (checked++ % 997 === 0 && !parseCell(JSON.parse(text))) throw new Error(`Ô ${key} không đọc lại được`);
    bytes += Buffer.byteLength(text);
    await writeFile(join(OUT, 'cells', `${key}.json`), text);
  }
  // Danh bạ tên đường/địa danh theo mảnh ~55 km để tìm địa điểm trên máy
  await mkdir(join(OUT, 'names'), { recursive: true });
  let nameBytes = 0;
  for (const [key, rows] of names.files()) {
    const text = JSON.stringify(rows);
    nameBytes += Buffer.byteLength(text);
    await writeFile(join(OUT, 'names', `${key}.json`), text);
  }
  bytes += nameBytes;
  console.log(`::notice title=Danh bạ tên::${names.size} tên, ${(nameBytes / 1048576).toFixed(1)} MB`);
  if (bytes > MAX_TOTAL_BYTES) throw new Error(`Dữ liệu ${(bytes / 1048576).toFixed(0)} MB vượt giới hạn — dừng để không làm hỏng trang.`);

  const coverage = summarizeWays(ways);
  const updated = new Date().toISOString().slice(0, 10);
  const inMB = ((await stat(IN)).size / 1048576).toFixed(0);
  await writeFile(
    join(OUT, 'version.json'),
    JSON.stringify({ v: 2, scope: 'VN', updated, cells: files.size, ways: nWays, cameras: nCams, marks: nMarks, bytes, coverage }),
  );

  const byClass = Object.entries(coverage.byClass)
    .sort((a, b) => b[1].km - a[1].km)
    .map(([k, c]) => `${k}: ${c.pct}% (${c.kmWithLimit}/${c.km} km)`);
  console.log(`Độ phủ giới hạn tốc độ: tổng ${coverage.total.pct}% (${coverage.total.kmWithLimit}/${coverage.total.km} km)\n  ${byClass.join('\n  ')}`);
  console.log(`::notice title=Độ phủ giới hạn tốc độ (toàn quốc)::tổng ${coverage.total.pct}% (${coverage.total.kmWithLimit}/${coverage.total.km} km). ${byClass.join('; ')}`);
  console.log(`::notice title=Kích thước dữ liệu::${files.size} ô, ${(bytes / 1048576).toFixed(1)} MB (đầu vào ${inMB} MB), ${nWays} đường (${nHgv} có cấm xe tải, ${nPosted} theo biển công bố), ${nCams} camera OSM, ${nMarks} dấu đã duyệt`);
}

main().catch(async (e) => {
  console.error(e);
  console.log(`::error title=Lấy dữ liệu thất bại::${String(e).slice(0, 300)}`);
  process.exit(1);
});
