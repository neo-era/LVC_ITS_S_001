import { describe, expect, it } from 'vitest';
import { findLimit, type RoadSegment } from '../src/core/speedlimit';

const eastWest = (id: string, lat: number, maxspeed: number | null): RoadSegment => ({
  id,
  a: { lat, lng: 106 },
  b: { lat, lng: 106.01 },
  maxspeed,
});

describe('findLimit', () => {
  it('điểm cách đoạn ~11 m → trả giới hạn của đoạn', () => {
    const r = findLimit([eastWest('S1', 10, 50)], { lat: 10.0001, lng: 106.005 }, 90);
    expect(r?.kmh).toBe(50);
    expect(r?.segmentId).toBe('S1');
    expect(r!.distM).toBeLessThan(15);
  });

  it('không có đoạn nào trong 25 m → null (ẩn biển)', () => {
    const r = findLimit([eastWest('S1', 10, 50)], { lat: 10.002, lng: 106.005 }, 90);
    expect(r).toBeNull();
  });

  it('danh sách rỗng → null', () => {
    expect(findLimit([], { lat: 10, lng: 106 }, 0)).toBeNull();
  });

  it('ngã tư: chọn đường theo hướng đang chạy', () => {
    const ew = eastWest('EW', 10, 50);
    const ns: RoadSegment = {
      id: 'NS',
      a: { lat: 9.995, lng: 106.005 },
      b: { lat: 10.005, lng: 106.005 },
      maxspeed: 30,
    };
    const p = { lat: 10, lng: 106.005 };
    expect(findLimit([ew, ns], p, 90)?.kmh).toBe(50);
    expect(findLimit([ew, ns], p, 0)?.kmh).toBe(30);
    expect(findLimit([ew, ns], p, 270)?.kmh).toBe(50);
    expect(findLimit([ew, ns], p, 180)?.kmh).toBe(30);
  });

  it('đoạn gần nhất không có maxspeed → null, không mượn đoạn xa hơn', () => {
    const near = eastWest('S4', 9.99985, null);
    const far = eastWest('S1', 10, 50);
    const r = findLimit([far, near], { lat: 9.9999, lng: 106.005 }, 90);
    expect(r).toBeNull();
  });

  it('maxspeed không hợp lệ (0, âm, > 150) bị coi như không có dữ liệu', () => {
    const p = { lat: 10.00005, lng: 106.005 };
    expect(findLimit([eastWest('A', 10, 0)], p, 90)).toBeNull();
    expect(findLimit([eastWest('A', 10, -10)], p, 90)).toBeNull();
    expect(findLimit([eastWest('A', 10, 500)], p, 90)).toBeNull();
  });

  it('heading null vẫn trả kết quả theo khoảng cách', () => {
    const r = findLimit([eastWest('S1', 10, 50)], { lat: 10.0001, lng: 106.005 }, null);
    expect(r?.kmh).toBe(50);
  });
});
