import { describe, expect, it } from 'vitest';
import { featureBBox, pickProvinces, slugify } from '../src/pipeline/provinces';
import { collectFontstacks, rewriteStyle, GLYPH_RANGES } from '../src/pipeline/style';
import { tileBBox, bboxContains } from '../src/offline/tiles';

describe('slugify', () => {
  it.each([
    ['Thành phố Hồ Chí Minh', 'thanh-pho-ho-chi-minh'],
    ['Đắk Lắk', 'dak-lak'],
    ['Tỉnh Bà Rịa – Vũng Tàu', 'tinh-ba-ria-vung-tau'],
    ['  Hà   Nội ', 'ha-noi'],
  ])('%s → %s', (a, b) => expect(slugify(a)).toBe(b));
});

const poly = (name: string, ring: [number, number][], extra: Record<string, unknown> = {}) => ({
  type: 'Feature',
  properties: { name, boundary: 'administrative', admin_level: '4', ...extra },
  geometry: { type: 'MultiPolygon', coordinates: [[ring]] },
});

describe('pickProvinces', () => {
  it('chỉ lấy ranh giới hành chính cấp 4 có tên, bỏ trùng, tính khung bao', () => {
    const r = pickProvinces([
      poly('Hà Nội', [[105.3, 20.5], [106.0, 20.5], [106.0, 21.4], [105.3, 21.4], [105.3, 20.5]]),
      poly('Hà Nội', [[105.3, 20.5], [105.4, 20.5], [105.4, 20.6], [105.3, 20.5]]),
      poly('Xã X', [[1, 1], [2, 1], [2, 2], [1, 1]], { admin_level: '8' }),
      { type: 'Feature', properties: { boundary: 'administrative', admin_level: '4' }, geometry: { type: 'Polygon', coordinates: [] } },
    ]);
    expect(r.map((p) => p.slug)).toEqual(['ha-noi']);
    expect(r[0].bbox).toEqual([105.3, 20.5, 106.0, 21.4]);
  });
  it('featureBBox cho Polygon và MultiPolygon', () => {
    expect(featureBBox({ type: 'Polygon', coordinates: [[[1, 2], [3, 4], [0, 5]]] })).toEqual([0, 2, 3, 5]);
    expect(featureBBox({ type: 'Point', coordinates: [1, 2] })).toBeNull();
  });
});

describe('rewriteStyle', () => {
  const style = {
    version: 8,
    sources: {
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
      ne2_shaded: { type: 'raster', url: 'https://x/ne' },
    },
    sprite: 'https://tiles.openfreemap.org/sprites/ofm_f384/ofm',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    layers: [
      { id: 'bg', type: 'background' },
      { id: 'shade', type: 'raster', source: 'ne2_shaded' },
      { id: 'road', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation' },
      { id: 'label', type: 'symbol', source: 'openmaptiles', layout: { 'text-font': ['Noto Sans Regular'] } },
      { id: 'label2', type: 'symbol', source: 'openmaptiles', layout: { 'text-font': ['literal', ['Noto Sans Bold']] } },
    ],
  };
  it('đổi nguồn sang giao thức latmap, font/sprite cục bộ, bỏ nguồn và lớp khác', () => {
    const s = rewriteStyle(style, { tiles: 'latmap://{z}/{x}/{y}', glyphs: './map/fonts/{fontstack}/{range}.pbf', sprite: './map/sprite/ofm' });
    expect(Object.keys(s.sources)).toEqual(['openmaptiles']);
    expect(s.sources.openmaptiles).toMatchObject({ type: 'vector', tiles: ['latmap://{z}/{x}/{y}'], maxzoom: 14 });
    expect(s.sources.openmaptiles.attribution).toMatch(/OpenStreetMap/);
    expect(s.layers.map((l: { id: string }) => l.id)).toEqual(['bg', 'road', 'label', 'label2']);
    expect(s.glyphs).toBe('./map/fonts/{fontstack}/{range}.pbf');
    expect(s.sprite).toBe('./map/sprite/ofm');
    expect(style.sources.ne2_shaded).toBeDefined(); // không sửa đối tượng gốc
  });
  it('liệt kê các bộ font đang dùng (kể cả biểu thức literal)', () => {
    expect(collectFontstacks(style.layers).sort()).toEqual(['Noto Sans Bold', 'Noto Sans Regular']);
  });
  it('dải glyph có cả khối chữ tiếng Việt (7680-7935)', () => {
    expect(GLYPH_RANGES).toContain('7680-7935');
    expect(GLYPH_RANGES).toContain('0-255');
  });
});

describe('tileBBox / bboxContains', () => {
  it('ô z0 phủ toàn thế giới', () => {
    const b = tileBBox(0, 0, 0);
    expect(b[0]).toBeCloseTo(-180);
    expect(b[2]).toBeCloseTo(180);
  });
  it('ô z14 ở TP.HCM nằm trong khung TP.HCM, không nằm trong khung Hà Nội', () => {
    // x,y của (10.77, 106.70) ở z14
    const z = 14;
    const n = 2 ** z;
    const x = Math.floor(((106.7 + 180) / 360) * n);
    const lat = (10.77 * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
    const t = tileBBox(z, x, y);
    expect(bboxContains([106.3, 10.3, 107.1, 11.2], t)).toBe(true);
    expect(bboxContains([105.3, 20.5, 106.0, 21.4], t)).toBe(false);
  });
  it('ô chỉ chạm một phần khung → vẫn tính là có (giao nhau)', () => {
    expect(bboxContains([0, 0, 10, 10], [9, 9, 11, 11])).toBe(true);
    expect(bboxContains([0, 0, 10, 10], [11, 11, 12, 12])).toBe(false);
  });
});

describe('các sửa sau review', () => {
  it('bỏ tỉnh nước láng giềng (ISO3166-2 không bắt đầu bằng VN-)', () => {
    const ring: [number, number][] = [[105, 20], [106, 20], [106, 21], [105, 20]];
    const r = pickProvinces([poly('Hà Nội', ring, { 'ISO3166-2': 'VN-HN' }), poly('Yunnan', ring, { 'ISO3166-2': 'CN-YN' })]);
    expect(r.map((p) => p.name)).toEqual(['Hà Nội']);
  });
  it('không coi "zoom", "get" là tên font', () => {
    const layers = [{ id: 'a', type: 'symbol', layout: { 'text-font': ['step', ['zoom'], ['literal', ['Noto Sans Regular']], 10, ['literal', ['Noto Sans Bold']]] } }];
    expect(collectFontstacks(layers).sort()).toEqual(['Noto Sans Bold', 'Noto Sans Regular']);
  });
});
