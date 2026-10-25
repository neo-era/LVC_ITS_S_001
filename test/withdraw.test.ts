import { describe, expect, it } from 'vitest';
import { queueWithdraw, withdrawBody } from '../src/sync';

describe('rút dấu camera đã gửi lên máy chủ', () => {
  it('thân yêu cầu gồm id và mã máy', () => {
    expect(withdrawBody(['m1', 'm2'], 'dev1')).toEqual({ p_ids: ['m1', 'm2'], p_device: 'dev1' });
  });
  it('hàng chờ rút: không trùng, tối đa 200 mục mới nhất', () => {
    expect(queueWithdraw(['a'], ['a', 'b'])).toEqual(['a', 'b']);
    const big = Array.from({ length: 250 }, (_, i) => `m${i}`);
    const q = queueWithdraw([], big);
    expect(q).toHaveLength(200);
    expect(q[199]).toBe('m249');
  });
});
