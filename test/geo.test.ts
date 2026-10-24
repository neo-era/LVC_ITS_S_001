import { describe, expect, it } from 'vitest';
import { angleDiff, bearing, cellKey, cellsAround, distToSegment, haversine } from '../src/core/geo';

describe('haversine', () => {
  it('đo khoảng cách ~1,09 km cho 0,01° kinh độ tại TP.HCM', () => {
    const d = haversine({ lat: 10.7769, lng: 106.7009 }, { lat: 10.7769, lng: 106.7109 });
    expect(Math.abs(d - 1092)).toBeLessThan(5);
  });
  it('hai điểm trùng nhau → 0', () => {
    expect(haversine({ lat: 10, lng: 106 }, { lat: 10, lng: 106 })).toBe(0);
  });
});

describe('bearing & angleDiff', () => {
  it('hướng bắc ≈ 0°, hướng đông ≈ 90°', () => {
    expect(bearing({ lat: 10, lng: 106 }, { lat: 11, lng: 106 })).toBeCloseTo(0, 0);
    expect(Math.abs(bearing({ lat: 10, lng: 106 }, { lat: 10, lng: 107 }) - 90)).toBeLessThan(1);
  });
  it('hướng tây nằm trong 0–360 (≈ 270°)', () => {
    const b = bearing({ lat: 10, lng: 106 }, { lat: 10, lng: 105 });
    expect(b).toBeGreaterThan(269);
    expect(b).toBeLessThan(271);
  });
  it('angleDiff lấy cung ngắn, đối xứng', () => {
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(0, 180)).toBe(180);
    expect(angleDiff(90, 90)).toBe(0);
  });
});

describe('distToSegment', () => {
  const a = { lat: 10, lng: 106 };
  const b = { lat: 10, lng: 106.01 };
  it('điểm cách đoạn ~11 m về phía bắc', () => {
    const d = distToSegment({ lat: 10.0001, lng: 106.005 }, a, b);
    expect(Math.abs(d - 11.1)).toBeLessThan(1.5);
  });
  it('điểm nằm ngoài đầu đoạn → khoảng cách tới đầu mút', () => {
    const d = distToSegment({ lat: 10, lng: 106.02 }, a, b);
    expect(Math.abs(d - 1095)).toBeLessThan(6);
  });
  it('đoạn suy biến (a = b) vẫn tính được, không NaN', () => {
    const d = distToSegment({ lat: 10.0001, lng: 106 }, a, a);
    expect(Number.isFinite(d)).toBe(true);
  });
});

describe('ô lưới', () => {
  it('hai điểm gần nhau cùng ô, hai điểm xa thì khác ô', () => {
    expect(cellKey(10.7769, 106.7009)).toBe(cellKey(10.7771, 106.7011));
    expect(cellKey(10.7769, 106.7009)).not.toBe(cellKey(10.8769, 106.7009));
  });
  it('cellsAround luôn gồm ô hiện tại', () => {
    expect(cellsAround(10.7769, 106.7009, 500)).toContain(cellKey(10.7769, 106.7009));
  });
  it('điểm sát mép ô: bán kính 500 m phải gồm cả ô phía bắc', () => {
    const keys = cellsAround(10.7799, 106.7009, 500);
    expect(keys).toContain(cellKey(10.7799, 106.7009));
    expect(keys).toContain(cellKey(10.7844, 106.7009));
  });
  it('không trả ô trùng lặp', () => {
    const keys = cellsAround(10.7769, 106.7009, 1500);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
