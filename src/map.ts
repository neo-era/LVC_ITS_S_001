import type { AlertPoint } from './core/alerts';
import { alertsToGeoJSON, STYLE_URLS } from './map-data';

type MapLibre = typeof import('maplibre-gl');
type MLMap = import('maplibre-gl').Map;
type MLMarker = import('maplibre-gl').Marker;

const SRC = 'alerts';

/** Bản đồ nền OpenStreetMap (OpenFreeMap) + vị trí xe + camera/điểm đen. Nạp trễ để màn hình lái xe mở nhanh. */
export class MapView {
  private ml: MapLibre | null = null;
  private map: MLMap | null = null;
  private marker: MLMarker | null = null;
  private arrow: HTMLElement | null = null;
  private dark: boolean;
  private follow = true;
  private triedFallback = false;
  private alerts: AlertPoint[] = [];
  private last: { lat: number; lng: number; heading: number | null; kmh: number | null } | null = null;
  onFollowChange: (follow: boolean) => void = () => {};

  constructor(private readonly container: HTMLElement, dark: boolean) {
    this.dark = dark;
  }

  async init(center: { lat: number; lng: number }): Promise<void> {
    const ml = (await import('maplibre-gl')).default as unknown as MapLibre;
    await import('maplibre-gl/dist/maplibre-gl.css');
    this.ml = ml;
    const map = new ml.Map({
      container: this.container,
      style: this.dark ? STYLE_URLS.dark : STYLE_URLS.light,
      center: [center.lng, center.lat],
      zoom: 16,
      attributionControl: { compact: true },
      interactive: false,
    });
    this.map = map;
    map.on('error', (e) => {
      // Style chính lỗi (mạng, URL) → thử style dự phòng một lần.
      const msg = String((e as { error?: unknown }).error ?? '');
      if (!this.triedFallback && /style|404|Failed to fetch|NetworkError/i.test(msg) && !map.isStyleLoaded()) {
        this.triedFallback = true;
        map.setStyle(STYLE_URLS.fallback);
      }
    });
    new ResizeObserver(() => map.resize()).observe(this.container);
    map.on('style.load', () => this.ensureLayers());
    map.on('dragstart', () => this.setFollow(false));

    this.arrow = document.createElement('div');
    this.arrow.className = 'car-marker';
    this.arrow.innerHTML =
      '<svg viewBox="0 0 24 24" width="36" height="36" aria-hidden="true"><path d="M12 2 20 21 12 17 4 21z" fill="#3B82F6" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
    this.marker = new ml.Marker({ element: this.arrow, rotationAlignment: 'map', pitchAlignment: 'map' })
      .setLngLat([center.lng, center.lat])
      .addTo(map);
  }

  private ensureLayers(): void {
    const map = this.map;
    if (!map || map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: alertsToGeoJSON(this.alerts) });
    map.addLayer({
      id: 'alerts-halo',
      type: 'circle',
      source: SRC,
      paint: { 'circle-radius': 14, 'circle-color': '#ffffff' },
    });
    map.addLayer({
      id: 'alerts-dot',
      type: 'circle',
      source: SRC,
      paint: {
        'circle-radius': 10,
        'circle-color': ['match', ['get', 'kind'], 'camera', '#FFB020', '#E53935'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#1a1200',
      },
    });
  }

  private setFollow(v: boolean): void {
    if (this.follow === v) return;
    this.follow = v;
    this.onFollowChange(v);
  }

  recenter(): void {
    this.setFollow(true);
    if (this.last) this.move(this.last.lat, this.last.lng, this.last.heading, this.last.kmh);
  }

  /** Bật/tắt thao tác chạm (chỉ khi mở rộng toàn màn hình). */
  setInteractive(on: boolean): void {
    const m = this.map;
    if (!m) return;
    for (const h of [m.dragPan, m.touchZoomRotate, m.scrollZoom, m.doubleClickZoom]) on ? h.enable() : h.disable();
  }

  resize(): void {
    this.map?.resize();
  }

  setDark(dark: boolean): void {
    if (this.dark === dark) return;
    this.dark = dark;
    this.triedFallback = false;
    this.map?.setStyle(dark ? STYLE_URLS.dark : STYLE_URLS.light);
  }

  setAlerts(alerts: AlertPoint[]): void {
    this.alerts = alerts;
    const src = this.map?.getSource(SRC) as import('maplibre-gl').GeoJSONSource | undefined;
    src?.setData(alertsToGeoJSON(alerts));
  }

  update(lat: number, lng: number, heading: number | null, kmh: number | null): void {
    this.last = { lat, lng, heading, kmh };
    this.move(lat, lng, heading, kmh);
  }

  private move(lat: number, lng: number, heading: number | null, kmh: number | null): void {
    if (!this.map || !this.marker) return;
    this.marker.setLngLat([lng, lat]);
    const moving = heading !== null && (kmh ?? 0) > 5;
    if (moving) this.marker.setRotation(heading);
    if (this.follow) {
      this.map.easeTo({
        center: [lng, lat],
        bearing: moving ? heading : this.map.getBearing(),
        duration: 900,
        easing: (t) => t,
      });
    }
  }

  destroy(): void {
    this.map?.remove();
    this.map = null;
  }
}
