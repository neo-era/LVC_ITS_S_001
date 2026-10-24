/**
 * Tạo dữ liệu cảnh báo từ OpenStreetMap (Overpass) → public/data/cells/*.json + version.json.
 * Chạy: npm run data   (đêm hằng ngày bởi GitHub Actions)
 * Biến môi trường: OVERPASS_URLS (phân tách dấu phẩy), BBOX="s,w,n,e", OUT_DIR.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCell } from '../src/core/cells';
import { parseRemoteMarks } from '../src/marks';
import { approvedUrl, authHeaders } from '../src/sync';
import { bucketCells, convertElements, summarizeWays, wayInfo, type OverpassElement, type WayInfo } from '../src/pipeline/osm';

const URLS = (process.env.OVERPASS_URLS ?? 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',');
const [S, W, N, E] = (process.env.BBOX ?? '10.35,106.35,11.25,107.1').split(',').map(Number); // TP.HCM
const OUT = process.env.OUT_DIR ?? join(process.cwd(), 'public', 'data');
const TILE = 0.1;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const HIGHWAYS = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

function query(s: number, w: number, n: number, e: number): string {
  const b = `${s},${w},${n},${e}`;
  return `[out:json][timeout:180];(way["highway"~"^(${HIGHWAYS})$"](${b});node["highway"="speed_camera"](${b});node["enforcement"="maxspeed"](${b}););out geom tags;`;
}

async function fetchTile(q: string): Promise<OverpassElement[]> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    const url = URLS[attempt % URLS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
          'user-agent': 'LaiAnToan-data-builder/0.1 (https://github.com/neo-era/LVC_ITS_S_001)',
        },
        body: 'data=' + encodeURIComponent(q),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} từ ${url}`);
      const j = (await res.json()) as { elements?: OverpassElement[] };
      if (!Array.isArray(j.elements)) throw new Error('phản hồi không có elements');
      return j.elements;
    } catch (err) {
      lastErr = err;
      await sleep(5000 * (attempt + 1));
    }
  }
  throw new Error(`Không tải được ô sau 4 lần: ${String(lastErr)}`);
}

async function main(): Promise<void> {
  const segments = new Map<string, ReturnType<typeof convertElements>['segments'][number]>();
  const alerts = new Map<string, ReturnType<typeof convertElements>['alerts'][number]>();
  const ways = new Map<number, WayInfo>(); // thống kê độ phủ, mỗi way tính một lần
  let tiles = 0;
  for (let s = S; s < N; s += TILE) {
    for (let w = W; w < E; w += TILE) {
      const els = await fetchTile(query(s, w, Math.min(s + TILE, N), Math.min(w + TILE, E)));
      const r = convertElements(els);
      for (const e of els) {
        const wi = wayInfo(e);
        if (wi) ways.set(e.id, wi);
      }
      for (const x of r.segments) segments.set(x.id, x); // way cắt qua nhiều ô chỉ giữ một bản
      for (const a of r.alerts) alerts.set(a.id, a);
      tiles++;
      console.log(`ô ${tiles}: ${els.length} phần tử`);
      await sleep(1000);
    }
  }
  // Dấu camera đã duyệt trong Supabase (đọc bằng khoá công khai; chỉ trả các dấu có trạng thái "duyệt").
  try {
    const extra: ReturnType<typeof parseRemoteMarks> = [];
    for (let offset = 0; offset < 20_000; offset += 1000) {
      const res = await fetch(approvedUrl(offset, 1000), { headers: authHeaders(), signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as unknown[];
      extra.push(...parseRemoteMarks({ marks: rows }));
      if (rows.length < 1000) break;
    }
    for (const a of extra) alerts.set(a.id, a);
    console.log(`Dấu camera đã duyệt: ${extra.length}`);
  } catch (e) {
    console.warn('Không lấy được dấu camera đã duyệt, bỏ qua:', String(e));
  }
  const cells = bucketCells({ segments: [...segments.values()], alerts: [...alerts.values()] });
  if (cells.size === 0) throw new Error('Không có ô dữ liệu nào — dừng để không ghi đè bản cũ.');

  await rm(OUT, { recursive: true, force: true });
  await mkdir(join(OUT, 'cells'), { recursive: true });
  for (const [key, cell] of cells) {
    if (!parseCell(cell)) throw new Error(`Ô ${key} không hợp lệ`);
    await writeFile(join(OUT, 'cells', `${key}.json`), JSON.stringify(cell));
  }
  const coverage = summarizeWays([...ways.values()]);
  const updated = new Date().toISOString().slice(0, 10);
  await writeFile(
    join(OUT, 'version.json'),
    JSON.stringify({ v: 1, updated, cells: cells.size, segments: segments.size, alerts: alerts.size, coverage }),
  );
  const lines = Object.entries(coverage.byClass)
    .sort((a, b) => b[1].km - a[1].km)
    .map(([k, c]) => `${k}: ${c.pct}% (${c.kmWithLimit}/${c.km} km)`);
  console.log(`Độ phủ giới hạn tốc độ: tổng ${coverage.total.pct}% (${coverage.total.kmWithLimit}/${coverage.total.km} km)\n  ${lines.join('\n  ')}`);
  // Hiện thống kê trong phần ghi chú của lần chạy trên GitHub (đọc được mà không cần tải nhật ký).
  console.log(`::notice title=Độ phủ giới hạn tốc độ::tổng ${coverage.total.pct}% (${coverage.total.kmWithLimit}/${coverage.total.km} km). ${lines.slice(0, 6).join('; ')}`);
  console.log(`Xong: ${cells.size} ô, ${segments.size} đoạn đường, ${alerts.size} camera.`);
}

main().catch(async (e) => {
  console.error(e);
  // Ghi lý do lỗi ra tệp để đọc được từ trang đã triển khai (không ảnh hưởng dữ liệu cũ khi chạy ban đêm).
  try {
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, 'build-error.txt'), String(e));
  } catch {
    /* bỏ qua */
  }
  process.exit(1);
});
