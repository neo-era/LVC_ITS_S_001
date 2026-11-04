// A5: chỉ lỗi dữ liệu (400/409/422) mới bỏ hẳn; 401/403/404/429/5xx gửi lại sau.
import { describe, expect, it } from 'vitest';
import { isRejected, parseReports } from '../src/features/reports';

describe('isRejected', () => {
  it('chỉ 400, 409, 422 là từ chối vĩnh viễn', () => {
    expect([400, 409, 422].map(isRejected)).toEqual([true, true, true]);
    expect([401, 403, 404, 408, 429, 500, 503].map(isRejected)).toEqual([false, false, false, false, false, false, false]);
  });
  it('báo cáo cũ bị đánh dấu từ chối mà không có mã → gửi lại', () => {
    const [a, b] = parseReports([
      { id: 'a', kind: 'den_tat', lat: 10.8, lng: 106.6, t: 1, rejected: true },
      { id: 'b', kind: 'den_tat', lat: 10.8, lng: 106.6, t: 1, rejected: true, rejectCode: 422 },
    ]);
    expect(a.rejected).toBeFalsy();
    expect(b.rejected).toBe(true);
  });
});
