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
