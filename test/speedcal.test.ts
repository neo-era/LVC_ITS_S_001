import { describe, expect, it } from 'vitest';
import { setSpeedCal, shownSpeed, speedCal } from '../src/core/speedcal';

describe('bù đồng hồ xe (chỉ số hiển thị)', () => {
  it('mặc định 0%: hiện đúng tốc độ GPS', () => {
    expect(shownSpeed(49.4, 0)).toBe('49');
  });
  it('+8%: GPS 49 → hiện 53 như đồng hồ xe', () => {
    expect(shownSpeed(49, 8)).toBe('53');
  });
  it('đứng yên vẫn 0; chưa có tốc độ → --', () => {
    expect(shownSpeed(0, 10)).toBe('0');
    expect(shownSpeed(null, 10)).toBe('--');
  });
  it('chỉ nhận các mức cho phép', () => {
    setSpeedCal(8);
    expect(speedCal()).toBe(8);
    setSpeedCal(37);
    expect(speedCal()).toBe(0);
  });
});
