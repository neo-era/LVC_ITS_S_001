import { describe, expect, it } from 'vitest';
import { alertsToGeoJSON } from '../src/map-data';

describe('alertsToGeoJSON', () => {
  it('đổi thứ tự thành [kinh độ, vĩ độ] và giữ loại cảnh báo', () => {
    const g = alertsToGeoJSON([
      { id: 'a', type: 'camera', lat: 10.77, lng: 106.7 },
      { id: 'b', type: 'blackspot', lat: 10.8, lng: 106.6 },
    ]);
    expect(g.features[0].geometry.coordinates).toEqual([106.7, 10.77]);
    expect(g.features[1].properties).toEqual({ id: 'b', kind: 'blackspot' });
  });
  it('danh sách rỗng → collection rỗng', () => {
    expect(alertsToGeoJSON([]).features).toEqual([]);
  });
});
