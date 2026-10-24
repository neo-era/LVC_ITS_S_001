/**
 * Bản đồ offline theo tỉnh.
 *   prepare: adm.geojson (ranh giới từ osmium) → regions/<slug>.geojson + danh sách tỉnh
 *   finish : ghi dung lượng từng tỉnh vào public/map/provinces.json, tải style/sprite/font (OpenFreeMap) và đổi nguồn sang cục bộ
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pickProvinces } from '../../src/pipeline/provinces';
import { collectFontstacks, GLYPH_RANGES, rewriteStyle } from '../../src/pipeline/style';

const OUT = join(process.cwd(), 'public', 'map');
const REGIONS = join(process.cwd(), 'regions');
const OFM = 'https://tiles.openfreemap.org';
const UA = 'LaiAnToan-map-builder/0.1 (https://github.com/neo-era/LVC_ITS_S_001)';

async function get(url: string): Promise<Response> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA } });
      if (r.ok) return r;
      if (r.status === 404) return r;
    } catch {
      /* thử lại */
    }
    await new Promise((res) => setTimeout(res, 2000 * (i + 1)));
  }
  throw new Error(`Không tải được ${url}`);
}

async function prepare(): Promise<void> {
  const fc = JSON.parse(await readFile('adm.geojson', 'utf8')) as { features: unknown[] };
  const provinces = pickProvinces(fc.features);
  if (provinces.length < 20) throw new Error(`Chỉ tìm thấy ${provinces.length} tỉnh — dữ liệu ranh giới bất thường`);
  await mkdir(REGIONS, { recursive: true });
  for (const p of provinces) await writeFile(join(REGIONS, `${p.slug}.geojson`), JSON.stringify(p.feature));
  await mkdir(OUT, { recursive: true });
  await writeFile(join(REGIONS, 'index.json'), JSON.stringify(provinces.map(({ name, slug, bbox }) => ({ name, slug, bbox }))));
  console.log(`::notice title=Tỉnh/thành::${provinces.length}: ${provinces.map((p) => p.name).join(', ')}`);
}

async function finish(): Promise<void> {
  const list = JSON.parse(await readFile(join(REGIONS, 'index.json'), 'utf8')) as { name: string; slug: string; bbox: number[] }[];
  const tiles = new Set(await readdir(join(OUT, 'tiles')));
  const out = [];
  let total = 0;
  for (const p of list) {
    const f = `${p.slug}.pmtiles`;
    if (!tiles.has(f)) continue;
    const bytes = (await stat(join(OUT, 'tiles', f))).size;
    total += bytes;
    out.push({ ...p, bytes, file: `tiles/${f}` });
  }
  const updated = new Date().toISOString().slice(0, 10);
  await writeFile(join(OUT, 'provinces.json'), JSON.stringify({ v: 1, updated, provinces: out }));

  // Style sáng / tối
  const pick = async (names: string[]) => {
    for (const n of names) {
      const r = await get(`${OFM}/styles/${n}`);
      if (r.ok) return { name: n, style: await r.json() };
    }
    throw new Error(`Không tải được style ${names.join('/')}`);
  };
  const light = await pick(['positron', 'liberty']);
  const dark = await pick(['dark', 'fiord', 'positron']);
  const fonts = new Set<string>();
  for (const [key, s] of [['light', light], ['dark', dark]] as const) {
    const spriteUrl: string = Array.isArray(s.style.sprite) ? s.style.sprite[0].url : s.style.sprite;
    const spriteName = `${key}`;
    await mkdir(join(OUT, 'sprite'), { recursive: true });
    for (const suf of ['.json', '.png', '@2x.json', '@2x.png']) {
      const r = await get(`${spriteUrl}${suf}`);
      if (r.ok) await writeFile(join(OUT, 'sprite', `${spriteName}${suf}`), Buffer.from(await r.arrayBuffer()));
    }
    for (const f of collectFontstacks(s.style.layers)) fonts.add(f);
    const st = rewriteStyle(s.style, {
      tiles: 'latmap://{z}/{x}/{y}',
      glyphs: 'map/fonts/{fontstack}/{range}.pbf', // app đổi thành địa chỉ tuyệt đối khi nạp
      sprite: `map/sprite/${spriteName}`,
    });
    await writeFile(join(OUT, `style-${key}.json`), JSON.stringify(st));
  }
  let nGlyph = 0;
  for (const f of fonts) {
    const dir = join(OUT, 'fonts', f);
    await mkdir(dir, { recursive: true });
    for (const range of GLYPH_RANGES) {
      const r = await get(`${OFM}/fonts/${encodeURIComponent(f)}/${range}.pbf`);
      if (r.ok) {
        await writeFile(join(dir, `${range}.pbf`), Buffer.from(await r.arrayBuffer()));
        nGlyph++;
      }
    }
  }
  console.log(
    `::notice title=Bản đồ offline::${out.length} tỉnh, tổng ${(total / 1048576).toFixed(0)} MB (lớn nhất: ${out
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map((p) => `${p.name} ${(p.bytes / 1048576).toFixed(0)} MB`)
      .join(', ')}). Style: ${light.name}/${dark.name}. Font: ${[...fonts].join(' | ')} (${nGlyph} tệp)`,
  );
  if (total > 700 * 1048576) throw new Error(`Bản đồ ${(total / 1048576).toFixed(0)} MB — quá lớn cho GitHub Pages (cùng dữ liệu cảnh báo)`);
}

const cmd = process.argv[2];
(cmd === 'prepare' ? prepare() : cmd === 'finish' ? finish() : Promise.reject(new Error('dùng: prepare | finish'))).catch((e) => {
  console.log(`::error title=Dựng bản đồ thất bại::${String(e).slice(0, 400)}`);
  process.exit(1);
});
