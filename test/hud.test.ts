import { describe, expect, it } from 'vitest';
import { mapHud } from '../src/hud';
import type { ViewState } from '../src/engine';

const base: ViewState = { status: 'ok', kmh: 57.6, limit: 50, limitEstimated: false, state: 'over', alert: null, upcoming: [], camRoute: false };

describe('mapHud (tốc độ + cảnh báo trên bản đồ toàn màn hình)', () => {
  it('tốc độ làm tròn, biển giới hạn, trạng thái vượt', () => {
    expect(mapHud(base)).toMatchObject({ speed: '58', limit: '50', estimated: false, state: 'over', alert: null });
  });
  it('chưa có tốc độ → "--", không có biển → limit null', () => {
    expect(mapHud({ ...base, kmh: null, limit: null, state: 'unknown' })).toMatchObject({ speed: '--', limit: null });
  });
  it('mất tín hiệu → "--" dù còn số cũ', () => {
    expect(mapHud({ ...base, status: 'lost' }).speed).toBe('--');
  });
  it('biển ước tính được đánh dấu', () => {
    expect(mapHud({ ...base, limitEstimated: true }).estimated).toBe(true);
  });
  it('cảnh báo: tiêu đề, lời nhắc và khoảng cách định dạng', () => {
    const h = mapHud({ ...base, alert: { id: 'c', type: 'camera', distM: 432 } });
    expect(h.alert).toEqual({ title: 'Camera phạt nguội', sub: 'Chú ý tốc độ', dist: '430 m', type: 'camera' });
    const b = mapHud({ ...base, alert: { id: 'b', type: 'blackspot', distM: 1640 } });
    expect(b.alert).toEqual({ title: 'Điểm đen tai nạn', sub: 'Chú ý quan sát', dist: '1,6 km', type: 'blackspot' });
  });
});
