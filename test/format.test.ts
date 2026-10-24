import { describe, expect, it } from 'vitest';
import {
  alertLabel,
  alertVoiceText,
  formatDistance,
  overspeedVoiceText,
  speakDistance,
  speedState,
} from '../src/core/format';

describe('speedState', () => {
  it('chưa biết giới hạn hoặc tốc độ → unknown', () => {
    expect(speedState(60, null)).toBe('unknown');
    expect(speedState(null, 50)).toBe('unknown');
  });
  it('dưới giới hạn xa → ok', () => {
    expect(speedState(40, 50)).toBe('ok');
  });
  it('trong 5 km/h dưới giới hạn → near', () => {
    expect(speedState(46, 50)).toBe('near');
    expect(speedState(50, 50)).toBe('near');
  });
  it('vượt giới hạn → over, tính theo số đã làm tròn hiển thị', () => {
    expect(speedState(50.4, 50)).toBe('near');
    expect(speedState(50.6, 50)).toBe('over');
    expect(speedState(58, 50)).toBe('over');
  });
});

describe('formatDistance', () => {
  it('dưới 1 km hiển thị mét, làm tròn 10 m', () => {
    expect(formatDistance(400)).toBe('400 m');
    expect(formatDistance(403)).toBe('400 m');
    expect(formatDistance(87)).toBe('90 m');
  });
  it('từ 1 km hiển thị km với dấu phẩy thập phân', () => {
    expect(formatDistance(1600)).toBe('1,6 km');
    expect(formatDistance(2149)).toBe('2,1 km');
  });
  it('giá trị không hợp lệ hoặc âm → 0 m', () => {
    expect(formatDistance(-5)).toBe('0 m');
    expect(formatDistance(Number.NaN)).toBe('0 m');
  });
});

describe('lời đọc cảnh báo', () => {
  it('speakDistance đọc bằng chữ để giọng tiếng Việt đọc đúng', () => {
    expect(speakDistance(400)).toBe('400 mét');
    expect(speakDistance(1600)).toBe('1,6 ki lô mét');
  });
  it('camera phạt nguội', () => {
    expect(alertVoiceText('camera', 400)).toBe('Phía trước 400 mét có camera phạt nguội. Chú ý tốc độ.');
  });
  it('điểm đen', () => {
    expect(alertVoiceText('blackspot', 800)).toBe('Phía trước 800 mét có điểm đen tai nạn. Chú ý quan sát.');
  });
  it('vượt tốc độ', () => {
    expect(overspeedVoiceText(50)).toBe('Bạn đang vượt tốc độ. Giới hạn 50 ki lô mét trên giờ.');
  });
  it('nhãn hiển thị', () => {
    expect(alertLabel('camera')).toBe('Camera phạt nguội');
    expect(alertLabel('blackspot')).toBe('Điểm đen tai nạn');
  });
});
