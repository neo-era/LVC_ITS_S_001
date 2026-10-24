import { describe, expect, it } from 'vitest';
import { matchCameraRoute, normalizeRoadName, CAMERA_ROUTES_META } from '../src/pipeline/camera-routes';

describe('normalizeRoadName', () => {
  it.each([
    ['Đường Điện Biên Phủ', 'điện biên phủ'],
    ['Đại lộ Mai Chí Thọ', 'mai chí thọ'],
    ['  Nguyễn   Thị  Minh Khai ', 'nguyễn thị minh khai'],
    ['Quốc lộ 1A', 'quốc lộ 1a'],
    ['Phố Lê Lợi', 'lê lợi'],
  ])('%s → %s', (raw, want) => expect(normalizeRoadName(raw)).toBe(want));
});

describe('matchCameraRoute', () => {
  const q1 = { lat: 10.777, lng: 106.695 };
  it('khớp tên (bỏ tiền tố, không phân biệt hoa/thường) và nằm trong khu vực của tuyến', () => {
    expect(matchCameraRoute('Đường Lê Lợi', q1.lat, q1.lng)).toBe(true);
    expect(matchCameraRoute('nguyễn huệ', q1.lat, q1.lng)).toBe(true);
    expect(matchCameraRoute('Đại lộ Mai Chí Thọ', 10.78, 106.75)).toBe(true);
  });
  it('cùng tên nhưng ở xa khu vực của tuyến → không khớp (vd: Lê Lợi ở Bình Dương)', () => {
    expect(matchCameraRoute('Đường Lê Lợi', 10.98, 106.65)).toBe(false);
  });
  it('tên không có trong danh sách hoặc trống → không khớp', () => {
    expect(matchCameraRoute('Đường Không Có', q1.lat, q1.lng)).toBe(false);
    expect(matchCameraRoute(undefined, q1.lat, q1.lng)).toBe(false);
    expect(matchCameraRoute('', q1.lat, q1.lng)).toBe(false);
  });
  it('tên chỉ chứa tên tuyến nhưng khác (Lê Lợi Nối Dài) → không khớp', () => {
    expect(matchCameraRoute('Lê Lợi Nối Dài', q1.lat, q1.lng)).toBe(false);
  });
  it('có ghi nguồn và ngày của danh sách', () => {
    expect(CAMERA_ROUTES_META.updated).toMatch(/^\d{4}-\d{2}$/);
    expect(CAMERA_ROUTES_META.sources.length).toBeGreaterThan(0);
  });
});
