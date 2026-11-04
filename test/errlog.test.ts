// A10: nhật ký lỗi gọn, không chứa toạ độ, đính kèm khi báo lỗi app.
import { describe, expect, it } from 'vitest';
import { addError, cleanError, errorsForReport } from '../src/features/errlog';
import { buildFeedback } from '../src/features/feedback';

describe('errlog', () => {
  it('xoá toạ độ và giới hạn độ dài', () => {
    const s = cleanError('TypeError: x at 10.85123,106.58321 ' + 'a'.repeat(500));
    expect(s).not.toMatch(/10\.85|106\.58/);
    expect(s.length).toBeLessThanOrEqual(200);
  });
  it('giữ tối đa 20 lỗi, lỗi trùng liền nhau chỉ tăng đếm', () => {
    let list = addError([], 'A', 1);
    list = addError(list, 'A', 2);
    expect(list).toHaveLength(1);
    expect(list[0].n).toBe(2);
    for (let i = 0; i < 30; i++) list = addError(list, 'E' + i, 10 + i);
    expect(list).toHaveLength(20);
    expect(list.at(-1)!.m).toBe('E29');
  });
  it('đính kèm tối đa 5 lỗi gần nhất vào góp ý loại "Lỗi app"', () => {
    let list: ReturnType<typeof addError> = [];
    for (let i = 0; i < 8; i++) list = addError(list, 'E' + i, i);
    const errs = errorsForReport(list);
    expect(errs).toHaveLength(5);
    const r = buildFeedback({ rating: null, kind: 'loi', text: 'treo', now: 1, device: 'd', build: 'b', vehicle: 'car', errors: errs });
    expect(r.ok && (r.item.ctx.errors as string[]).length).toBe(5);
    const r2 = buildFeedback({ rating: 5, kind: 'de_xuat', text: '', now: 1, device: 'd', build: 'b', vehicle: 'car', errors: errs });
    expect(r2.ok && r2.item.ctx.errors).toBeUndefined();
  });
});
