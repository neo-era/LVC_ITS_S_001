/** Nhiều lộ trình thay thế + không kẹt ở "đang tìm đường mới". */
import { describe, expect, it } from 'vitest';
import { buildRouteBody, parseValhallaAll, routeLabel } from '../src/nav/route';
import { Guidance } from '../src/nav/guidance';
import { encodePolyline } from '../src/nav/polyline';

const M = 111195;
const BASE = { lat: 10.77, lng: 106.7 };
const north = (m: number, east = 0) => ({ lat: BASE.lat + m / M, lng: BASE.lng + east / M });
const trip = (pts: { lat: number; lng: number }[], km: number, s: number) => ({
  summary: { length: km, time: s },
  legs: [
    {
      shape: encodePolyline(pts, 6),
      maneuvers: [
        { type: 1, instruction: 'Đi.', begin_shape_index: 0, length: km, time: s },
        { type: 4, instruction: 'Đến nơi.', begin_shape_index: pts.length - 1, length: 0, time: 0 },
      ],
    },
  ],
});

describe('lộ trình thay thế', () => {
  it('yêu cầu máy chủ trả thêm tuyến khác', () => {
    expect(JSON.parse(buildRouteBody(north(0), north(1000), 'car', 2)).alternates).toBe(2);
    expect(JSON.parse(buildRouteBody(north(0), north(1000))).alternates).toBeUndefined();
  });
  it('đọc tuyến chính + các tuyến thay thế; bỏ tuyến hỏng', () => {
    const raw = {
      trip: trip([north(0), north(1000)], 1.0, 120),
      alternates: [{ trip: trip([north(0), north(500, 300), north(1000)], 1.3, 150) }, { trip: { legs: [] } }],
    };
    const all = parseValhallaAll(raw);
    expect(all).toHaveLength(2);
    expect(all[1].distM).toBe(1300);
  });
  it('nhãn so sánh với tuyến nhanh nhất', () => {
    const a = { points: [], maneuvers: [], distM: 12300, durS: 25 * 60 };
    const b = { points: [], maneuvers: [], distM: 10800, durS: 28 * 60 };
    expect(routeLabel(a, a)).toBe('Nhanh nhất · 12,3 km · 25 phút');
    expect(routeLabel(b, a)).toBe('10,8 km · 28 phút (+3 phút)');
  });
});

describe('lệch tuyến không bị kẹt', () => {
  it('vẫn lệch sau lần tìm lại không thành → nhắc tìm lại định kỳ', () => {
    const raw = { trip: trip([north(0), north(1000)], 1.0, 120) };
    const r = parseValhallaAll(raw)[0];
    let calls = 0;
    const g = new Guidance(r, () => {}, () => calls++);
    g.update({ ...north(100), t: 1e6 });
    for (let i = 1; i <= 30; i++) g.update({ ...north(120, 150), t: 1e6 + i * 1000 });
    expect(calls).toBeGreaterThanOrEqual(3); // lần đầu + nhắc lại mỗi 10 mẫu
  });
});
