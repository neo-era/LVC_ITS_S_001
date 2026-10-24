import { describe, expect, it } from 'vitest';
import { estimateLimit, EF_URBAN } from '../src/core/cells';
import { findLimit, type RoadSegment } from '../src/core/speedlimit';
import { buildRouteBody } from '../src/nav/route';
import { VEHICLES, isVehicle } from '../src/core/vehicle';
import { Engine } from '../src/engine';

const DIV = 2;
const NOEST = 4;
const MINOR = 8;

describe('estimateLimit theo loại xe (VBHN 74/2026/VBHN-BXD)', () => {
  it('trong khu đông dân cư: mọi loại xe 60 (đường đôi) / 50', () => {
    for (const v of VEHICLES) {
      expect(estimateLimit(EF_URBAN | DIV, v)).toBe(60);
      expect(estimateLimit(EF_URBAN, v)).toBe(50);
    }
  });
  it.each([
    ['car', 90, 80],
    ['motorbike', 70, 60],
    ['truck', 80, 70],
    ['bus', 70, 60],
  ] as const)('ngoài khu dân cư, %s: %i / %i', (v, div, two) => {
    expect(estimateLimit(DIV, v)).toBe(div);
    expect(estimateLimit(0, v)).toBe(two);
  });
  it('cao tốc và đường nhỏ ngoài khu dân cư không ước tính', () => {
    expect(estimateLimit(NOEST | EF_URBAN, 'car')).toBeNull();
    expect(estimateLimit(MINOR, 'truck')).toBeNull();
    expect(estimateLimit(MINOR | EF_URBAN, 'truck')).toBe(50);
  });
});

describe('findLimit theo loại xe', () => {
  const seg: RoadSegment = { id: 'a', a: { lat: 10, lng: 106 }, b: { lat: 10, lng: 106.01 }, maxspeed: null, ef: 0 };
  const pos = { lat: 10.0001, lng: 106.005 };
  it('cùng đoạn ngoài khu dân cư: ô tô 80, xe máy 60', () => {
    expect(findLimit([seg], pos, null, 'car')?.kmh).toBe(80);
    expect(findLimit([seg], pos, null, 'motorbike')?.kmh).toBe(60);
  });
  it('có biển thật thì mọi loại xe dùng biển thật', () => {
    expect(findLimit([{ ...seg, maxspeed: 70 }], pos, null, 'motorbike')).toMatchObject({ kmh: 70, estimated: false });
  });
});

describe('tìm đường theo loại xe', () => {
  it.each([
    ['car', 'auto'],
    ['motorbike', 'motorcycle'],
    ['truck', 'truck'],
    ['bus', 'bus'],
  ] as const)('%s → costing %s', (v, c) => {
    expect(JSON.parse(buildRouteBody({ lat: 10, lng: 106 }, { lat: 10.1, lng: 106.1 }, v)).costing).toBe(c);
  });
  it('isVehicle lọc giá trị lạ', () => {
    expect(isVehicle('truck')).toBe(true);
    expect(isVehicle('tank')).toBe(false);
  });
});

describe('Engine đổi loại xe có hiệu lực ngay', () => {
  it('xe máy trên quốc lộ ngoài khu dân cư → giới hạn ước tính 60', () => {
    const M = 111195;
    const e = new Engine({ radiusM: 500, speak: () => {}, vehicle: 'car' });
    e.loadData({ segments: [{ id: 'S', a: { lat: 10.5, lng: 106.5 }, b: { lat: 10.5 + 1000 / M, lng: 106.5 }, maxspeed: null, ef: 0 }], alerts: [] });
    let v = e.view();
    for (let i = 1; i <= 5; i++) v = e.push({ t: 1000 * i, lat: 10.5 + (i * 15) / M, lng: 106.5, speed: 15, accuracy: 5 }, null);
    expect(v.limit).toBe(80);
    e.setVehicle('motorbike');
    for (let i = 6; i <= 8; i++) v = e.push({ t: 1000 * i, lat: 10.5 + (i * 15) / M, lng: 106.5, speed: 15, accuracy: 5 }, null);
    expect(v.limit).toBe(60);
  });
});
