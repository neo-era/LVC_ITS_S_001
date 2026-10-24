import { describe, expect, it } from 'vitest';
import { parseCell } from '../src/core/cells';
import { cellKey } from '../src/core/geo';
import { CellWriter, simplify, splitWay } from '../src/pipeline/compact';

const M = 111195;
const P = (n: number, e = 0) => ({ lat: 10.77 + n / M, lng: 106.7 + e / M });

describe('simplify (Douglas–Peucker)', () => {
  it('giữ hai đầu, bỏ điểm gần như thẳng hàng, giữ điểm gãy rõ', () => {
    const pts = [P(0), P(100, 0.5), P(200), P(300, 50), P(400)];
    const s = simplify(pts, 2);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[4]);
    expect(s).not.toContainEqual(pts[1]);
    expect(s).toContainEqual(pts[3]);
  });
  it('ít hơn 3 điểm → giữ nguyên', () => {
    expect(simplify([P(0), P(10)], 2)).toHaveLength(2);
  });
});

describe('splitWay', () => {
  it('way nằm gọn trong một ô → một đoạn chạy từ chỉ số 0', () => {
    const runs = splitWay([P(0), P(100), P(200)]);
    expect(runs.size).toBe(1);
    const [[key, list]] = [...runs];
    expect(key).toBe(cellKey(P(0).lat, P(0).lng));
    expect(list).toEqual([{ start: 0, end: 2 }]);
  });
  it('way vắt qua ranh ô → mỗi ô có đoạn chạy riêng, đoạn ở ranh nằm ở cả hai ô', () => {
    const pts = [{ lat: 10.705, lng: 106.7 }, { lat: 10.709, lng: 106.7 }, { lat: 10.711, lng: 106.7 }, { lat: 10.715, lng: 106.7 }];
    const runs = splitWay(pts);
    expect(runs.get(cellKey(10.705, 106.7))).toEqual([{ start: 0, end: 2 }]);
    expect(runs.get(cellKey(10.715, 106.7))).toEqual([{ start: 1, end: 3 }]);
  });
});

describe('CellWriter → parseCell v2', () => {
  it('đọc lại cho ra đúng các đoạn (id như v1, toạ độ sai < 1,2 m, maxspeed, cờ cam)', () => {
    const w = new CellWriter();
    const pts = [P(0), P(150, 20), P(300)];
    w.addWay(123, pts, 50, true);
    w.addWay(124, [P(0, 40), P(100, 40)], null, false);
    w.addAlert({ id: 'n9', type: 'camera', lat: P(50).lat, lng: P(50).lng, dir: 0 });
    const files = w.files();
    expect(files.size).toBe(1);
    const [[key, file]] = [...files];
    expect(file.cell).toBe(key);
    const cell = parseCell(JSON.parse(JSON.stringify(file)))!;
    expect(cell.segments.map((s) => s.id)).toEqual(['w123_0', 'w123_1', 'w124_0']);
    const s0 = cell.segments[0];
    expect(Math.abs(s0.a.lat - pts[0].lat) * M).toBeLessThan(1.2);
    expect(Math.abs(s0.b.lng - pts[1].lng) * M).toBeLessThan(1.2);
    expect(s0.maxspeed).toBe(50);
    expect(s0.cam).toBe(true);
    expect(cell.segments[2].maxspeed).toBeNull();
    expect(cell.segments[2].cam).toBeUndefined();
    expect(cell.alerts).toEqual([{ id: 'n9', type: 'camera', lat: P(50).lat, lng: P(50).lng, dir: 0 }]);
  });
  it('đoạn chạy bắt đầu giữa way giữ đúng chỉ số trong id', () => {
    const w = new CellWriter();
    const pts = [{ lat: 10.705, lng: 106.7 }, { lat: 10.709, lng: 106.7 }, { lat: 10.711, lng: 106.7 }, { lat: 10.715, lng: 106.7 }];
    w.addWay(7, pts, 60, false);
    const f = w.files().get(cellKey(10.715, 106.7))!;
    const c = parseCell(JSON.parse(JSON.stringify(f)))!;
    expect(c.segments.map((s) => s.id)).toEqual(['w7_1', 'w7_2']);
  });
});

describe('parseCell v2: dữ liệu hỏng', () => {
  it('mục hỏng bị bỏ, mục tốt giữ; sai phiên bản → null', () => {
    const good = [1, 0, 50, 0, 1077000, 10670000, 100, 0];
    const c = parseCell({
      v: 2,
      cell: 'x',
      w: [good, [2, 0, 50, 0, 1077000], [3, 0, 50, 0, 1077000, 10670000, 100], 'rác', [4, 0, 999, 0, 1077000, 10670000, 100, 0], [5, 0, 50, 0, 0, 0, 1, 1]],
      alerts: [],
    })!;
    expect(c.segments.map((s) => s.id)).toEqual(['w1_0', 'w4_0']);
    expect(c.segments[1].maxspeed).toBeNull(); // 999 không hợp lệ → không có giới hạn
    expect(parseCell({ v: 3, w: [] })).toBeNull();
  });
});
