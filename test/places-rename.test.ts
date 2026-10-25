import { describe, expect, it } from 'vitest';
import { renamePlace, type SavedPlace } from '../src/features/places';

const L: SavedPlace[] = [
  { name: 'Điểm đã lưu 1', lat: 10.77, lng: 106.7 },
  { name: 'Toạ độ 11.061760, 106.529633', lat: 11.06176, lng: 106.529633 },
];

describe('renamePlace (đổi tên điểm lưu)', () => {
  it('đổi tên, giữ toạ độ và thứ tự', () => {
    const r = renamePlace(L, 'Toạ độ 11.061760, 106.529633', '  Công trình Củ Chi ');
    expect(r.ok).toBe(true);
    expect(r.list[1]).toEqual({ name: 'Công trình Củ Chi', lat: 11.06176, lng: 106.529633 });
    expect(r.list).toHaveLength(2);
  });
  it('tên rỗng → không đổi', () => {
    expect(renamePlace(L, 'Điểm đã lưu 1', '   ').ok).toBe(false);
  });
  it('trùng tên điểm khác (không phân biệt dấu/hoa) → báo trùng, không đổi', () => {
    const r = renamePlace(L, 'Điểm đã lưu 1', 'toa do 11.061760, 106.529633');
    expect(r).toMatchObject({ ok: false, reason: 'dup' });
    expect(r.list).toBe(L);
  });
  it('đổi hoa/thường của chính nó → được', () => {
    expect(renamePlace(L, 'Điểm đã lưu 1', 'ĐIỂM ĐÃ LƯU 1').ok).toBe(true);
  });
  it('tên quá dài bị cắt 40 ký tự', () => {
    expect(renamePlace(L, 'Điểm đã lưu 1', 'x'.repeat(60)).list[0].name).toHaveLength(40);
  });
});
