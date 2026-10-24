import { describe, expect, it } from 'vitest';
import { SpeedFilter, type GpsSample } from '../src/core/gps';

const M_PER_DEG_LAT = 111195;

/** Tạo mẫu GPS chạy thẳng hướng bắc với tốc độ v (m/s), mỗi mẫu cách 1 giây. */
function drive(i: number, v: number, extra: Partial<GpsSample> = {}): GpsSample {
  return {
    t: 1_000_000 + i * 1000,
    lat: 10 + (i * v) / M_PER_DEG_LAT,
    lng: 106,
    speed: v,
    accuracy: 5,
    ...extra,
  };
}

describe('SpeedFilter', () => {
  it('chạy đều 20 m/s → 72 km/h', () => {
    const f = new SpeedFilter();
    let r = f.push(drive(0, 20));
    for (let i = 1; i < 6; i++) r = f.push(drive(i, 20));
    expect(r.status).toBe('ok');
    expect(Math.abs((r.kmh ?? 0) - 72)).toBeLessThan(1);
  });

  it('gai nhiễu 80 m/s đột ngột bị bỏ qua', () => {
    const f = new SpeedFilter();
    for (let i = 0; i < 6; i++) f.push(drive(i, 20));
    const r = f.push(drive(6, 20, { speed: 80 }));
    expect(r.status).toBe('ok');
    expect(Math.abs((r.kmh ?? 0) - 72)).toBeLessThan(2);
  });

  it('tăng tốc hợp lý được làm mượt (không nhảy thẳng)', () => {
    const f = new SpeedFilter();
    for (let i = 0; i < 6; i++) f.push(drive(i, 20));
    const r = f.push(drive(6, 20, { speed: 25 }));
    expect(r.kmh).toBeGreaterThan(72);
    expect(r.kmh).toBeLessThan(90);
  });

  it('độ chính xác kém (> 50 m) → trạng thái weak, giữ tốc độ cũ', () => {
    const f = new SpeedFilter();
    for (let i = 0; i < 6; i++) f.push(drive(i, 20));
    const r = f.push(drive(6, 20, { accuracy: 80, speed: 5 }));
    expect(r.status).toBe('weak');
    expect(Math.abs((r.kmh ?? 0) - 72)).toBeLessThan(1);
  });

  it('nhiễu khi đứng yên (< 1,5 km/h) → 0', () => {
    const f = new SpeedFilter();
    let r = f.push(drive(0, 0.3, { lat: 10 }));
    r = f.push(drive(1, 0.3, { lat: 10 }));
    r = f.push(drive(2, 0.3, { lat: 10 }));
    expect(r.kmh).toBe(0);
  });

  it('thiếu speed → suy ra từ vị trí (≈ 72 km/h)', () => {
    const f = new SpeedFilter();
    let r = f.push(drive(0, 20, { speed: null }));
    for (let i = 1; i < 6; i++) r = f.push(drive(i, 20, { speed: null }));
    expect(Math.abs((r.kmh ?? 0) - 72)).toBeLessThan(4);
  });

  it('mẫu đầu tiên chưa có tốc độ → kmh null, không phải số bịa', () => {
    const f = new SpeedFilter();
    const r = f.push(drive(0, 20, { speed: null }));
    expect(r.kmh).toBeNull();
  });

  it('mất tín hiệu: > 5 giây không có mẫu → lost, kmh null', () => {
    const f = new SpeedFilter();
    for (let i = 0; i < 6; i++) f.push(drive(i, 20));
    const last = drive(5, 20).t;
    expect(f.statusAt(last + 2000).status).toBe('ok');
    const lost = f.statusAt(last + 6000);
    expect(lost.status).toBe('lost');
    expect(lost.kmh).toBeNull();
  });

  it('mẫu có thời gian lùi hoặc trùng được bỏ qua, không NaN', () => {
    const f = new SpeedFilter();
    for (let i = 0; i < 4; i++) f.push(drive(i, 20));
    const r = f.push(drive(2, 20));
    expect(Number.isFinite(r.kmh ?? 0)).toBe(true);
  });

  it('toạ độ không hợp lệ (NaN) bị bỏ qua', () => {
    const f = new SpeedFilter();
    for (let i = 0; i < 4; i++) f.push(drive(i, 20));
    const r = f.push(drive(4, 20, { lat: Number.NaN }));
    expect(Number.isFinite(r.kmh ?? 0)).toBe(true);
  });
});
