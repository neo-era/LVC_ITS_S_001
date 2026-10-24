import { describe, expect, it } from 'vitest';
import { detectImpact, lockWindow, planRetention, type ClipFile } from '../src/core/dashcam';

const GB = 1_000_000_000;
const clip = (id: string, startedAt: number, locked = false, bytes = GB): ClipFile => ({
  id,
  bytes,
  startedAt,
  locked,
});

describe('planRetention', () => {
  it('chưa vượt dung lượng → không xoá gì', () => {
    const r = planRetention([clip('a', 1), clip('b', 2)], 5 * GB);
    expect(r.deleteIds).toEqual([]);
    expect(r.warning).toBeNull();
  });

  it('vượt dung lượng → xoá đoạn thường cũ nhất', () => {
    const files = [clip('f1', 1), clip('f2', 2), clip('f3', 3, true), clip('f4', 4)];
    const r = planRetention(files, 3.5 * GB);
    expect(r.deleteIds).toEqual(['f1']);
    expect(r.warning).toBeNull();
  });

  it('xoá theo thứ tự cũ → mới dù danh sách xáo trộn', () => {
    const files = [clip('f3', 3), clip('f1', 1), clip('f2', 2)];
    const r = planRetention(files, 1 * GB);
    expect(r.deleteIds).toEqual(['f1', 'f2']);
  });

  it('clip khoá không bao giờ bị xoá dù cũ nhất', () => {
    const files = [clip('f1', 1, true), clip('f2', 2)];
    const r = planRetention(files, 1 * GB);
    expect(r.deleteIds).toEqual(['f2']);
  });

  it('clip khoá một mình đã vượt giới hạn → xoá hết clip thường + cảnh báo', () => {
    const files = [clip('f1', 1, true, 2 * GB), clip('f2', 2, true, 2 * GB), clip('f3', 3)];
    const r = planRetention(files, 3 * GB);
    expect(r.deleteIds).toEqual(['f3']);
    expect(r.warning).toBe('locked_exceeds_limit');
  });

  it('danh sách rỗng → không lỗi', () => {
    expect(planRetention([], GB)).toEqual({ deleteIds: [], warning: null });
  });

  it('giới hạn không hợp lệ (≤ 0) → ném lỗi rõ ràng', () => {
    expect(() => planRetention([clip('a', 1)], 0)).toThrow();
    expect(() => planRetention([clip('a', 1)], Number.NaN)).toThrow();
  });
});

describe('detectImpact', () => {
  it('xe đứng yên (chỉ có trọng lực ~1 g) → không va chạm', () => {
    expect(detectImpact({ x: 0, y: 0, z: 9.81 })).toBe(false);
  });
  it('gia tốc ~3,8 g → va chạm (ngưỡng mặc định 2,5 g)', () => {
    expect(detectImpact({ x: 20, y: 20, z: 25 })).toBe(true);
  });
  it('ngưỡng tuỳ chỉnh được', () => {
    expect(detectImpact({ x: 0, y: 0, z: 30 }, 4)).toBe(false);
    expect(detectImpact({ x: 0, y: 0, z: 30 }, 3)).toBe(true);
  });
  it('giá trị NaN → false, không ném lỗi', () => {
    expect(detectImpact({ x: Number.NaN, y: 0, z: 9.81 })).toBe(false);
  });
});

describe('lockWindow', () => {
  it('giữ 15 giây trước và sau thời điểm va chạm', () => {
    expect(lockWindow(100_000)).toEqual({ from: 85_000, to: 115_000 });
  });
  it('tuỳ chỉnh được khoảng trước/sau', () => {
    expect(lockWindow(100_000, 5, 10)).toEqual({ from: 95_000, to: 110_000 });
  });
  it('không lùi về trước 0', () => {
    expect(lockWindow(3_000).from).toBe(0);
  });
});
