import { describe, expect, it } from 'vitest';
import { stampSw, updateAction } from '../src/update';

describe('updateAction', () => {
  it('chưa có bản mới → không làm gì', () => {
    expect(updateAction(false, 'idle')).toBe('none');
  });
  it('có bản mới khi chưa chạy xe → tải lại ngay', () => {
    expect(updateAction(true, 'idle')).toBe('reload');
  });
  it('có bản mới khi đang chạy/mô phỏng → hỏi, không tự tải lại', () => {
    expect(updateAction(true, 'gps')).toBe('prompt');
    expect(updateAction(true, 'sim')).toBe('prompt');
  });
});

describe('stampSw', () => {
  it('gắn mã bản dựng vào VERSION để mỗi lần đăng trang service worker đổi nội dung', () => {
    const src = "const VERSION = 'lat-v5';\nconst SHELL = VERSION + '-shell';";
    const out = stampSw(src, 'abc123');
    expect(out).toContain("const VERSION = 'lat-v5-abc123';");
    expect(out).toContain("const SHELL = VERSION + '-shell';");
  });
  it('không tìm thấy dòng VERSION → báo lỗi (tránh âm thầm mất tự cập nhật)', () => {
    expect(() => stampSw('console.log(1)', 'x')).toThrow();
  });
});
