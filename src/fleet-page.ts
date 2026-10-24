import './styles.css';
import { fleetFresh, isTeamCode } from './features/fleet';
import { fmtVnTime } from './features/reports';
import { STYLE_URLS } from './map-data';
import { authHeaders, SUPABASE_URL } from './sync';

interface Row {
  device: string;
  name: string | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  updated_at: string;
}

const $ = (id: string) => document.getElementById(id)!;
const input = $('team') as HTMLInputElement;
const msg = (t: string): void => {
  $('fleet-msg').textContent = t;
};
const safeHash = (): string => {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return '';
  }
};
let team = safeHash() || (() => {
  try {
    return localStorage.getItem('lat.fleet.team') ?? '';
  } catch {
    return '';
  }
})();
input.value = team;

type ML = typeof import('maplibre-gl');
let ml: ML | null = null;
let map: import('maplibre-gl').Map | null = null;
const markers = new Map<string, import('maplibre-gl').Marker>();
let fitted = false;

async function ensureMap(): Promise<void> {
  if (map) return;
  ml = (await import('maplibre-gl')).default as unknown as ML;
  await import('maplibre-gl/dist/maplibre-gl.css');
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  map = new ml.Map({ container: 'fleet-map', style: dark ? STYLE_URLS.dark : STYLE_URLS.light, center: [106.7, 10.78], zoom: 11 });
}

let loading = false;
async function load(): Promise<void> {
  if (!isTeamCode(team)) return msg('Mã đội cần ít nhất 8 ký tự (chữ, số, dấu gạch).');
  if (loading || document.hidden) return;
  loading = true;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fleet_list`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ p_team: team }),
    });
    if (!r.ok) throw new Error(`mã ${r.status}`);
    const rows = (await r.json()) as Row[];
    await ensureMap();
    render(rows);
    msg(`${rows.length} xe · cập nhật lúc ${fmtVnTime(Date.now()).slice(11)}`);
  } catch (e) {
    msg(`Chưa tải được (${(e as Error).message}). Kiểm tra mạng hoặc đã chạy file SQL trên Supabase chưa.`);
  } finally {
    loading = false;
  }
}
document.addEventListener('visibilitychange', () => !document.hidden && team && void load());

function render(rows: Row[]): void {
  if (!map || !ml) return;
  const now = Date.now();
  const seen = new Set<string>();
  for (const r of rows) {
    seen.add(r.device);
    const live = fleetFresh(r.updated_at, now) === 'live';
    let m = markers.get(r.device);
    if (!m) {
      const el = document.createElement('div');
      el.className = 'fleet-marker';
      m = new ml.Marker({ element: el }).setLngLat([r.lng, r.lat]).addTo(map);
      markers.set(r.device, m);
    }
    m.setLngLat([r.lng, r.lat]);
    const el = m.getElement();
    el.classList.toggle('stale', !live);
    el.textContent = r.name ?? r.device;
  }
  for (const [d, m] of markers) if (!seen.has(d)) (m.remove(), markers.delete(d));
  if (!fitted && rows.length) {
    const b = new ml.LngLatBounds();
    rows.forEach((r) => b.extend([r.lng, r.lat]));
    map.fitBounds(b, { padding: 60, maxZoom: 15, duration: 0 });
    fitted = true;
  }
  $('fleet-list').replaceChildren(
    ...rows.map((r) => {
      const li = document.createElement('li');
      const live = fleetFresh(r.updated_at, now) === 'live';
      li.className = `off-row${live ? '' : ' stale'}`;
      const d = document.createElement('div');
      d.className = 'off-name';
      d.textContent = r.name ?? r.device;
      const sm = document.createElement('small');
      sm.textContent = `${live ? '● đang chạy' : '○ không hoạt động'} · ${r.speed ?? 0} km/h · ${fmtVnTime(Date.parse(r.updated_at)).slice(11)}`;
      d.append(sm);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'del';
      b.textContent = 'Xem';
      b.addEventListener('click', () => map?.flyTo({ center: [r.lng, r.lat], zoom: 16 }));
      li.append(d, b);
      return li;
    }),
  );
}

$('team-form').addEventListener('submit', (e) => {
  e.preventDefault();
  team = input.value.trim();
  fitted = false;
  history.replaceState(null, '', `#${encodeURIComponent(team)}`);
  void load();
});
if (team) void load();
setInterval(() => team && void load(), 10_000);

// Nút quay lại: mở từ app → quay lại đúng trạng thái cũ; mở từ link chia sẻ → vào app.
$('fleet-back').addEventListener('click', (e) => {
  let fromApp = false;
  try {
    fromApp = !!document.referrer && new URL(document.referrer).origin === location.origin && history.length > 1;
  } catch {
    /* bỏ qua */
  }
  if (fromApp) {
    e.preventDefault();
    history.back();
  }
});
