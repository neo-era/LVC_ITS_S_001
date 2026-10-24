import { describe, expect, it } from 'vitest';
import { parseCell } from '../src/core/cells';
import { bucketCells, convertElements, parseMaxspeed, type OverpassElement } from '../src/pipeline/osm';

describe('parseMaxspeed', () => {
  it.each([
    ['50', 50], ['60 km/h', 60], [' 40 ', 40], ['30 mph', null], ['none', null],
    ['VN:urban', null], ['signals', null], ['4', null], ['200', null], ['', null], [undefined, null],
  ])('%s → %s', (raw, want) => expect(parseMaxspeed(raw as string | undefined)).toBe(want));
});

const way = (id: number, tags: Record<string, string>, pts: [number, number][]): OverpassElement => ({
  type: 'way', id, tags, geometry: pts.map(([lat, lon]) => ({ lat, lon })),
});

describe('convertElements', () => {
  it('tách way thành các đoạn, gắn maxspeed; bỏ đường không dành cho xe', () => {
    const r = convertElements([
      way(1, { highway: 'primary', maxspeed: '50' }, [[10.77, 106.7], [10.771, 106.7], [10.772, 106.7]]),
      way(2, { highway: 'footway', maxspeed: '50' }, [[10.77, 106.7], [10.771, 106.7]]),
      way(3, { highway: 'residential' }, [[10.78, 106.7], [10.781, 106.7]]),
    ]);
    expect(r.segments.map((s) => [s.id, s.maxspeed])).toEqual([['w1_0', 50], ['w1_1', 50], ['w3_0', null]]);
  });

  it('bỏ đoạn trùng điểm và way thiếu hình học', () => {
    const r = convertElements([
      way(1, { highway: 'primary' }, [[10.77, 106.7], [10.77, 106.7]]),
      { type: 'way', id: 2, tags: { highway: 'primary' } },
    ]);
    expect(r.segments).toEqual([]);
  });

  it('camera: nhận highway=speed_camera và enforcement=maxspeed, direction số thì giữ, chữ thì bỏ', () => {
    const r = convertElements([
      { type: 'node', id: 10, lat: 10.77, lon: 106.7, tags: { highway: 'speed_camera', direction: '90' } },
      { type: 'node', id: 11, lat: 10.78, lon: 106.7, tags: { enforcement: 'maxspeed', direction: 'north' } },
      { type: 'node', id: 12, lat: 10.79, lon: 106.7, tags: { highway: 'bus_stop' } },
      { type: 'node', id: 13, lat: 10.8, lon: 106.7, tags: { highway: 'speed_camera', direction: '400' } },
    ]);
    expect(r.alerts).toEqual([
      { id: 'n10', type: 'camera', lat: 10.77, lng: 106.7, dir: 90 },
      { id: 'n11', type: 'camera', lat: 10.78, lng: 106.7 },
      { id: 'n13', type: 'camera', lat: 10.8, lng: 106.7 },
    ]);
  });
});

describe('bucketCells', () => {
  it('đoạn vắt qua hai ô nằm ở cả hai ô; camera chỉ ở ô của nó; tệp đọc lại được bằng parseCell', () => {
    const data = convertElements([
      way(1, { highway: 'primary', maxspeed: '50' }, [[10.7099, 106.7], [10.7101, 106.7]]),
      { type: 'node', id: 10, lat: 10.7099, lon: 106.7, tags: { highway: 'speed_camera' } },
    ]);
    const cells = bucketCells(data);
    expect(cells.size).toBe(2);
    const withCam = [...cells.values()].filter((c) => c.alerts.length);
    expect(withCam).toHaveLength(1);
    for (const c of cells.values()) {
      expect(c.segments).toHaveLength(1);
      const back = parseCell(JSON.parse(JSON.stringify(c)));
      expect(back?.segments[0].maxspeed).toBe(50);
    }
  });

  it('camera trùng id chỉ giữ một', () => {
    const a = { id: 'n1', type: 'camera' as const, lat: 10.77, lng: 106.7 };
    const cells = bucketCells({ segments: [], alerts: [a, a] });
    expect([...cells.values()][0].alerts).toHaveLength(1);
  });
});
