import { describe, expect, it } from 'vitest';
import { parseCell } from '../src/core/cells';
import { findLimit, type RoadSegment } from '../src/core/speedlimit';
import { CellWriter, URBAN_KM, wayFlags, FLAG } from '../src/pipeline/compact';
import { Engine } from '../src/engine';

const M = 111195;

describe('wayFlags', () => {
  it('đường đôi: một chiều có ≥2 làn, hoặc một chiều trên trục chính chưa ghi số làn', () => {
    expect(wayFlags({ highway: 'primary', oneway: 'yes', lanes: '2' }) & FLAG.divided).toBeTruthy();
    expect(wayFlags({ highway: 'trunk', oneway: 'yes' }) & FLAG.divided).toBeTruthy();
    expect(wayFlags({ highway: 'tertiary', oneway: 'yes' }) & FLAG.divided).toBeFalsy();
    expect(wayFlags({ highway: 'primary', oneway: 'yes', lanes: '1' }) & FLAG.divided).toBeFalsy();
    expect(wayFlags({ highway: 'primary' }) & FLAG.divided).toBeFalsy();
  });
  it('cao tốc không ước tính; đường nhỏ đánh dấu minor', () => {
    expect(wayFlags({ highway: 'motorway' }) & FLAG.noEstimate).toBeTruthy();
    expect(wayFlags({ highway: 'motorway_link' }) & FLAG.noEstimate).toBeTruthy();
    expect(wayFlags({ highway: 'residential' }) & FLAG.minor).toBeTruthy();
    expect(wayFlags({ highway: 'primary' }) & FLAG.minor).toBeFalsy();
  });
});

/** Ô có nhiều đường (đô thị) hay ít đường (ngoài khu dân cư). */
function cellWith(extraKm: number, tags: Record<string, string>, maxspeed: number | null) {
  const w = new CellWriter();
  const base = { lat: 10.7705, lng: 106.7005 };
  w.addWay(1, [base, { lat: base.lat + 300 / M, lng: base.lng }], maxspeed, wayFlags(tags));
  // thêm đường để tăng mật độ (các đường song song trong cùng ô)
  const n = Math.ceil((extraKm * 1000) / 600);
  for (let i = 0; i < n; i++) {
    const lng = 106.7008 + i * 0.00008;
    w.addWay(100 + i, [{ lat: 10.7702, lng }, { lat: 10.7702 + 600 / M, lng }], null, wayFlags({ highway: 'residential' }));
  }
  const files = [...w.files().values()];
  const f = files.find((x) => x.w.some((e) => e[0] === 1))!;
  return parseCell(JSON.parse(JSON.stringify(f)))!.segments.find((s) => s.id === 'w1_0')!;
}

describe('ước tính giới hạn theo luật (VBHN 74/2026/VBHN-BXD)', () => {
  it('ô đô thị: hai chiều 50, đường đôi 60', () => {
    expect(cellWith(URBAN_KM + 2, { highway: 'primary' }, null).est).toBe(50);
    expect(cellWith(URBAN_KM + 2, { highway: 'primary', oneway: 'yes', lanes: '3' }, null).est).toBe(60);
  });
  it('ngoài khu dân cư: hai chiều 80, đường đôi 90; đường nhỏ không ước tính', () => {
    expect(cellWith(0, { highway: 'primary' }, null).est).toBe(80);
    expect(cellWith(0, { highway: 'trunk', oneway: 'yes' }, null).est).toBe(90);
    expect(cellWith(0, { highway: 'residential' }, null).est).toBeUndefined();
  });
  it('đường nhỏ trong đô thị vẫn ước tính 50', () => {
    expect(cellWith(URBAN_KM + 2, { highway: 'residential' }, null).est).toBe(50);
  });
  it('cao tốc không ước tính', () => {
    expect(cellWith(0, { highway: 'motorway' }, null).est).toBeUndefined();
  });
  it('có số thật thì giữ số thật', () => {
    const s = cellWith(URBAN_KM + 2, { highway: 'primary' }, 40);
    expect(s.maxspeed).toBe(40);
  });
});

describe('findLimit dùng ước tính khi thiếu số thật', () => {
  const seg = (maxspeed: number | null, est?: number): RoadSegment => ({
    id: 'a', a: { lat: 10, lng: 106 }, b: { lat: 10, lng: 106.01 }, maxspeed, ...(est ? { est } : {}),
  });
  const pos = { lat: 10.0001, lng: 106.005 };
  it('thiếu số thật, có ước tính → trả ước tính kèm cờ estimated', () => {
    expect(findLimit([seg(null, 50)], pos, null)).toMatchObject({ kmh: 50, estimated: true });
  });
  it('có số thật → estimated false', () => {
    expect(findLimit([seg(60, 50)], pos, null)).toMatchObject({ kmh: 60, estimated: false });
  });
  it('không có cả hai → null', () => {
    expect(findLimit([seg(null)], pos, null)).toBeNull();
  });
});

describe('Engine với giới hạn ước tính', () => {
  it('hiện giới hạn kèm limitEstimated, đổi màu khi vượt nhưng KHÔNG đọc cảnh báo vượt tốc độ', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 500, speak: (t) => spoken.push(t) });
    const lat0 = 10.77;
    e.loadData({
      segments: [{ id: 'S', a: { lat: lat0, lng: 106.7 }, b: { lat: lat0 + 1000 / M, lng: 106.7 }, maxspeed: null, est: 50 }],
      alerts: [],
    });
    let v = e.view();
    for (let i = 1; i <= 20; i++) v = e.push({ t: 1_000_000 + i * 1000, lat: lat0 + (i * 17) / M, lng: 106.7, speed: 17, accuracy: 5 }, null);
    expect(v.limit).toBe(50);
    expect(v.limitEstimated).toBe(true);
    expect(v.state).toBe('over');
    expect(spoken.filter((t) => t.includes('vượt tốc độ'))).toHaveLength(0);
  });
});
