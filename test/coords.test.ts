import { describe, expect, it } from 'vitest';
import { parseCoords } from '../src/nav/coords';

const near = (r: { lat: number; lng: number } | null, lat: number, lng: number) => {
  expect(r).not.toBeNull();
  expect(r!.lat).toBeCloseTo(lat, 5);
  expect(r!.lng).toBeCloseTo(lng, 5);
};

describe('parseCoords: tìm bằng toạ độ', () => {
  it.each([
    ['(11.0617600, 106.5296330)', 11.06176, 106.529633],
    ['11.0617600, 106.5296330', 11.06176, 106.529633],
    ['11.06176 106.529633', 11.06176, 106.529633],
    ['11.06176;106.529633', 11.06176, 106.529633],
    ['11,06176 106,529633', 11.06176, 106.529633], // dấu phẩy thập phân kiểu Việt
    ['11,06176; 106,529633', 11.06176, 106.529633],
    ['10.7698,106.7', 10.7698, 106.7],
    ['N 10.7698 E 106.7', 10.7698, 106.7],
  ])('%s', (q, lat, lng) => near(parseCoords(q), lat, lng));

  it('đảo thứ tự kinh độ, vĩ độ (Việt Nam) → tự sửa', () => {
    near(parseCoords('106.529633, 11.06176'), 11.06176, 106.529633);
  });
  it('độ phút giây (DMS) kiểu Google Maps', () => {
    near(parseCoords(`11°03'42.3"N 106°31'46.7"E`), 11 + 3 / 60 + 42.3 / 3600, 106 + 31 / 60 + 46.7 / 3600);
    near(parseCoords('10°46\'11.3"N, 106°42\'00.0"E'), 10 + 46 / 60 + 11.3 / 3600, 106.7);
  });
  it('độ phút thập phân', () => {
    near(parseCoords(`10°46.188'N 106°42.000'E`), 10 + 46.188 / 60, 106.7);
  });
  it('dán link Google Maps / OSM', () => {
    near(parseCoords('https://www.google.com/maps?q=10.771234,106.701234'), 10.771234, 106.701234);
    near(parseCoords('https://www.google.com/maps/place/X/@10.7712,106.7012,17z/data=!3m1'), 10.7712, 106.7012);
    near(parseCoords('https://www.openstreetmap.org/#map=17/10.77120/106.70120'), 10.7712, 106.7012);
    near(parseCoords('geo:10.7712,106.7012'), 10.7712, 106.7012);
  });
  it('không phải toạ độ → null', () => {
    expect(parseCoords('Chợ Bến Thành')).toBeNull();
    expect(parseCoords('Liên khu 16-18')).toBeNull();
    expect(parseCoords('63/23A Liên Khu 16-18')).toBeNull();
    expect(parseCoords('123')).toBeNull();
    expect(parseCoords('Quốc lộ 1, 22')).toBeNull();
    expect(parseCoords('91, 200')).toBeNull(); // ngoài phạm vi
    expect(parseCoords('16 18')).toBeNull(); // số nguyên ngắn: dễ là địa chỉ, không phải toạ độ
  });
});

import { isShortMapLink } from '../src/nav/coords';
describe('link rút gọn Google Maps', () => {
  it('nhận ra link chia sẻ từ app Google Maps', () => {
    expect(isShortMapLink('https://maps.app.goo.gl/hmmHJfi7XuAi5L3e7?g_st=ic')).toBe(true);
    expect(isShortMapLink('https://goo.gl/maps/abc')).toBe(true);
    expect(isShortMapLink('https://www.google.com/maps?q=10.7,106.7')).toBe(false);
    expect(parseCoords('https://maps.app.goo.gl/hmmHJfi7XuAi5L3e7?g_st=ic')).toBeNull();
  });
});
