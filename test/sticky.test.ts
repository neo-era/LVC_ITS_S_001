/** Hai đường song song sát nhau (đường chính 60 + đường song hành/nhánh 50): biển không được nhảy qua lại. */
import { describe, expect, it } from 'vitest';
import { SegmentTracker, limitOf, type RoadSegment } from '../src/core/speedlimit';
import { Engine } from '../src/engine';

const M = 1 / 111195;
// hai đường chạy hướng bắc, cách nhau 12 m (kinh độ), chia thành đoạn 50 m
function road(way: string, dxM: number, kmh: number): RoadSegment[] {
  const out: RoadSegment[] = [];
  for (let i = 0; i < 20; i++) {
    out.push({ id: `w${way}_${i}`, a: { lat: 10.75 + i * 50 * M, lng: 106.66 + dxM * M }, b: { lat: 10.75 + (i + 1) * 50 * M, lng: 106.66 + dxM * M }, maxspeed: kmh });
  }
  return out;
}
const segs = [...road('1', 0, 60), ...road('2', 12, 50)];
// GPS dao động ±5 m quanh đường chính (lệch về phía đường song hành)
const track = Array.from({ length: 30 }, (_, i) => ({ lat: 10.75 + (20 + i * 15) * M, lng: 106.66 + (i % 2 ? 7 : 2) * M }));

describe('SegmentTracker: giữ đường đang đi', () => {
  it('GPS nhiễu giữa hai đường song song → không đổi qua lại', () => {
    const tr = new SegmentTracker();
    const limits = track.map((p) => limitOf(tr.match(segs, p, 0), 'car')?.kmh);
    expect(new Set(limits)).toEqual(new Set([60]));
  });
  it('thật sự chuyển sang đường kia (ở hẳn bên đó ≥ 3 mẫu) → đổi', () => {
    const tr = new SegmentTracker();
    tr.match(segs, track[0], 0);
    const moved = [0, 1, 2, 3].map((i) => limitOf(tr.match(segs, { lat: 10.75 + (100 + i * 15) * M, lng: 106.66 + 12 * M }, 0), 'car')?.kmh);
    expect(moved).toEqual([60, 60, 50, 50]);
  });
  it('đường cũ không còn trong 25 m (rẽ sang đường khác) → đổi ngay', () => {
    const tr = new SegmentTracker();
    tr.match(segs, track[0], 0);
    const cross: RoadSegment = { id: 'w9_0', a: { lat: 10.76, lng: 106.659 }, b: { lat: 10.76, lng: 106.662 }, maxspeed: 40 };
    expect(limitOf(tr.match([...segs, cross], { lat: 10.76, lng: 106.6615 }, 90), 'car')?.kmh).toBe(40);
  });
  it('Engine: chạy dọc đường chính với GPS nhiễu → biển luôn 60, không báo vượt 50', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 500, speak: (t) => spoken.push(t) });
    e.loadData({ segments: segs, alerts: [] });
    let t = 1_000_000;
    const lim = new Set<number | null>();
    for (const p of track) {
      t += 1000;
      lim.add(e.push({ t, lat: p.lat, lng: p.lng, speed: 52 / 3.6, accuracy: 5 }, 0).limit);
    }
    lim.delete(null);
    expect([...lim]).toEqual([60]);
    expect(spoken.filter((s) => /vượt|quá tốc/i.test(s))).toEqual([]);
  });
});
