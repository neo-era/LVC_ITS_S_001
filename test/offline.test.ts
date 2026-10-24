import { describe, expect, it } from 'vitest';
import { filterProvinces, formatMB, parseLatmapUrl, pickLocal, suggestProvince, type ProvinceInfo } from '../src/offline/core';

const P = (name: string, bbox: [number, number, number, number], bytes = 1e7): ProvinceInfo => ({ name, slug: name.toLowerCase(), bbox, bytes, file: `tiles/${name}.pmtiles` });
const list = [
  P('Thành phố Hồ Chí Minh', [106.3, 10.3, 107.6, 11.5]),
  P('Đồng Nai', [106.75, 10.5, 107.6, 11.9]),
  P('Hà Nội', [105.2, 20.5, 106.1, 21.4]),
];

describe('parseLatmapUrl', () => {
  it('đọc z/x/y', () => {
    expect(parseLatmapUrl('latmap://14/13047/7660')).toEqual({ z: 14, x: 13047, y: 7660 });
  });
  it('sai định dạng → null', () => {
    expect(parseLatmapUrl('latmap://a/b/c')).toBeNull();
    expect(parseLatmapUrl('http://x/1/2/3')).toBeNull();
  });
});

describe('suggestProvince', () => {
  it('chọn tỉnh có khung chứa vị trí, ưu tiên khung nhỏ nhất (vùng chồng lấn)', () => {
    expect(suggestProvince(list, { lat: 10.77, lng: 106.7 })?.name).toBe('Thành phố Hồ Chí Minh');
    expect(suggestProvince(list, { lat: 11.8, lng: 107.2 })?.name).toBe('Đồng Nai');
  });
  it('không có vị trí hoặc ngoài mọi tỉnh → null', () => {
    expect(suggestProvince(list, null)).toBeNull();
    expect(suggestProvince(list, { lat: 15, lng: 100 })).toBeNull();
  });
});

describe('filterProvinces', () => {
  it('tìm không dấu, không phân biệt hoa thường, bỏ tiền tố', () => {
    expect(filterProvinces(list, 'ho chi minh').map((p) => p.name)).toEqual(['Thành phố Hồ Chí Minh']);
    expect(filterProvinces(list, 'dong nai').length).toBe(1);
    expect(filterProvinces(list, 'HÀ NỘI').length).toBe(1);
    expect(filterProvinces(list, '').length).toBe(3);
  });
});

describe('pickLocal', () => {
  const sources = [
    { slug: 'hcm', bbox: [106.3, 10.3, 107.6, 11.5] as [number, number, number, number], minZoom: 0, maxZoom: 14 },
    { slug: 'hn', bbox: [105.2, 20.5, 106.1, 21.4] as [number, number, number, number], minZoom: 0, maxZoom: 14 },
  ];
  it('ô ở TP.HCM → nguồn hcm; ô ở Đà Nẵng → không có', () => {
    // z14 tile ở 10.77,106.70
    expect(pickLocal(sources, 14, 13048, 7698).map((s) => s.slug)).toEqual(['hcm']);
    expect(pickLocal(sources, 14, 13116, 7451)).toEqual([]);
  });
  it('vượt maxzoom → không dùng', () => {
    expect(pickLocal(sources, 15, 26096, 15397)).toEqual([]);
  });
});

describe('formatMB', () => {
  it.each([
    [0, '0 MB'],
    [500_000, '0,5 MB'],
    [64 * 1048576, '64 MB'],
    [1.5 * 1073741824, '1,5 GB'],
  ])('%d → %s', (b, s) => expect(formatMB(b)).toBe(s));
});

import { pointInPoly } from '../src/offline/core';
import { simplifyOutline } from '../src/pipeline/provinces';

describe('gợi ý tỉnh theo đường ranh giới thật (đa giác rút gọn)', () => {
  // Hai tỉnh có khung bao chồng nhau: A hình chữ L lớn, B hình vuông nhỏ nằm trong khung của A nhưng ngoài đa giác A.
  const A: ProvinceInfo = {
    name: 'Tỉnh A', slug: 'a', bytes: 1, file: 'a', bbox: [0, 0, 10, 10],
    poly: [[[[0, 0], [10, 0], [10, 2], [2, 2], [2, 10], [0, 10], [0, 0]]]],
  };
  const B: ProvinceInfo = { name: 'Tỉnh B', slug: 'b', bytes: 1, file: 'b', bbox: [3, 3, 9, 9], poly: [[[[3, 3], [9, 3], [9, 9], [3, 9], [3, 3]]]] };
  it('điểm nằm trong khung A nhưng ngoài đa giác A → chọn B', () => {
    expect(suggestProvince([A, B], { lat: 5, lng: 5 })?.slug).toBe('b');
  });
  it('điểm trong phần chân chữ L của A → chọn A dù khung B nhỏ hơn không chứa', () => {
    expect(suggestProvince([A, B], { lat: 1, lng: 5 })?.slug).toBe('a');
  });
  it('pointInPoly: trong/ngoài, có lỗ', () => {
    const sq = [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]], [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]];
    expect(pointInPoly([sq], 3, 3)).toBe(true);
    expect(pointInPoly([sq], 1.5, 1.5)).toBe(false); // trong lỗ
    expect(pointInPoly([sq], 5, 5)).toBe(false);
  });
  it('simplifyOutline: rút gọn, làm tròn 4 chữ số, giữ vòng khép kín, bỏ vòng quá nhỏ', () => {
    const ring: [number, number][] = [];
    for (let i = 0; i <= 100; i++) ring.push([106 + i * 0.001, 10 + (i % 2) * 0.000001]);
    ring.push([106.1, 10.1], [106, 10.1], [106, 10]);
    const out = simplifyOutline({ type: 'Polygon', coordinates: [ring, [[1, 1], [1, 1], [1, 1]]] }, 300)!;
    expect(out).toHaveLength(1);
    const r = out[0][0];
    expect(r.length).toBeLessThan(10);
    expect(r[0]).toEqual(r[r.length - 1]);
    expect(r.every(([x, y]) => Number.isInteger(Math.round(x * 1e4)) && Math.abs(x * 1e4 - Math.round(x * 1e4)) < 1e-6 && Math.abs(y * 1e4 - Math.round(y * 1e4)) < 1e-6)).toBe(true);
  });
});
