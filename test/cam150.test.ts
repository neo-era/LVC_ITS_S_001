// C9: camera báo ở bán kính cài đặt (vd 500 m) và nhắc lại một lần ở 150 m.
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/engine';

const M = 111195;
const at = (s: number) => 10.77 + s / M;

describe('nhắc camera ở 150 m', () => {
  it('đọc 2 lần: ~500 m và ~150 m; điểm đen không nhắc lại', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 500, speak: (t) => spoken.push(t) });
    e.loadData({
      segments: [{ id: 'S', a: { lat: at(0), lng: 106.7 }, b: { lat: at(3000), lng: 106.7 }, maxspeed: 50 }],
      alerts: [
        { id: 'CAM', type: 'camera', lat: at(1000), lng: 106.7 },
        { id: 'BS', type: 'blackspot', lat: at(2000), lng: 106.7 },
      ],
    });
    for (let i = 0, s = 0; s < 1990; i++, s += 10) e.push({ t: 1e6 + i * 1000, lat: at(s), lng: 106.7, speed: 10, accuracy: 5 }, 0);
    const cam = spoken.filter((t) => /camera/i.test(t));
    expect(cam).toHaveLength(2);
    expect(cam[1]).toBe('Camera còn 150 mét.');
    expect(spoken.filter((t) => t.includes('điểm đen'))).toHaveLength(1);
  });
});
