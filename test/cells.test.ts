import { describe, expect, it } from 'vitest';
import { parseCell } from '../src/core/cells';

const valid = {
  v: 1,
  cell: '1077_10670',
  segments: [{ id: 'S1', a: [10.77, 106.7], b: [10.771, 106.701], maxspeed: 50 }],
  alerts: [{ id: 'C1', type: 'camera', lat: 10.7745, lng: 106.7012, dir: 90 }],
};

describe('parseCell', () => {
  it('tệp hợp lệ → đọc đủ đoạn đường và điểm cảnh báo', () => {
    const r = parseCell(valid);
    expect(r?.segments).toHaveLength(1);
    expect(r?.segments[0]).toEqual({
      id: 'S1',
      a: { lat: 10.77, lng: 106.7 },
      b: { lat: 10.771, lng: 106.701 },
      maxspeed: 50,
    });
    expect(r?.alerts).toEqual([{ id: 'C1', type: 'camera', lat: 10.7745, lng: 106.7012, dir: 90 }]);
  });

  it('không phải object / null / chuỗi → null', () => {
    expect(parseCell(null)).toBeNull();
    expect(parseCell('abc')).toBeNull();
    expect(parseCell(42)).toBeNull();
    expect(parseCell([])).toBeNull();
  });

  it('sai phiên bản định dạng → null', () => {
    expect(parseCell({ ...valid, v: 2 })).toBeNull();
    expect(parseCell({ segments: [], alerts: [] })).toBeNull();
  });

  it('thiếu mảng segments/alerts → coi như rỗng', () => {
    const r = parseCell({ v: 1, cell: 'x' });
    expect(r).toEqual({ segments: [], alerts: [] });
  });

  it('bỏ qua từng mục hỏng nhưng giữ mục tốt', () => {
    const r = parseCell({
      ...valid,
      segments: [
        valid.segments[0],
        { id: 'BAD1', a: [10.77], b: [10.771, 106.701], maxspeed: 50 },
        { id: 'BAD2', a: [999, 106.7], b: [10.771, 106.701], maxspeed: 50 },
        { a: [10.77, 106.7], b: [10.771, 106.701], maxspeed: 50 },
      ],
      alerts: [
        valid.alerts[0],
        { id: 'C2', type: 'speed-trap', lat: 10.77, lng: 106.7 },
        { id: 'C3', type: 'camera', lat: Number.NaN, lng: 106.7 },
        { id: 'C4', type: 'camera', lat: 50, lng: 106.7 },
      ],
    });
    expect(r?.segments.map((s) => s.id)).toEqual(['S1']);
    expect(r?.alerts.map((a) => a.id)).toEqual(['C1']);
  });

  it('maxspeed không phải số → giữ đoạn với maxspeed null (ẩn biển, không đoán)', () => {
    const r = parseCell({
      ...valid,
      segments: [{ id: 'S9', a: [10.77, 106.7], b: [10.771, 106.701], maxspeed: 'fast' }],
    });
    expect(r?.segments[0].maxspeed).toBeNull();
  });

  it('dir ngoài 0–360 hoặc không phải số → bỏ dir, vẫn giữ điểm cảnh báo', () => {
    const r = parseCell({
      ...valid,
      alerts: [{ id: 'C5', type: 'camera', lat: 10.77, lng: 106.7, dir: 'north' }],
    });
    expect(r?.alerts[0]).toEqual({ id: 'C5', type: 'camera', lat: 10.77, lng: 106.7 });
  });
});
