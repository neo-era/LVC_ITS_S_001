import type { AlertPoint } from './core/alerts';
import { alertsToGeoJSON, STYLE_URLS } from './map-data';
import { registerLatmap } from './offline/protocol';
import type { OfflineMaps } from './offline/store';

type MapLibre = typeof import('maplibre-gl');
type MLMap = import('maplibre-gl').Map;
type MLMarker = import('maplibre-gl').Marker;

const SRC = 'alerts';
const ROUTE = 'route';

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
  private routePts: { lat: number; lng: number }[] = [];
  private last: { lat: number; lng: number; heading: number | null; kmh: number | null } | null = null;
  onFollowChange: (follow: boolean) => void = () => {};

  private static registered = false;
  private readonly styles = new Map<string, unknown>();

  constructor(
    private readonly container: HTMLElement,
    dark: boolean,
    private readonly offline: OfflineMaps | null = null,
  ) {
    this.dark = dark;
  }

  /**
   * Style tự dựng (map/style-*.json, nguồn latmap:// đọc bản đồ offline hoặc trực tuyến).
   * Chưa có (quy trình dựng bản đồ chưa chạy) → dùng style trực tuyến OpenFreeMap như trước.
   */
  private async styleFor(dark: boolean): Promise<unknown> {
    const key = dark ? 'dark' : 'light';
    if (this.styles.has(key)) return this.styles.get(key);
    let st: unknown = dark ? STYLE_URLS.dark : STYLE_URLS.light;
    if (this.offline) {
      try {
        const r = await fetch(`./map/style-${key}.json`);
        if (r.ok) {
          const j = await r.json();
          const base = new URL('./', location.href).href;
          if (typeof j.glyphs === 'string' && !/^https?:/.test(j.glyphs)) j.glyphs = base + j.glyphs;
          if (typeof j.sprite === 'string' && !/^https?:/.test(j.sprite)) j.sprite = base + j.sprite;
          if (Array.isArray(j.sprite)) for (const sp of j.sprite) if (!/^https?:/.test(sp.url)) sp.url = base + sp.url;
          this.styles.set(key, j); // chỉ nhớ style tự dựng; bản dự phòng trực tuyến thì lần sau thử lại
          return j;
        }
      } catch {
        /* giữ style trực tuyến */
      }
    }
    return st;
  }

  async init(center: { lat: number; lng: number }): Promise<void> {
    const ml = (await import('maplibre-gl')).default as unknown as MapLibre;
    await import('maplibre-gl/dist/maplibre-gl.css');
    this.ml = ml;
    if (this.offline && !MapView.registered) {
      registerLatmap(ml, this.offline);
      MapView.registered = true;
    }
    const map = new ml.Map({
      container: this.container,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      style: (await this.styleFor(this.dark)) as any,
      center: [center.lng, center.lat],
      zoom: 16,
      attributionControl: { compact: true },
      interactive: false,
    });
    this.map = map;
    map.on('error', (e) => {
      // Style chính lỗi (mạng, URL) → thử style dự phòng một lần.
      const msg = String((e as { error?: unknown }).error ?? '');
      const usingOwn = [...this.styles.values()].length > 0; // style tự dựng (latmap) không đổi sang trực tuyến
      if (
        !usingOwn &&
        navigator.onLine &&
        !this.triedFallback &&
        /style|404|Failed to fetch|NetworkError|Load failed/i.test(msg) &&
        !map.isStyleLoaded()
      ) {
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
    map.addSource(ROUTE, { type: 'geojson', data: this.routeGeoJSON() });
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: ROUTE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 10 },
    });
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: ROUTE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2563EB', 'line-width': 6 },
    });
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

  private routeGeoJSON() {
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: this.routePts.map((p) => [p.lng, p.lat]) },
    };
  }

  /** Vẽ tuyến đường dẫn (rỗng = xoá). */
  setRoute(points: { lat: number; lng: number }[]): void {
    this.routePts = points;
    (this.map?.getSource(ROUTE) as import('maplibre-gl').GeoJSONSource | undefined)?.setData(this.routeGeoJSON());
  }

  private setFollow(v: boolean): void {
    if (this.follow === v) return;
    this.follow = v;
    this.onFollowChange(v);
  }

  /** Chừa chỗ cho các thẻ nổi phía trên/dưới để xe nằm ở vùng bản đồ còn trống. */
  setPadding(p: { top: number; bottom: number; left?: number; right?: number }): void {
    this.map?.setPadding({ top: p.top, bottom: p.bottom, left: p.left ?? 0, right: p.right ?? 0 });
  }

  /** Tải lại các ô bản đồ (vd khi có mạng trở lại sau đoạn mất sóng). */
  reloadTiles(): void {
    const m = this.map;
    if (!m) return;
    for (const id of Object.keys(m.getStyle()?.sources ?? {})) {
      const src = m.getSource(id) as { type?: string; setTiles?: (t: string[]) => void; tiles?: string[] } | undefined;
      if (src?.type === 'vector' && src.setTiles && src.tiles) src.setTiles([...src.tiles]);
    }
  }

  /** Tâm bản đồ hiện tại (dùng khi chọn điểm đến). */
  center(): { lat: number; lng: number } | null {
    const c = this.map?.getCenter();
    return c ? { lat: c.lat, lng: c.lng } : null;
  }

  /** Ngừng bám theo xe (để người dùng kéo bản đồ chọn điểm). */
  stopFollow(): void {
    this.setFollow(false);
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
    void this.styleFor(dark).then((st) => {
      if (this.dark === dark) this.map?.setStyle(st as never);
    });
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
