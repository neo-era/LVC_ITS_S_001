import './styles.css';
import { parseCell } from './core/cells';
import { alertLabel, formatDistance, speakDistance } from './core/format';
import { cellsAround } from './core/geo';
import type { GpsSample } from './core/gps';
import { Engine, type ViewState } from './engine';
import { Guidance, type NavState } from './nav/guidance';
import { searchPlaces, type Place } from './nav/geocode';
import { fetchRoute, type Route } from './nav/route';
import { MapView } from './map';
import { Simulator, simData } from './sim';
import { Voice } from './voice';

/* ---------- Cài đặt (localStorage có thể không dùng được → luôn bọc try/catch) ---------- */
interface Settings {
  radius: number;
  voice: boolean;
  theme: 'auto' | 'dark' | 'light';
}
const DEFAULTS: Settings = { radius: 500, voice: true, theme: 'auto' };
const KEY = 'lat.settings.v1';

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const radius = [300, 500, 800, 1000].includes(raw.radius) ? raw.radius : DEFAULTS.radius;
      const theme = ['auto', 'dark', 'light'].includes(raw.theme) ? raw.theme : DEFAULTS.theme;
      return { radius, theme, voice: raw.voice !== false };
    }
  } catch {
    /* bỏ qua */
  }
  return { ...DEFAULTS };
}
function saveSettings(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* bỏ qua */
  }
}
const settings = loadSettings();

/* ---------- DOM ---------- */
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`thiếu #${id}`);
  return el as T;
};
const app = $('app');
const speedNum = $('speed-num');
const limitBox = $('limit');
const limitSign = $('limit-sign');
const overBanner = $('over-banner');
const overText = $('over-text');
const alertBox = $('alert');
const alertTitle = $('alert-title');
const alertSub = $('alert-sub');
const alertDist = $('alert-dist');
const upcoming = $('upcoming');
const upcomingEmpty = $('upcoming-empty');
const dataNote = $('data-note');
const extraNote = $('extra-note');
const gpsText = $('gps-text');
const startBox = $('start');
const startError = $('start-error');
const settingsDlg = $('settings') as HTMLDialogElement;

const voice = new Voice();
voice.enabled = settings.voice;
const engine = new Engine({ radiusM: settings.radius, speak: (t) => voice.speak(t) });
const sim = new Simulator();

const mapbox = $('mapbox');
let mapView: MapView | null = null;
let mapStarting = false;
let lastMapAlertsAt = 0;

const isDark = (): boolean =>
  settings.theme === 'dark' || (settings.theme === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);

async function ensureMap(lat: number, lng: number): Promise<void> {
  if (mapView || mapStarting) return;
  mapStarting = true;
  try {
    const mv = new MapView($('map'), isDark());
    mv.onFollowChange = (f) => ($('btn-map-follow').hidden = f);
    await mv.init({ lat, lng });
    mapView = mv;
    mapbox.classList.add('live');
  } catch {
    $('map-empty').textContent = 'Không tải được bản đồ. Tốc độ và cảnh báo vẫn hoạt động.';
  } finally {
    mapStarting = false;
  }
}

function updateMap(g: GpsSample, heading: number | null, v: ViewState): void {
  void ensureMap(g.lat, g.lng);
  if (!mapView) return;
  mapView.update(g.lat, g.lng, heading, v.kmh);
  if (g.t - lastMapAlertsAt > 2000) {
    lastMapAlertsAt = g.t;
    mapView.setAlerts(engine.alertsNear({ lat: g.lat, lng: g.lng }, 2000));
  }
}

let mode: 'idle' | 'gps' | 'sim' = 'idle';
let watchId: number | null = null;
let wakeLock: WakeLockSentinel | null = null;
let tickTimer: number | null = null;

/* ---------- Dẫn đường ---------- */
const navBox = $('nav');
let lastFix: GpsSample | null = null;
let guidance: Guidance | null = null;
let navRoute: Route | null = null;
let navDest: Place | null = null;
let rerouting = false;
let lastRerouteAt = 0;

function renderNav(s: NavState | null): void {
  navBox.hidden = s === null;
  $('btn-nav').classList.toggle('active', s !== null);
  if (!s || !navRoute) return;
  $('nav-dist').textContent = s.arrived ? 'Đã đến nơi' : s.next ? formatDistance(s.distToNextM) : formatDistance(s.remainingM);
  $('nav-instr').textContent = s.offRoute ? 'Bạn đang đi lệch tuyến — đang tìm đường mới…' : s.next?.text ?? '';
  const mins = Math.max(1, Math.round(((navRoute.durS * s.remainingM) / Math.max(1, navRoute.distM)) / 60));
  $('nav-foot').textContent = `${navDest?.name ?? ''} · còn ${formatDistance(s.remainingM)} · khoảng ${mins} phút`;
}

async function beginRoute(dest: Place, announce: boolean): Promise<void> {
  if (!lastFix) throw new Error('Chưa có vị trí GPS. Hãy bấm “Bắt đầu lái xe” và chờ có tín hiệu.');
  const route = await fetchRoute({ lat: lastFix.lat, lng: lastFix.lng }, { lat: dest.lat, lng: dest.lng });
  navRoute = route;
  navDest = dest;
  guidance = new Guidance(route, (t) => voice.speak(t), () => void reroute());
  mapView?.setRoute(route.points);
  renderNav(guidance.update({ lat: lastFix.lat, lng: lastFix.lng, t: lastFix.t }));
  if (announce) voice.speak(`Bắt đầu dẫn đường. Quãng đường ${speakDistance(route.distM)}.`);
}

async function reroute(): Promise<void> {
  if (!navDest || rerouting || Date.now() - lastRerouteAt < 10_000) return;
  rerouting = true;
  lastRerouteAt = Date.now();
  voice.speak('Đang tìm đường mới.');
  try {
    await beginRoute(navDest, false);
  } catch {
    /* giữ tuyến cũ; lần lệch kế tiếp sẽ thử lại */
  } finally {
    rerouting = false;
  }
}

function stopNav(): void {
  guidance = null;
  navRoute = null;
  navDest = null;
  mapView?.setRoute([]);
  renderNav(null);
}

function feedNav(g: GpsSample): void {
  lastFix = g;
  if (guidance) renderNav(guidance.update({ lat: g.lat, lng: g.lng, t: g.t }));
}

/* ---------- Giao diện ---------- */
const GPS_LABEL: Record<string, string> = {
  idle: 'Chưa bắt đầu',
  ok: 'GPS tốt',
  weak: 'GPS yếu',
  lost: 'Mất tín hiệu GPS',
};

function render(v: ViewState): void {
  const gps = mode === 'sim' && v.status !== 'idle' ? 'sim' : v.status;
  app.dataset.gps = gps;
  app.dataset.state = v.state;
  gpsText.textContent = mode === 'sim' ? 'Mô phỏng' : GPS_LABEL[v.status] ?? '';
  speedNum.textContent = v.kmh === null ? '--' : String(Math.round(v.kmh));

  if (v.limit !== null) {
    limitBox.hidden = false;
    limitSign.textContent = String(v.limit);
    limitSign.setAttribute('aria-label', `Giới hạn tốc độ ${v.limit} ki lô mét trên giờ`);
  } else {
    limitBox.hidden = true;
  }

  $('route-chip').hidden = !v.camRoute;
  const over = v.state === 'over' && v.limit !== null;
  overBanner.hidden = !over;
  if (over) overText.textContent = `Vượt tốc độ — giới hạn ${v.limit}`;

  if (v.alert) {
    alertBox.hidden = false;
    alertTitle.textContent = alertLabel(v.alert.type);
    alertSub.textContent = v.alert.type === 'camera' ? 'Chú ý tốc độ' : 'Chú ý quan sát';
    alertDist.textContent = formatDistance(v.alert.distM);
  } else {
    alertBox.hidden = true;
  }

  upcoming.replaceChildren(
    ...v.upcoming.map((h) => {
      const li = document.createElement('li');
      const a = document.createElement('span');
      a.textContent = alertLabel(h.type);
      const b = document.createElement('span');
      b.textContent = formatDistance(h.distM);
      li.append(a, b);
      return li;
    }),
  );
  upcomingEmpty.hidden = v.upcoming.length > 0 || v.alert !== null;
}

function applyTheme(): void {
  const root = document.documentElement;
  if (settings.theme === 'auto') root.removeAttribute('data-theme');
  else root.dataset.theme = settings.theme;
  const dark = isDark();
  mapView?.setDark(dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0B0F14' : '#FFFFFF');
}

function applyVoiceUi(): void {
  $('btn-voice').setAttribute('aria-pressed', String(voice.enabled));
  $('btn-voice-text').textContent = `Giọng nói: ${voice.enabled ? 'Bật' : 'Tắt'}`;
  ($('set-voice') as HTMLInputElement).checked = voice.enabled;
}

/* ---------- Dữ liệu cảnh báo / giới hạn tốc độ ---------- */
const failedAt = new Map<string, number>();
const loading = new Set<string>();
const RETRY_MS = 30_000;
let dataStamp = '';

async function ensureCells(lat: number, lng: number): Promise<void> {
  for (const key of cellsAround(lat, lng, 1500)) {
    if (engine.hasCell(key) || loading.has(key)) continue;
    if (Date.now() - (failedAt.get(key) ?? 0) < RETRY_MS) continue;
    loading.add(key);
    try {
      const res = await fetch(`./data/cells/${key}.json`, { cache: 'no-cache' });
      if (res.status === 404) {
        engine.loadCell(key, { segments: [], alerts: [] }); // vùng chưa có dữ liệu: nhớ để khỏi hỏi lại
      } else if (res.ok) {
        const cell = parseCell(await res.json());
        if (cell) engine.loadCell(key, cell);
        else failedAt.set(key, Date.now());
      } else {
        failedAt.set(key, Date.now());
      }
    } catch {
      failedAt.set(key, Date.now());
    } finally {
      loading.delete(key);
    }
  }
}

async function loadVersion(): Promise<void> {
  try {
    const res = await fetch('./data/version.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { updated?: string };
    dataStamp = j.updated ? `Dữ liệu cập nhật: ${j.updated}` : 'Dữ liệu đã tải';
  } catch {
    dataStamp = 'Chưa có dữ liệu cảnh báo cho khu vực này.';
  }
  refreshNotes();
}

function refreshNotes(): void {
  const text = mode === 'sim' ? 'Dữ liệu mô phỏng — không phải dữ liệu thật.' : dataStamp;
  dataNote.textContent = text;
  $('settings-data').textContent = text;
  const offline = !navigator.onLine;
  extraNote.hidden = !offline;
  extraNote.textContent = offline ? 'Đang ngoại tuyến — dùng dữ liệu đã lưu trên máy.' : '';
}

/* ---------- Chạy thật bằng GPS ---------- */
function onGeo(p: GeolocationPosition): void {
  const g: GpsSample = {
    t: p.timestamp,
    lat: p.coords.latitude,
    lng: p.coords.longitude,
    speed: p.coords.speed,
    accuracy: p.coords.accuracy,
  };
  void ensureCells(g.lat, g.lng);
  feedNav(g);
  const v = engine.push(g, p.coords.heading);
  render(v);
  updateMap(g, p.coords.heading, v);
}

async function holdScreen(): Promise<void> {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch {
    /* bỏ qua */
  }
}

function startTicker(): void {
  if (tickTimer !== null) return;
  tickTimer = window.setInterval(() => render(engine.tick(Date.now())), 1000);
}

function showStartError(msg: string): void {
  startError.hidden = false;
  startError.textContent = msg;
}

function startGps(): void {
  voice.unlock();
  if (!('geolocation' in navigator)) {
    showStartError('Thiết bị không hỗ trợ định vị.');
    return;
  }
  startError.hidden = true;
  mode = 'gps';
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      startBox.hidden = true;
      onGeo(p);
    },
    (e) => {
      if (e.code === e.PERMISSION_DENIED) {
        stopAll();
        showStartError('Chưa được cấp quyền vị trí. Hãy cho phép vị trí cho trang này rồi thử lại.');
      } else {
        startBox.hidden = true;
      }
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
  );
  startTicker();
  void holdScreen();
  void loadVersion();
}

/* ---------- Chạy thử mô phỏng ---------- */
const simEngine = (): Engine => engine;

function startSim(): void {
  voice.unlock();
  stopAll();
  mode = 'sim';
  startBox.hidden = true;
  simEngine().loadData(simData());
  sim.start((g) => {
    feedNav(g);
    const v = engine.push(g, null);
    render(v);
    updateMap(g, 0, v); // mô phỏng luôn đi về phía bắc
  });
  startTicker();
  void holdScreen();
  refreshNotes();
}

function stopAll(): void {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  sim.stop();
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (tickTimer !== null) window.clearInterval(tickTimer);
  tickTimer = null;
  mode = 'idle';
  stopNav();
  lastFix = null;
  render({ status: 'idle', kmh: null, limit: null, state: 'unknown', alert: null, upcoming: [], camRoute: false });
  refreshNotes();
}

/* ---------- Sự kiện ---------- */
function setMapFull(full: boolean): void {
  mapbox.classList.toggle('full', full);
  $('btn-map-expand').setAttribute('aria-pressed', String(full));
  $('btn-map-expand').setAttribute('aria-label', full ? 'Thu nhỏ bản đồ' : 'Mở rộng bản đồ');
  mapView?.setInteractive(full);
  mapView?.resize();
  if (!full) mapView?.recenter();
}
$('btn-map-expand').addEventListener('click', () => setMapFull(!mapbox.classList.contains('full')));
$('btn-map-follow').addEventListener('click', () => mapView?.recenter());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mapbox.classList.contains('full')) setMapFull(false);
});

$('btn-start').addEventListener('click', startGps);
$('btn-start-sim').addEventListener('click', startSim);
$('btn-sim').addEventListener('click', () => {
  if (mode === 'sim') stopAll();
  else startSim();
  $('btn-sim-text').textContent = mode === 'sim' ? 'Tắt chạy thử' : 'Chạy thử mô phỏng';
  settingsDlg.close();
});
$('btn-stop').addEventListener('click', () => {
  stopAll();
  $('btn-sim-text').textContent = 'Chạy thử mô phỏng';
  startBox.hidden = false;
});
$('btn-voice').addEventListener('click', () => {
  voice.enabled = !voice.enabled;
  settings.voice = voice.enabled;
  saveSettings();
  applyVoiceUi();
});
$('btn-settings').addEventListener('click', () => {
  ($('set-radius') as HTMLSelectElement).value = String(settings.radius);
  ($('set-theme') as HTMLSelectElement).value = settings.theme;
  applyVoiceUi();
  settingsDlg.showModal();
});
$('set-radius').addEventListener('change', (e) => {
  settings.radius = Number((e.target as HTMLSelectElement).value);
  engine.setRadius(settings.radius);
  saveSettings();
});
$('set-theme').addEventListener('change', (e) => {
  settings.theme = (e.target as HTMLSelectElement).value as Settings['theme'];
  applyTheme();
  saveSettings();
});
$('set-voice').addEventListener('change', (e) => {
  voice.enabled = (e.target as HTMLInputElement).checked;
  settings.voice = voice.enabled;
  saveSettings();
  applyVoiceUi();
});
$('btn-test-voice').addEventListener('click', () => {
  voice.unlock();
  const was = voice.enabled;
  voice.enabled = true;
  voice.speak('Phía trước 400 mét có camera phạt nguội. Chú ý tốc độ.');
  voice.enabled = was;
});

/* ---------- Tìm đích ---------- */
const destDlg = $('dest') as HTMLDialogElement;
const destQ = $('dest-q') as HTMLInputElement;
const destList = $('dest-results');
const destStatus = $('dest-status');
let searchTimer: number | null = null;
let searchCtl: AbortController | null = null;

function destMsg(t: string): void {
  destStatus.textContent = t;
}

async function doSearch(q: string): Promise<void> {
  searchCtl?.abort();
  searchCtl = new AbortController();
  destMsg('Đang tìm…');
  try {
    const places = await searchPlaces(q, lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null, searchCtl.signal);
    destList.replaceChildren(
      ...places.map((p) => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = p.name;
        if (p.detail) {
          const sm = document.createElement('small');
          sm.textContent = p.detail;
          b.append(sm);
        }
        b.addEventListener('click', () => void choose(p));
        li.append(b);
        return li;
      }),
    );
    destMsg(places.length ? '' : 'Không tìm thấy nơi nào khớp.');
  } catch (e) {
    if ((e as Error).name !== 'AbortError') destMsg('Không tìm được lúc này (có thể mất mạng). Thử lại sau.');
  }
}

async function choose(p: Place): Promise<void> {
  destMsg('Đang tìm đường…');
  try {
    await beginRoute(p, true);
    destDlg.close();
  } catch (e) {
    destMsg((e as Error).message || 'Không tìm được đường đi.');
  }
}

$('btn-nav').addEventListener('click', () => {
  if (guidance) return; // đang dẫn đường: dùng nút Dừng trên thẻ
  destList.replaceChildren();
  destMsg(lastFix ? '' : 'Hãy bấm “Bắt đầu lái xe” trước để có vị trí xuất phát.');
  destDlg.showModal();
  destQ.focus();
});
$('btn-dest-close').addEventListener('click', () => destDlg.close());
$('btn-nav-stop').addEventListener('click', stopNav);
destQ.addEventListener('input', () => {
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  const q = destQ.value.trim();
  if (q.length < 3) {
    destList.replaceChildren();
    destMsg('');
    return;
  }
  searchTimer = window.setTimeout(() => void doSearch(q), 450);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && mode !== 'idle') void holdScreen();
});
window.addEventListener('online', refreshNotes);
window.addEventListener('offline', refreshNotes);

/* ---------- Cài đặt ứng dụng (PWA) ---------- */
let installEvt: (Event & { prompt: () => Promise<void> }) | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvt = e as typeof installEvt;
  $('btn-install').hidden = false;
});
$('btn-install').addEventListener('click', async () => {
  await installEvt?.prompt();
  installEvt = null;
  $('btn-install').hidden = true;
});
if (/iphone|ipad/i.test(navigator.userAgent) && !matchMedia('(display-mode: standalone)').matches) {
  $('ios-hint').hidden = false;
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

applyTheme();
applyVoiceUi();
refreshNotes();
