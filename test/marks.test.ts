import { describe, expect, it } from 'vitest';
import { addMark, createMark, isDuplicate, markToAlert, parseMarks, parseRemoteMarks, removeMark, type Mark } from '../src/marks';
import { Engine } from '../src/engine';

const P = { lat: 10.77, lng: 106.7 };
const M = 111195;

describe('createMark', () => {
  it('tạo dấu với id riêng, hướng làm tròn; không có hướng thì bỏ trường dir', () => {
    const a = createMark(P, 90.4, 'camera', 1_000_000, () => 0.123456);
    expect(a.type).toBe('camera');
    expect(a.dir).toBe(90);
    expect(a.id).toMatch(/^m[0-9a-z]+$/);
    expect(createMark(P, null, 'camera', 1, () => 0.5).dir).toBeUndefined();
    expect(createMark(P, Number.NaN, 'camera', 1, () => 0.5).dir).toBeUndefined();
    expect(createMark(P, -90, 'camera', 1, () => 0.5).dir).toBe(270);
  });
});

describe('isDuplicate / addMark', () => {
  const base: Mark = { id: 'm1', type: 'camera', lat: P.lat, lng: P.lng, dir: 0, t: 1 };
  it('cùng loại, cách < 30 m, cùng hướng → trùng', () => {
    const c = { ...base, id: 'm2', lat: P.lat + 10 / M };
    expect(isDuplicate([base], c)).toBe(true);
  });
  it('xa hơn 30 m, khác loại hoặc ngược hướng → không trùng', () => {
    expect(isDuplicate([base], { ...base, id: 'm2', lat: P.lat + 60 / M })).toBe(false);
    expect(isDuplicate([base], { ...base, id: 'm2', type: 'blackspot' })).toBe(false);
    expect(isDuplicate([base], { ...base, id: 'm2', dir: 180 })).toBe(false);
  });
  it('addMark bỏ qua dấu trùng và giữ tối đa 500 dấu (bỏ dấu cũ đã đồng bộ trước)', () => {
    const r1 = addMark([base], { ...base, id: 'm2' });
    expect(r1.added).toBe(false);
    expect(r1.marks).toHaveLength(1);
    let list: Mark[] = [];
    for (let i = 0; i < 505; i++) {
      list = addMark(list, { id: `x${i}`, type: 'camera', lat: 10 + i * 0.001, lng: 106, t: i, synced: i < 100 }).marks;
    }
    expect(list).toHaveLength(500);
    expect(list.some((m) => m.id === 'x504')).toBe(true);
    expect(list.some((m) => m.id === 'x0')).toBe(false); // dấu cũ đã đồng bộ bị bỏ trước
    expect(list.some((m) => m.id === 'x100')).toBe(true); // chưa đồng bộ được giữ
  });
  it('removeMark', () => {
    expect(removeMark([base], 'm1')).toEqual([]);
    expect(removeMark([base], 'zzz')).toEqual([base]);
  });
});

describe('parseMarks', () => {
  it('giữ dấu hợp lệ, bỏ dấu hỏng (toạ độ ngoài Việt Nam, loại lạ, thiếu id)', () => {
    const r = parseMarks([
      { id: 'a', type: 'camera', lat: 10.77, lng: 106.7, dir: 45, t: 5, synced: true },
      { id: 'b', type: 'ufo', lat: 10.77, lng: 106.7, t: 5 },
      { id: 'c', type: 'camera', lat: 50, lng: 106.7, t: 5 },
      { type: 'camera', lat: 10.77, lng: 106.7, t: 5 },
      { id: 'd', type: 'blackspot', lat: 10.8, lng: 106.6, dir: 999, t: 'x' },
    ]);
    expect(r.map((m) => m.id)).toEqual(['a', 'd']);
    expect(r[0].synced).toBe(true);
    expect(r[1].dir).toBeUndefined();
  });
  it('không phải mảng → rỗng', () => {
    expect(parseMarks(null)).toEqual([]);
    expect(parseMarks('x')).toEqual([]);
  });
});

describe('parseRemoteMarks (dữ liệu từ Google Sheet đã duyệt)', () => {
  it('đổi thành điểm cảnh báo với id có tiền tố s, bỏ mục hỏng', () => {
    const a = parseRemoteMarks({
      marks: [
        { id: 'abc', type: 'camera', lat: 10.77, lng: 106.7, dir: 10 },
        { id: 'bad', type: 'camera', lat: 0, lng: 0 },
      ],
    });
    expect(a).toEqual([{ id: 'sabc', type: 'camera', lat: 10.77, lng: 106.7, dir: 10 }]);
    expect(parseRemoteMarks({})).toEqual([]);
    expect(parseRemoteMarks(null)).toEqual([]);
  });
});

describe('Engine: dấu tự đánh dấu', () => {
  it('removeAlert gỡ đúng điểm (hoàn tác)', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    const m = markToAlert({ id: 'm1', type: 'camera', lat: P.lat, lng: P.lng, t: 1 });
    e.addAlert(m);
    e.removeAlert(m);
    expect(e.alertsNear(P, 200)).toEqual([]);
  });

  it('addAlert thêm camera vào đúng ô, thay thế nếu trùng id, và hiện trong alertsNear', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    const m = markToAlert({ id: 'm1', type: 'camera', lat: P.lat, lng: P.lng, t: 1 });
    e.addAlert(m);
    e.addAlert({ ...m, lat: P.lat + 0.0001 });
    const got = e.alertsNear(P, 200);
    expect(got).toHaveLength(1);
    expect(got[0].lat).toBeCloseTo(P.lat + 0.0001, 6);
  });
});

import { approvedUrl, buildInsertRows, insertUrl, SUPABASE_URL } from '../src/sync';

describe('đồng bộ Supabase', () => {
  it('địa chỉ gửi và đọc trỏ đúng bảng; đọc chỉ lấy dấu đã duyệt, phân trang', () => {
    expect(insertUrl()).toBe(`${SUPABASE_URL}/rest/v1/lat_camera_marks?on_conflict=id`);
    const u = new URL(approvedUrl(1000, 500));
    expect(u.pathname).toBe('/rest/v1/lat_camera_marks');
    expect(u.searchParams.get('status')).toBe('eq.duyet');
    expect(u.searchParams.get('offset')).toBe('1000');
    expect(u.searchParams.get('limit')).toBe('500');
    expect(u.searchParams.get('select')).toBe('id,type,lat,lng,dir');
  });
  it('dòng gửi đi chỉ có trường cho phép, hướng thiếu thì để null, không gửi cờ synced', () => {
    const rows = buildInsertRows(
      [
        { id: 'm1', type: 'camera', lat: 10.77, lng: 106.7, dir: 90, t: 5, synced: false },
        { id: 'm2', type: 'blackspot', lat: 10.78, lng: 106.71, t: 6 },
      ],
      'dev123',
    );
    expect(rows).toEqual([
      { id: 'm1', type: 'camera', lat: 10.77, lng: 106.7, dir: 90, device: 'dev123', t_client: 5 },
      { id: 'm2', type: 'blackspot', lat: 10.78, lng: 106.71, dir: null, device: 'dev123', t_client: 6 },
    ]);
  });
  it('dòng dir=null từ máy chủ vẫn đọc được qua parseRemoteMarks', () => {
    const a = parseRemoteMarks({ marks: [{ id: 'abc', type: 'camera', lat: 10.77, lng: 106.7, dir: null }] });
    expect(a).toEqual([{ id: 'sabc', type: 'camera', lat: 10.77, lng: 106.7 }]);
  });
});
