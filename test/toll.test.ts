// B6: trạm thu phí (OSM barrier=toll_booth) — báo trước ~1 km theo chiều đi, một lần cho cụm trạm hai chiều.
import { describe, expect, it } from 'vitest';
import { convertElements } from '../src/pipeline/osm';
import { parseCell } from '../src/core/cells';
import { alertLabel, alertVoiceText } from '../src/core/format';
import { Engine } from '../src/engine';

const M = 111195;
const START = { lat: 10.5, lng: 106.9 };
const at = (s: number) => START.lat + s / M;

describe('trạm thu phí', () => {
  it('đọc từ OSM', () => {
    const r = convertElements([{ type: 'node', id: 7, lat: 10.6, lon: 106.9, tags: { barrier: 'toll_booth', name: 'Trạm Long Phước' } }]);
    expect(r.alerts).toEqual([{ id: 'n7', type: 'toll', lat: 10.6, lng: 106.9 }]);
  });
  it('tệp ô nhận loại toll', () => {
    const c = parseCell({ v: 2, cell: '1060_10690', w: [], alerts: [{ id: 'n7', type: 'toll', lat: 10.6, lng: 106.9 }] });
    expect(c!.alerts[0].type).toBe('toll');
  });
  it('lời đọc & nhãn', () => {
    expect(alertLabel('toll')).toBe('Trạm thu phí');
    expect(alertVoiceText('toll', 1000)).toBe('Phía trước 1 ki lô mét có trạm thu phí.');
  });
  it('báo ở khoảng 1 km phía trước dù bán kính cảnh báo chỉ 500 m; cụm 2 chiều chỉ báo 1 lần; đi ngược không báo', () => {
    const spoken: string[] = [];
    const e = new Engine({ radiusM: 500, speak: (t) => spoken.push(t) });
    e.loadData({
      segments: [{ id: 'S', a: { lat: at(0), lng: START.lng }, b: { lat: at(3000), lng: START.lng }, maxspeed: 80 }],
      alerts: [
        { id: 'T1', type: 'toll', lat: at(2000), lng: START.lng },
        { id: 'T2', type: 'toll', lat: at(2000), lng: START.lng + 0.0004 }, // trạm chiều ngược, cách ~45 m
      ],
    });
    let firstAt = -1;
    for (let i = 0, s = 0; s < 1990; i++, s += 20) {
      const before = spoken.length;
      e.push({ t: 1e6 + i * 1000, lat: at(s), lng: START.lng, speed: 20, accuracy: 5 }, 0);
      if (spoken.length > before && spoken.at(-1)!.includes('thu phí') && firstAt < 0) firstAt = s;
    }
    const tolls = spoken.filter((t) => t.includes('thu phí'));
    expect(tolls).toHaveLength(1);
    expect(2000 - firstAt).toBeGreaterThan(900);
    expect(2000 - firstAt).toBeLessThanOrEqual(1000);
    // đi ngược chiều, đã qua trạm → không báo
    const back: string[] = [];
    const e2 = new Engine({ radiusM: 500, speak: (t) => back.push(t) });
    e2.loadData({ segments: [], alerts: [{ id: 'T1', type: 'toll', lat: at(2000), lng: START.lng }] });
    for (let i = 0, s = 2100; s < 3000; i++, s += 20) e2.push({ t: 1e6 + i * 1000, lat: at(s), lng: START.lng, speed: 20, accuracy: 5 }, 0);
    expect(back.filter((t) => t.includes('thu phí'))).toHaveLength(0);
  });
});
