// A11: sao lưu / khôi phục dữ liệu người dùng (điểm lưu, dấu camera, cài đặt, báo cáo…).
import { describe, expect, it } from 'vitest';
import { makeBackup, readBackup } from '../src/features/backup';

const store = (o: Record<string, string>) => ({
  keys: () => Object.keys(o),
  get: (k: string) => o[k] ?? null,
});

describe('backup', () => {
  it('vòng xuất → nhập khớp, bỏ khoá riêng của máy', () => {
    const src = { 'lat.places.v1': '[{"name":"Nhà"}]', 'lat.settings.v1': '{"radius":500}', 'lat.device': 'abc', 'lat.offline.v1': '[]', other: 'x' };
    const json = makeBackup(store(src), 1700000000000);
    const r = readBackup(json);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entries).toEqual({ 'lat.places.v1': '[{"name":"Nhà"}]', 'lat.settings.v1': '{"radius":500}' });
    expect(r.at).toBe(1700000000000);
  });
  it('tệp không đúng định dạng → báo lỗi, không ghi gì', () => {
    expect(readBackup('xin chào').ok).toBe(false);
    expect(readBackup('{"app":"khac","data":{}}').ok).toBe(false);
  });
  it('không nhận khoá lạ hay giá trị không phải chuỗi', () => {
    const r = readBackup(JSON.stringify({ app: 'lai-an-toan', v: 1, at: 1, data: { 'lat.places.v1': '[]', evil: 'x', 'lat.device': 'z', 'lat.settings.v1': 5 } }));
    expect(r.ok && r.entries).toEqual({ 'lat.places.v1': '[]' });
  });
});
