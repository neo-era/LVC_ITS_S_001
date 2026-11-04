// B1: thêm xe gắn máy (≤ 50 cc, tối đa 40 km/h) và ô tô kéo rơ moóc / xi téc / trộn bê tông (60/50 ngoài đô thị).
import { describe, expect, it } from 'vitest';
import { estimateLimit, EF_URBAN } from '../src/core/cells';
import { limitOf } from '../src/core/speedlimit';
import { COSTING, isVehicle, OUTSIDE_LIMITS, isTwoWheel, isHeavy } from '../src/core/vehicle';

const seg = (o: Partial<Parameters<typeof limitOf>[0] & object>) => ({ id: 'w1_0', a: { lat: 10, lng: 106 }, b: { lat: 10.001, lng: 106 }, maxspeed: null, ...o }) as any;

describe('loại xe mới', () => {
  it('nhận diện', () => {
    expect(isVehicle('moped')).toBe(true);
    expect(isVehicle('trailer')).toBe(true);
  });
  it('ô tô kéo rơ moóc ngoài khu đông dân cư: 60 đường đôi / 50 hai chiều', () => {
    expect(OUTSIDE_LIMITS.trailer).toEqual([60, 50]);
    expect(estimateLimit(2, 'trailer')).toBe(60);
    expect(estimateLimit(0, 'trailer')).toBe(50);
    expect(estimateLimit(EF_URBAN | 2, 'trailer')).toBe(60);
  });
  it('xe gắn máy: tối đa 40 ở mọi nơi, kể cả biển cho phép cao hơn', () => {
    expect(estimateLimit(2, 'moped')).toBe(40);
    expect(estimateLimit(EF_URBAN, 'moped')).toBe(40);
    expect(limitOf(seg({ maxspeed: 60 }), 'moped')).toMatchObject({ kmh: 40, estimated: false });
    expect(limitOf(seg({ maxspeed: 30 }), 'moped')).toMatchObject({ kmh: 30 });
    expect(limitOf(seg({ maxspeed: 50, carLane: 60 }), 'moped')).toMatchObject({ kmh: 40 });
    expect(limitOf(seg({ ef: 2 }), 'moped')).toMatchObject({ kmh: 40, estimated: true });
  });
  it('xe gắn máy theo làn hỗn hợp, không theo làn ô tô', () => {
    expect(limitOf(seg({ maxspeed: 50, carLane: 60 }), 'motorbike')).toMatchObject({ kmh: 50 });
  });
  it('tìm đường & nhóm xe', () => {
    expect(COSTING.moped).toBe('motor_scooter');
    expect(COSTING.trailer).toBe('truck');
    expect(isTwoWheel('moped') && isTwoWheel('motorbike') && !isTwoWheel('car')).toBe(true);
    expect(isHeavy('trailer') && isHeavy('truck') && isHeavy('bus') && !isHeavy('car')).toBe(true);
  });
});
