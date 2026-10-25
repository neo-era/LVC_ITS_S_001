import { describe, expect, it } from 'vitest';
import { buildFeedback, feedbackRows, FEEDBACK_KINDS, pendingFeedback, shouldAskRating } from '../src/features/feedback';

const base = { now: 1_792_900_000_000, device: 'dev-1234567890', build: 'abc', vehicle: 'car' as const };

describe('góp ý & đánh giá', () => {
  it('cần có số sao hoặc nội dung', () => {
    expect(buildFeedback({ ...base, rating: null, kind: 'khac', text: '   ' })).toMatchObject({ ok: false });
    expect(buildFeedback({ ...base, rating: 5, kind: 'khac', text: '' })).toMatchObject({ ok: true });
    expect(buildFeedback({ ...base, rating: null, kind: 'loi', text: 'Bản đồ trắng' })).toMatchObject({ ok: true });
  });
  it('số sao chỉ 1–5; loại phải hợp lệ', () => {
    expect(buildFeedback({ ...base, rating: 7, kind: 'khac', text: 'x' })).toMatchObject({ ok: false });
    expect(buildFeedback({ ...base, rating: 4, kind: 'xyz' as never, text: 'x' })).toMatchObject({ ok: false });
    expect(Object.keys(FEEDBACK_KINDS)).toContain('sai_toc_do');
  });
  it('nội dung cắt 2000 ký tự, bỏ khoảng trắng thừa', () => {
    const r = buildFeedback({ ...base, rating: 3, kind: 'de_xuat', text: '  ' + 'a'.repeat(2500) });
    expect(r.ok && r.item.text.length).toBe(2000);
  });
  it('chỉ gửi vị trí khi người dùng cho phép; làm tròn 5 chữ số', () => {
    const at = { lat: 10.7712345678, lng: 106.7012345678 };
    const no = buildFeedback({ ...base, rating: 2, kind: 'sai_toc_do', text: 'x', at, withLocation: false });
    expect(no.ok && no.item.lat).toBeUndefined();
    const yes = buildFeedback({ ...base, rating: 2, kind: 'sai_toc_do', text: 'x', at, withLocation: true, road: { limit: 60, estimated: true, segment: 'w123_4', posted: 50 } });
    expect(yes.ok && [yes.item.lat, yes.item.lng]).toEqual([10.77123, 106.70123]);
    expect(yes.ok && yes.item.ctx).toEqual({ vehicle: 'car', limit: 60, estimated: true, segment: 'w123_4', posted: 50 });
  });
  it('dòng gửi máy chủ đúng cột; hàng chờ chỉ lấy mục chưa gửi', () => {
    const r = buildFeedback({ ...base, rating: 5, kind: 'khac', text: 'Tốt' });
    if (!r.ok) throw new Error();
    const rows = feedbackRows([r.item]);
    expect(Object.keys(rows[0]).sort()).toEqual(['app_build', 'ctx', 'device', 'id', 'kind', 'lat', 'lng', 'rating', 't_client', 'text'].sort());
    expect(pendingFeedback([r.item, { ...r.item, id: 'x', synced: true }])).toHaveLength(1);
  });
  it('mời đánh giá một lần sau chuyến đi thứ 3', () => {
    expect(shouldAskRating(2, false)).toBe(false);
    expect(shouldAskRating(3, false)).toBe(true);
    expect(shouldAskRating(8, true)).toBe(false);
  });
});
