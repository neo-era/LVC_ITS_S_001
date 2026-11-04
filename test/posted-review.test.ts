// B3: biển công bố phải được rà lại trong 12 tháng; quá hạn thì không dùng (app hạ về ước tính, không đọc giọng).
import { describe, expect, it } from 'vitest';
import { matchPosted, POSTED_RULES, isStale } from '../src/pipeline/posted-limits';

const QL22 = { highway: 'trunk', ref: 'QL.22', name: 'Quốc lộ 22' };

describe('hạn rà lại biển công bố', () => {
  it('mọi mục đều có ngày rà lại hợp lệ', () => {
    for (const r of POSTED_RULES) expect(Number.isFinite(Date.parse(r.reviewed))).toBe(true);
  });
  it('trong 12 tháng → dùng; quá 12 tháng → bỏ', () => {
    const r = POSTED_RULES[0];
    const t = Date.parse(r.reviewed);
    expect(isStale(r, t + 300 * 864e5)).toBe(false);
    expect(isStale(r, t + 370 * 864e5)).toBe(true);
    expect(matchPosted(QL22, 10.872, 106.594, t + 300 * 864e5)).toEqual({ mixed: 50, car: 60 });
    expect(matchPosted(QL22, 10.872, 106.594, t + 370 * 864e5)).toBeNull();
  });
});
