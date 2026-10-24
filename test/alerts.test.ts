import { describe, expect, it } from 'vitest';
import { AlertDeduper, findAlerts, type AlertPoint } from '../src/core/alerts';

const origin = { lat: 10, lng: 106 };
const cam = (id: string, lat: number, lng = 106, dir?: number): AlertPoint => ({
  id,
  type: 'camera',
  lat,
  lng,
  dir,
});

describe('findAlerts', () => {
  it('camera cách ~400 m phía trước (đi hướng bắc) → được báo', () => {
    const r = findAlerts([cam('C1', 10.0036)], origin, 0, 500);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('C1');
    expect(Math.abs(r[0].distM - 400)).toBeLessThan(5);
  });

  it('camera phía sau xe → không báo', () => {
    expect(findAlerts([cam('C1', 10.0036)], origin, 180, 500)).toHaveLength(0);
  });

  it('ngoài bán kính → không báo', () => {
    expect(findAlerts([cam('C1', 10.0036)], origin, 0, 300)).toHaveLength(0);
  });

  it('camera lệch quá 60° so với hướng đi → không báo', () => {
    const side = cam('C2', 10.0018, 106.0092);
    expect(findAlerts([side], origin, 0, 1500)).toHaveLength(0);
  });

  it('camera chỉ áp dụng một chiều (dir = 0): xe ngược chiều không bị báo', () => {
    const c = cam('C3', 10.0036, 106, 0);
    expect(findAlerts([c], origin, 0, 500)).toHaveLength(1);
    const northOfCam = { lat: 10.0072, lng: 106 };
    expect(findAlerts([c], northOfCam, 180, 500)).toHaveLength(0);
  });

  it('sắp theo khoảng cách gần → xa', () => {
    const r = findAlerts([cam('FAR', 10.004), cam('NEAR', 10.0027)], origin, 0, 500);
    expect(r.map((x) => x.id)).toEqual(['NEAR', 'FAR']);
  });

  it('heading null → chỉ xét khoảng cách (gồm cả điểm phía sau)', () => {
    expect(findAlerts([cam('C1', 10.0036)], origin, null, 500)).toHaveLength(1);
    expect(findAlerts([cam('C4', 9.9964)], origin, null, 500)).toHaveLength(1);
  });

  it('danh sách rỗng → mảng rỗng', () => {
    expect(findAlerts([], origin, 0, 500)).toEqual([]);
  });

  it('điểm đen (blackspot) được báo như camera, giữ nguyên loại', () => {
    const p: AlertPoint = { id: 'B1', type: 'blackspot', lat: 10.0036, lng: 106 };
    expect(findAlerts([p], origin, 0, 500)[0].type).toBe('blackspot');
  });
});

describe('AlertDeduper', () => {
  it('chỉ báo một lần khi tiến lại gần', () => {
    const d = new AlertDeduper(500);
    expect(d.shouldAnnounce('C1', 400)).toBe(true);
    expect(d.shouldAnnounce('C1', 350)).toBe(false);
    expect(d.shouldAnnounce('C1', 200)).toBe(false);
  });

  it('báo lại sau khi đã đi xa quá 1,5 × bán kính', () => {
    const d = new AlertDeduper(500);
    expect(d.shouldAnnounce('C1', 400)).toBe(true);
    expect(d.shouldAnnounce('C1', 900)).toBe(false);
    expect(d.shouldAnnounce('C1', 450)).toBe(true);
  });

  it('các điểm khác nhau không ảnh hưởng nhau', () => {
    const d = new AlertDeduper(500);
    expect(d.shouldAnnounce('C1', 400)).toBe(true);
    expect(d.shouldAnnounce('C2', 400)).toBe(true);
  });

  it('điểm ngoài bán kính chưa báo', () => {
    const d = new AlertDeduper(500);
    expect(d.shouldAnnounce('C1', 800)).toBe(false);
  });
});
