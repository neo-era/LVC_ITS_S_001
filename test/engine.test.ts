import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine';
import type { CellData } from '../src/core/cells';
import type { GpsSample } from '../src/core/gps';

const M = 111195;
const START = { lat: 10.77, lng: 106.7 };
const at = (s: number) => START.lat + s / M;

/** Đường thẳng hướng bắc 0–1200 m, giới hạn 50, có camera ở mét thứ 800. */
function data(withLimit = true): CellData {
  const segments = [];
  for (let s = 0; s < 1200; s += 400) {
    segments.push({
      id: `S${s}`,
      a: { lat: at(s), lng: START.lng },
      b: { lat: at(s + 400), lng: START.lng },
      maxspeed: withLimit ? 50 : null,
    });
  }
  return {
    segments,
    alerts: [{ id: 'CAM', type: 'camera' as const, lat: at(800), lng: START.lng, dir: 0 }],
  };
}

const sample = (i: number, s: number, v: number, extra: Partial<GpsSample> = {}): GpsSample => ({
  t: 1_000_000 + i * 1000,
  lat: at(s),
  lng: START.lng,
  speed: v,
  accuracy: 5,
  ...extra,
});

/** Chạy xe tới quãng đường endS với tốc độ v (m/s), trả danh sách lời đọc. */
function run(engine: Engine, v: number, endS: number, startS = 0, startI = 0) {
  let s = startS;
  let i = startI;
  while (s < endS) {
    s += v;
    i++;
    engine.push(sample(i, s, v), null);
  }
  return engine.view();
}

describe('Engine', () => {
  it('chưa có dữ liệu → không có giới hạn, trạng thái unknown, không đọc gì', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 500, speak: (t) => spoken.push(t) });
    const v = run(e, 15, 300);
    expect(v.limit).toBeNull();
    expect(v.state).toBe('unknown');
    expect(spoken).toEqual([]);
  });

  it('có dữ liệu: hiện giới hạn 50 và trạng thái theo tốc độ', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    e.loadData(data());
    const v = run(e, 12, 300); // 43,2 km/h
    expect(v.limit).toBe(50);
    expect(v.state).toBe('ok');
  });

  it('báo camera đúng một lần khi vào bán kính, kèm cảnh báo hiện trên màn hình', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 500, speak: (t) => spoken.push(t) });
    e.loadData(data());
    const v = run(e, 12, 450); // còn ~350 m tới camera
    const cam = spoken.filter((t) => t.includes('camera'));
    expect(cam).toHaveLength(1);
    expect(v.alert?.type).toBe('camera');
    expect(v.alert!.distM).toBeGreaterThan(300);
    expect(v.alert!.distM).toBeLessThan(400);
  });

  it('vượt tốc độ → đọc cảnh báo đúng một lần trong 20 giây', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 500, speak: (t) => spoken.push(t) });
    e.loadData(data());
    const v = run(e, 16, 160); // ~57,6 km/h, giới hạn 50
    expect(v.state).toBe('over');
    expect(spoken.filter((t) => t.includes('vượt tốc độ'))).toHaveLength(1);
  });

  it('đã qua camera → không còn hiện cảnh báo phía trước', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    e.loadData(data());
    const v = run(e, 12, 1000);
    expect(v.alert).toBeNull();
  });

  it('mất tín hiệu (tick sau 6 giây) → lost, ẩn tốc độ, giới hạn và cảnh báo', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    e.loadData(data());
    run(e, 12, 450);
    const lastT = 1_000_000 + 38 * 1000;
    const v = e.tick(lastT + 7000);
    expect(v.status).toBe('lost');
    expect(v.kmh).toBeNull();
    expect(v.limit).toBeNull();
    expect(v.alert).toBeNull();
  });

  it('mẫu GPS hỏng (NaN) không làm hỏng trạng thái', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    e.loadData(data());
    run(e, 12, 200);
    const v = e.push(sample(99, 210, 12, { lat: Number.NaN }), null);
    expect(Number.isFinite(v.kmh ?? 0)).toBe(true);
  });

  it('đổi bán kính cảnh báo có hiệu lực ngay', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 200, speak: (t) => spoken.push(t) });
    e.loadData(data());
    run(e, 12, 450); // dừng ở mét 456, 38 mẫu; cách camera ~344 m, ngoài 200 m
    expect(spoken.filter((t) => t.includes('camera'))).toHaveLength(0);
    e.setRadius(500);
    run(e, 12, 490, 456, 38);
    expect(spoken.filter((t) => t.includes('camera'))).toHaveLength(1);
  });

  it('alertsNear: trả điểm cảnh báo trong bán kính, bỏ điểm xa', () => {
    const e = new Engine({ radiusM: 500, speak: () => {} });
    e.loadData(data());
    expect(e.alertsNear({ lat: at(700), lng: START.lng }, 300).map((a) => a.id)).toEqual(['CAM']);
    expect(e.alertsNear({ lat: at(0), lng: START.lng }, 300)).toEqual([]);
  });
});
