import type { AlertPoint } from './core/alerts';

export interface AlertFeatureCollection {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; kind: 'camera' | 'blackspot' };
  }[];
}

/** Cảnh báo → GeoJSON cho lớp bản đồ (toạ độ GeoJSON là [kinh độ, vĩ độ]). */
export function alertsToGeoJSON(alerts: AlertPoint[]): AlertFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: alerts.map((a) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [a.lng, a.lat] },
      properties: { id: a.id, kind: a.type },
    })),
  };
}

export const STYLE_URLS = {
  dark: 'https://tiles.openfreemap.org/styles/dark',
  light: 'https://tiles.openfreemap.org/styles/positron',
  /** Dự phòng khi style chính không tải được. */
  fallback: 'https://tiles.openfreemap.org/styles/liberty',
} as const;
