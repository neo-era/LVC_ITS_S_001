import './styles.css';
import { parseCell } from './core/cells';
import { alertLabel, formatDistance, speakDistance } from './core/format';
import { cellsAround } from './core/geo';
import type { GpsSample } from './core/gps';
import { isVehicle, type Vehicle } from './core/vehicle';
import { Engine, type ViewState } from './engine';
import { addMark, createMark, markToAlert, parseMarks, removeMark, type Mark } from './marks';
import { authHeaders, pushMarks, queueWithdraw, SUPABASE_URL, withdrawMarks } from './sync';
import { fmtVnTime } from './features/reports';
import { setupFeedback } from './features/feedback-ui';
import { Guidance, type NavState } from './nav/guidance';
import { pickedPlace, reversePlace, searchPlaces, type Place } from './nav/geocode';
import { isShortMapLink, parseCoords } from './nav/coords';
import { parseNameShard, searchLocal, type NameEntry } from './nav/localsearch';
import { foldName, shardsAround } from './pipeline/names';
import { haversine } from './core/geo';
import { fetchRoute, fetchRoutes, routeLabel, type Route } from './nav/route';
import { mapHud } from './hud';
import { MapView } from './map';
import { filterProvinces, formatMB, suggestProvince, type ProvinceInfo } from './offline/core';
import { OfflineMaps } from './offline/store';
import { Simulator, simData } from './sim';
import { updateAction } from './update';
import { freshFix, setupFeatures } from './features/wire';
import { setupFeatures2 } from './features/wire2';
import { Voice } from './voice';
import { setSpeedCal, shownSpeed, SPEED_CAL_OPTIONS } from './core/speedcal';

/* ---------- Cài đặt (localStorage có thể không dùng được → luôn bọc try/catch) ---------- */
interface Settings {
  radius: number;
  voice: boolean;
  theme: 'auto' | 'dark' | 'light';
  voiceName: string;
  voiceStyle: string;
  vehicle: Vehicle;
  /** Bù số hiển thị theo đồng hồ xe (%), 0 = tốc độ GPS thật. */
  speedCal: number;
}
const DEFAULTS: Settings = { radius: 500, voice: true, theme: 'auto', voiceName: '', voiceStyle: 'normal', vehicle: 'car', speedCal: 0 };
const KEY = 'lat.settings.v1';

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const radius = [300, 500, 800, 1000].includes(raw.radius) ? raw.radius : DEFAULTS.radius;
      const theme = ['auto', 'dark', 'light'].includes(raw.theme) ? raw.theme : DEFAULTS.theme;
      const voiceName = typeof raw.voiceName === 'string' ? raw.voiceName : '';
      const voiceStyle = ['cute', 'normal', 'warm'].includes(raw.voiceStyle) ? raw.voiceStyle : 'normal';
      const vehicle = isVehicle(raw.vehicle) ? raw.vehicle : 'car';
      const speedCal = (SPEED_CAL_OPTIONS as readonly number[]).includes(raw.speedCal) ? raw.speedCal : 0;
      return { radius, theme, voice: raw.voice !== false, voiceName, voiceStyle, vehicle, speedCal };
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
setSpeedCal(settings.speedCal);

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
voice.voiceName = settings.voiceName;
voice.style = settings.voiceStyle;
const engine = new Engine({ radiusM: settings.radius, speak: (t) => voice.speak(t), vehicle: settings.vehicle });
const sim = new Simulator();

const offline = new OfflineMaps();
void offline.init();
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
    const mv = new MapView($('map'), isDark(), offline);
    mv.onFollowChange = (f) => ($('btn-map-follow').hidden = f);
    mv.onAltTap = (idx) => {
      if (!choice || !choice.routes[idx]) return;
      choice.sel = idx;
      drawChoice();
    };
    mv.onAlertTap = (id) => {
      const m = marks.find((x) => x.id === id);
      if (m) toast(`Dấu camera anh đánh lúc ${fmtVnTime(m.t)}.`, () => deleteMark(id), 'Xoá dấu', 8000);
      else toast('Camera trong dữ liệu chung (bản đồ / dấu đã duyệt), không xoá được từ máy.', undefined, undefined, 5000);
    };
    await mv.init({ lat, lng });
    mapView = mv;
    applyMapPadding();
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

/* ---------- Camera tự đánh dấu ---------- */
const MARKS_KEY = 'lat.marks.v1';
const DEVICE_KEY = 'lat.device';

function lsGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
/** Ghi localStorage; false nếu đầy bộ nhớ/bị chặn (để báo cho người dùng). */
function lsSet(k: string, v: string): boolean {
  try {
    localStorage.setItem(k, v);
    return true;
  } catch {
    return false;
  }
}

let marks: Mark[] = [];
try {
  marks = parseMarks(JSON.parse(lsGet(MARKS_KEY) ?? '[]'));
} catch {
  marks = [];
}
for (const m of marks) engine.addAlert(markToAlert(m));
const saveMarks = () => lsSet(MARKS_KEY, JSON.stringify(marks));

function deviceId(): string {
  let d = lsGet(DEVICE_KEY);
  if (!d || d.length < 16) {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    d = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    lsSet(DEVICE_KEY, d);
  }
  return d;
}

let toastTimer: number | null = null;
let undoFn: (() => void) | null = null;
function toast(text: string, undo?: () => void, actionLabel = 'Hoàn tác', ms = 6000): void {
  $('toast-text').textContent = text;
  undoFn = undo ?? null;
  $('toast-undo').hidden = !undo;
  $('toast-undo').textContent = actionLabel;
  $('toast').hidden = false;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ($('toast').hidden = true), ms);
}

/* ---------- Xoá từng dấu camera (bấm nhầm) ---------- */
const WD_KEY = 'lat.marks.withdraw.v1';
let withdrawQ: string[] = (() => {
  try {
    const v = JSON.parse(lsGet(WD_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
})();
const saveWithdraw = () => lsSet(WD_KEY, JSON.stringify(withdrawQ));
let wdTimer: number | null = null;
/** Gửi yêu cầu rút các dấu đã đồng bộ (chỉ dấu chưa duyệt của chính máy này mới bị xoá trên máy chủ). */
async function flushWithdraw(): Promise<void> {
  if (!withdrawQ.length || !navigator.onLine) return;
  const ids = [...withdrawQ];
  try {
    await withdrawMarks(deviceId(), ids);
    withdrawQ = withdrawQ.filter((x) => !ids.includes(x));
    saveWithdraw();
  } catch {
    /* thử lại lần sau */
  }
}
window.addEventListener('online', () => void flushWithdraw());
setTimeout(() => void flushWithdraw(), 5000);

function deleteMark(id: string): void {
  const m = marks.find((x) => x.id === id);
  if (!m) return;
  marks = removeMark(marks, id);
  saveMarks();
  engine.removeAlert(m);
  if (m.synced) {
    withdrawQ = queueWithdraw(withdrawQ, [id]);
    saveWithdraw();
  }
  refreshMapAlerts();
  refreshMarksInfo();
  toast('Đã xoá dấu camera.', () => {
    // hoàn tác: đặt lại dấu, bỏ khỏi hàng chờ rút; dấu sẽ được gửi lại khi đồng bộ
    withdrawQ = withdrawQ.filter((x) => x !== id);
    saveWithdraw();
    const back = { ...m, synced: false };
    marks = addMark(marks, back).marks;
    saveMarks();
    engine.addAlert(markToAlert(back));
    refreshMapAlerts();
    refreshMarksInfo();
    $('toast').hidden = true;
    void syncMarks(true);
  });
  // chờ hết thời gian hoàn tác rồi mới gửi yêu cầu rút
  if (wdTimer !== null) clearTimeout(wdTimer);
  wdTimer = window.setTimeout(() => void flushWithdraw(), 6500);
}

function renderMarksList(): void {
  const here = lastFix;
  $('marks-list').replaceChildren(
    ...[...marks]
      .sort((a, b) => b.t - a.t)
      .slice(0, 30)
      .map((m) => {
        const li = document.createElement('li');
        li.className = 'off-row';
        const txt = document.createElement('span');
        txt.textContent = `${fmtVnTime(m.t)}${here ? ` · cách ${formatDistance(haversine(here, m))}` : ''}${m.synced ? '' : ' · chưa gửi'}`;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'secondary';
        del.textContent = 'Xoá';
        del.setAttribute('aria-label', `Xoá dấu camera lúc ${fmtVnTime(m.t)}`);
        del.addEventListener('click', () => deleteMark(m.id));
        li.append(txt, del);
        return li;
      }),
  );
}

function refreshMarksInfo(): void {
  renderMarksList();
  const pending = marks.filter((m) => !m.synced).length;
  $('marks-info').textContent = marks.length
    ? `${marks.length} dấu trên máy, ${pending} chưa đồng bộ. Bấm “Đánh dấu camera” khi xe đi ngang camera.`
    : 'Chưa có dấu nào. Bấm “Đánh dấu camera” khi xe đi ngang camera để lưu đúng vị trí.';
}

function refreshMapAlerts(): void {
  if (mapView && lastFix) mapView.setAlerts(engine.alertsNear({ lat: lastFix.lat, lng: lastFix.lng }, 2000));
}

async function syncMarks(silent: boolean): Promise<void> {
  const status = $('sync-status');
  const say = (t: string) => {
    if (!silent) status.textContent = t;
  };
  void flushWithdraw();
  const pending = marks.filter((m) => !m.synced);
  if (!pending.length) return say('Không có dấu nào cần đồng bộ.');
  if (!navigator.onLine) return say('Đang ngoại tuyến. Dấu vẫn lưu trên máy, sẽ gửi khi có mạng.');
  say('Đang đồng bộ…');
  try {
    const saved = new Set(await pushMarks(deviceId(), pending));
    marks = marks.map((m) => (saved.has(m.id) ? { ...m, synced: true } : m));
    saveMarks();
    refreshMarksInfo();
    say(`Đã gửi ${saved.size} dấu. Dấu vào dữ liệu cảnh báo sau khi được duyệt.`);
  } catch (e) {
    say(`Chưa gửi được: ${(e as Error).message}. Dấu vẫn lưu trên máy.`);
  }
}

function markHere(): void {
  if (mode === 'sim') return toast('Không đánh dấu khi đang chạy thử mô phỏng.');
  const fx = freshFix(lastFix);
  if (!fx) return toast('Chưa có vị trí GPS đủ tốt để đánh dấu (cần tín hiệu mới, sai số ≤ 50 m).');
  const m = createMark({ lat: fx.lat, lng: fx.lng }, engine.currentHeading(), 'camera', Date.now());
  const r = addMark(marks, m);
  if (!r.added) return toast('Đã có dấu camera ở gần đây rồi.');
  marks = r.marks;
  saveMarks();
  engine.addAlert(markToAlert(m));
  refreshMapAlerts();
  refreshMarksInfo();
  voice.speak('Đã đánh dấu camera.');
  toast('Đã đánh dấu camera tại vị trí này.', () => {
    marks = removeMark(marks, m.id);
    saveMarks();
    engine.removeAlert(m);
    refreshMapAlerts();
    refreshMarksInfo();
    $('toast').hidden = true;
  });
  void syncMarks(true);
}

let clearArmed = false;
$('btn-mark').addEventListener('click', markHere);
$('toast-undo').addEventListener('click', () => undoFn?.());
$('btn-sync').addEventListener('click', () => void syncMarks(false));
$('btn-clear-marks').addEventListener('click', () => {
  const b = $('btn-clear-marks');
  if (!clearArmed) {
    clearArmed = true;
    b.textContent = 'Chạm lần nữa để xoá hết';
    window.setTimeout(() => {
      clearArmed = false;
      b.textContent = 'Xoá tất cả dấu trên máy';
    }, 4000);
    return;
  }
  for (const m of marks) engine.removeAlert(m);
  marks = [];
  saveMarks();
  clearArmed = false;
  b.textContent = 'Xoá tất cả dấu trên máy';
  refreshMapAlerts();
  refreshMarksInfo();
});

/* ---------- Dẫn đường ---------- */
const navBox = $('nav');
let lastFix: GpsSample | null = null;
refreshMarksInfo(); // sau khi khai báo lastFix (danh sách dấu có ghi khoảng cách)
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

/**
 * Bắt đầu dẫn đường. pick = true: lấy thêm tuyến thay thế và cho chọn (khi người dùng chủ động tìm);
 * tìm lại khi lệch tuyến / lệnh giọng nói thì đi luôn tuyến nhanh nhất.
 */
async function beginRoute(dest: Place, announce: boolean, pick = false): Promise<void> {
  if (!lastFix) throw new Error('Chưa có vị trí GPS. Hãy bấm “Bắt đầu lái xe” và chờ có tín hiệu.');
  const from = { lat: lastFix.lat, lng: lastFix.lng };
  if (pick) {
    const routes = await fetchRoutes(from, { lat: dest.lat, lng: dest.lng }, settings.vehicle, 2);
    if (routes.length > 1) return showRouteChoice(routes, dest);
    return startRoute(routes[0], dest, announce);
  }
  startRoute(await fetchRoute(from, { lat: dest.lat, lng: dest.lng }, settings.vehicle), dest, announce);
}

function startRoute(route: Route, dest: Place, announce: boolean): void {
  if (!lastFix) return;
  endRouteChoice();
  navRoute = route;
  navDest = dest;
  guidance = new Guidance(route, (t) => voice.speak(t), () => void reroute());
  mapView?.setRoute(route.points);
  renderNav(guidance.update({ lat: lastFix.lat, lng: lastFix.lng, t: lastFix.t }));
  if (announce) voice.speak(`Bắt đầu dẫn đường. Quãng đường ${speakDistance(route.distM)}.`);
}

/* ---------- Chọn lộ trình (nhiều tuyến thay thế) ---------- */
let choice: { routes: Route[]; dest: Place; sel: number } | null = null;
function drawChoice(): void {
  if (!choice) return;
  const { routes, sel } = choice;
  mapView?.setRoute(routes[sel].points);
  mapView?.setAltRoutes(routes.map((r, idx) => ({ idx, points: r.points })).filter((a) => a.idx !== sel));
  $('rc-list').replaceChildren(
    ...routes.map((r, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(i === sel));
      const sw = document.createElement('span');
      sw.className = 'rc-swatch';
      const t = document.createElement('span');
      t.textContent = routeLabel(r, routes[0]);
      b.append(sw, t);
      b.addEventListener('click', () => {
        if (!choice) return;
        choice.sel = i;
        drawChoice();
      });
      li.append(b);
      return li;
    }),
  );
}
function showRouteChoice(routes: Route[], dest: Place): void {
  choice = { routes, dest, sel: 0 };
  $('route-choice').hidden = false;
  drawChoice();
  mapView?.fitRoutes(
    routes.map((r) => r.points),
    { top: 40, left: 30, right: 90, bottom: $('route-choice').offsetHeight + 30 },
  );
  voice.speak(`Có ${routes.length} lộ trình. Chọn một tuyến rồi bấm đi.`);
}
function endRouteChoice(): void {
  if (!choice) return;
  choice = null;
  $('route-choice').hidden = true;
  mapView?.setAltRoutes([]);
}
$('btn-rc-go').addEventListener('click', () => {
  if (!choice) return;
  const { routes, sel, dest } = choice;
  startRoute(routes[sel], dest, true);
  mapView?.recenter();
});
$('btn-rc-cancel').addEventListener('click', () => {
  const wasNav = !!guidance;
  endRouteChoice();
  if (wasNav && navRoute) mapView?.setRoute(navRoute.points);
  else mapView?.setRoute([]);
  mapView?.recenter();
});
// đang dẫn đường: chạm dòng "… còn x km" để xem lộ trình khác từ vị trí hiện tại
$('nav-foot').addEventListener('click', () => {
  if (!navDest || choice) return;
  const dest = navDest;
  toast('Đang tìm lộ trình khác…');
  beginRoute(dest, false, true).catch((e) => toast((e as Error).message || 'Không tìm được lộ trình khác.'));
});

let rerouteSpokenAt = 0;
async function reroute(): Promise<void> {
  if (!navDest || rerouting || choice || Date.now() - lastRerouteAt < 10_000) return;
  rerouting = true;
  lastRerouteAt = Date.now();
  // chỉ đọc một lần mỗi phút, tránh lặp khi đang đứng yên ngoài tuyến
  if (Date.now() - rerouteSpokenAt > 60_000) {
    rerouteSpokenAt = Date.now();
    voice.speak('Đang tìm đường mới.');
  }
  try {
    await beginRoute(navDest, false);
  } catch {
    /* giữ tuyến cũ; lần lệch kế tiếp sẽ thử lại */
  } finally {
    rerouting = false;
  }
}

function stopNav(): void {
  endRouteChoice();
  guidance = null;
  navRoute = null;
  navDest = null;
  mapView?.setRoute([]);
  renderNav(null);
}

let lastNavState: NavState | null = null;
function feedNav(g: GpsSample): void {
  lastFix = g;
  if (guidance) renderNav((lastNavState = guidance.update({ lat: g.lat, lng: g.lng, t: g.t })));
}

/* ---------- Giao diện ---------- */
const GPS_LABEL: Record<string, string> = {
  idle: 'Chưa bắt đầu',
  ok: 'GPS tốt',
  weak: 'GPS yếu',
  lost: 'Mất tín hiệu GPS',
};

function renderMapHud(v: ViewState): void {
  const h = mapHud(v);
  $('map-hud').dataset.state = h.state;
  $('mh-speed').textContent = h.speed;
  $('mh-limit-box').hidden = h.limit === null;
  $('mh-limit-box').classList.toggle('est', h.estimated);
  $('mh-limit').textContent = h.limit ?? '';
  $('mh-limit-label').textContent = h.estimated ? 'Ước tính' : 'Giới hạn';
  $('mh-alert').hidden = h.alert === null;
  if (h.alert) {
    $('mh-alert-title').textContent = h.alert.title;
    $('mh-alert-sub').textContent = h.alert.sub;
    $('mh-alert-dist').textContent = h.alert.dist;
  }
}

let lastPadAt = 0;
function render(v: ViewState): void {
  renderMapHud(v);
  if (Date.now() - lastPadAt > 1500) {
    lastPadAt = Date.now();
    requestAnimationFrame(applyMapPadding);
  }
  const gps = mode === 'sim' && v.status !== 'idle' ? 'sim' : v.status;
  app.dataset.gps = gps;
  app.dataset.state = v.state;
  gpsText.textContent = mode === 'sim' ? 'Mô phỏng' : GPS_LABEL[v.status] ?? '';
  speedNum.textContent = shownSpeed(v.kmh);

  if (v.limit !== null) {
    limitBox.hidden = false;
    limitBox.classList.toggle('est', v.limitEstimated);
    limitSign.textContent = String(v.limit);
    $('limit-label').textContent = v.limitEstimated ? 'Ước tính theo luật' : (v.limitNote ?? 'Giới hạn');
    limitSign.setAttribute(
      'aria-label',
      v.limitEstimated
        ? `Giới hạn ước tính theo luật ${v.limit} ki lô mét trên giờ`
        : `Giới hạn tốc độ ${v.limit} ki lô mét trên giờ`,
    );
  } else {
    limitBox.hidden = true;
  }

  $('route-chip').hidden = !v.camRoute;
  const over = v.state === 'over' && v.limit !== null;
  overBanner.hidden = !over;
  if (over) overText.textContent = v.limitEstimated ? `Vượt mức ước tính theo luật (${v.limit})` : `Vượt tốc độ — giới hạn ${v.limit}`;

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
  features2.gpsSpeed(p.coords.speed !== null && p.coords.speed >= 0 ? p.coords.speed * 3.6 : null, p.coords.accuracy, p.timestamp);
  if (speedOverrideKmh !== null) g.speed = speedOverrideKmh / 3.6; // OBD-II: tốc độ từ xe thay cho GPS (đã đối chiếu với GPS)
  void ensureCells(g.lat, g.lng);
  feedNav(g);
  const v = engine.push(g, p.coords.heading);
  render(v);
  updateMap(g, p.coords.heading, v);
  features.onSample(g, v);
  features2.onSample(g, v);
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
  tickTimer = window.setInterval(() => {
    const v = engine.tick(Date.now());
    render(v);
    if (v.status === 'lost') features2.onLost();
  }, 1000);
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
    features.onSample(g, v);
    features2.onSample(g, v);
  });
  startTicker();
  void holdScreen();
  refreshNotes();
}

function stopAll(): void {
  features.onStop();
  features2.onStop();
  feedback.onTripEnd();
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  sim.stop();
  void wakeLock?.release().catch(() => {});
  wakeLock = null;
  if (tickTimer !== null) window.clearInterval(tickTimer);
  tickTimer = null;
  mode = 'idle';
  window.setTimeout(applyUpdateIfSafe, 300);
  stopNav();
  lastFix = null;
  lastNavState = null;
  render({ status: 'idle', kmh: null, limit: null, state: 'unknown', alert: null, upcoming: [], camRoute: false, limitEstimated: false, truckBan: false });
  refreshNotes();
}

/* ---------- Sự kiện ---------- */
/** Chừa chỗ cho thẻ nổi: xe hiện ở phần bản đồ còn trống giữa thẻ trên và thanh nút dưới. */
const LANDSCAPE = matchMedia('(orientation: landscape) and (max-height: 520px)');
function applyMapPadding(): void {
  if (!mapView) return;
  if (mapbox.classList.contains('full')) return mapView.setPadding({ top: 0, bottom: 0 });
  const bar = document.querySelector('.bar') as HTMLElement;
  if (bar) document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`);
  let top = 0;
  let left = 0;
  for (const el of document.querySelectorAll<HTMLElement>('.main > :not(.mapbox)')) {
    const r = el.getBoundingClientRect();
    if (r.height > 0) {
      top = Math.max(top, r.bottom);
      left = Math.max(left, r.right);
    }
  }
  void bar;
  if (LANDSCAPE.matches) {
    // nằm ngang: thông tin ở cột trái → xe nằm giữa phần bản đồ bên phải, chừa cột nút 2 hàng
    mapView.setPadding({ top: 0, bottom: 0, left: Math.min(left, window.innerWidth * 0.45), right: 120 });
  } else {
    mapView.setPadding({ top: Math.min(top, window.innerHeight * 0.55), bottom: 40, right: 60 });
  }
}
window.addEventListener('resize', applyMapPadding);
LANDSCAPE.addEventListener('change', () => setTimeout(applyMapPadding, 50));

function setMapFull(full: boolean): void {
  if (!full) endPick();
  mapbox.classList.toggle('full', full);
  $('btn-map-expand').setAttribute('aria-pressed', String(full));
  $('btn-map-expand').setAttribute('aria-label', full ? 'Thu nhỏ bản đồ' : 'Mở rộng bản đồ');
  mapView?.resize();
  applyMapPadding();
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
  ($('set-speedcal') as HTMLSelectElement).value = String(settings.speedCal);
  ($('set-theme') as HTMLSelectElement).value = settings.theme;
  ($('set-vehicle') as HTMLSelectElement).value = settings.vehicle;
  ($('set-voice-style') as HTMLSelectElement).value = settings.voiceStyle;
  fillVoiceList();
  applyVoiceUi();
  settingsDlg.showModal();
});
$('set-vehicle').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (!isVehicle(v)) return;
  settings.vehicle = v;
  engine.setVehicle(v);
  saveSettings();
});
$('set-speedcal').addEventListener('change', (e) => {
  settings.speedCal = Number((e.target as HTMLSelectElement).value);
  setSpeedCal(settings.speedCal);
  saveSettings();
  render(engine.view());
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
  voice.speak('Phía trước 400 mét có camera phạt nguội. Chú ý tốc độ.', true);
});

function fillVoiceList(): void {
  const sel = $('set-voice-name') as HTMLSelectElement;
  const opts = voice.list().map((v) => {
    const o = document.createElement('option');
    o.value = v.name;
    o.textContent = v.name;
    return o;
  });
  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = opts.length ? 'Tự chọn (giọng tốt nhất)' : 'Máy chưa có giọng tiếng Việt';
  sel.replaceChildren(auto, ...opts);
  sel.value = opts.some((o) => o.value === settings.voiceName) ? settings.voiceName : '';
}
voice.onVoicesChanged(fillVoiceList);
$('set-voice-name').addEventListener('change', (e) => {
  settings.voiceName = (e.target as HTMLSelectElement).value;
  voice.setVoice(settings.voiceName);
  saveSettings();
  voice.speak('Xin chào, em sẽ đọc cảnh báo bằng giọng này.', true);
});
$('set-voice-style').addEventListener('change', (e) => {
  settings.voiceStyle = (e.target as HTMLSelectElement).value;
  voice.style = settings.voiceStyle;
  saveSettings();
  voice.speak('Xin chào, em sẽ đọc cảnh báo bằng giọng này.', true);
});


/* ---------- Bản đồ offline theo tỉnh (phương án B) ---------- */
const offDlg = $('offline') as HTMLDialogElement;
let provinces: ProvinceInfo[] = [];
let provincesUpdated = '';
let dl: { slug: string; got: number; total: number; ctl: AbortController } | null = null;

async function loadProvinces(): Promise<void> {
  if (provinces.length) return;
  const r = await fetch('./map/provinces.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('chưa có');
  const j = (await r.json()) as { updated?: string; provinces?: ProvinceInfo[] };
  provinces = Array.isArray(j.provinces) ? j.provinces : [];
  provincesUpdated = j.updated ?? '';
}

function offRow(p: { slug: string; name: string; bytes: number }, kind: 'mine' | 'suggest'): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `off-row${kind === 'suggest' ? ' suggest' : ''}`;
  const name = document.createElement('div');
  name.className = 'off-name';
  name.textContent = p.name;
  const sm = document.createElement('small');
  const btn = document.createElement('button');
  btn.type = 'button';
  if (dl?.slug === p.slug) {
    sm.textContent = `Đang tải ${formatMB(dl.got)} / ${formatMB(dl.total)}`;
    const bar = document.createElement('div');
    bar.className = 'off-bar';
    const i = document.createElement('i');
    i.style.width = `${Math.min(100, (dl.got / Math.max(1, dl.total)) * 100)}%`;
    bar.append(i);
    name.append(sm, bar);
    btn.className = 'del';
    btn.textContent = 'Dừng';
    btn.addEventListener('click', () => dl?.ctl.abort());
  } else if (offline.has(p.slug)) {
    const m = offline.list().find((x) => x.slug === p.slug)!;
    const newer = provincesUpdated && m.updated && provincesUpdated > m.updated && provinces.some((x) => x.slug === p.slug);
    sm.className = 'ok';
    sm.textContent = `Đã tải · ${formatMB(m.bytes)}${m.updated ? ` · ${m.updated.split('-').reverse().join('/')}` : ''}`;
    name.append(sm);
    if (newer) {
      sm.textContent += ' · có bản mới';
      btn.className = 'dl';
      btn.textContent = 'Cập nhật';
      btn.disabled = dl !== null;
      btn.addEventListener('click', () => void startDownload(p.slug));
    } else {
      btn.className = 'del';
      btn.textContent = 'Xoá';
      btn.addEventListener('click', async () => {
        await offline.remove(p.slug);
        void renderOffline();
      });
    }
  } else {
    sm.textContent = formatMB(p.bytes);
    name.append(sm);
    btn.className = 'dl';
    btn.textContent = 'Tải';
    btn.disabled = dl !== null;
    btn.addEventListener('click', () => void startDownload(p.slug));
  }
  li.append(name, btn);
  return li;
}

async function renderOffline(): Promise<void> {
  const status = $('off-status');
  try {
    await loadProvinces();
  } catch {
    $('off-all').replaceChildren();
    status.textContent = navigator.onLine
      ? 'Bản đồ offline đang được chuẩn bị trên máy chủ, anh thử lại sau ít phút.'
      : 'Cần có mạng để xem danh sách và tải bản đồ.';
  }
  const q = ($('off-q') as HTMLInputElement).value;
  const mine = offline.list();
  const downloading = dl ? provinces.find((p) => p.slug === dl!.slug) : undefined;
  const mineRows = [...mine.map((m) => ({ slug: m.slug, name: m.name, bytes: m.bytes }))];
  if (downloading && !offline.has(downloading.slug)) mineRows.unshift(downloading);
  $('off-mine-box').hidden = mineRows.length === 0;
  $('off-mine').replaceChildren(...mineRows.map((p) => offRow(p, 'mine')));

  const sug = !q ? suggestProvince(provinces, lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null) : null;
  const showSug = sug && !offline.has(sug.slug) && dl?.slug !== sug.slug;
  $('off-suggest-box').hidden = !showSug;
  $('off-suggest').replaceChildren(...(showSug ? [offRow(sug!, 'suggest')] : []));

  const rest = filterProvinces(provinces, q).filter((p) => !offline.has(p.slug) && dl?.slug !== p.slug && !(showSug && p.slug === sug!.slug));
  $('off-all').replaceChildren(
    ...rest.map((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${p.name} · ${formatMB(p.bytes)}`;
      b.disabled = dl !== null;
      b.setAttribute('aria-label', `Tải bản đồ ${p.name}, ${formatMB(p.bytes)}`);
      b.addEventListener('click', () => void startDownload(p.slug));
      return b;
    }),
  );
  if (provinces.length && !rest.length && q) status.textContent = 'Không tìm thấy tỉnh/thành nào khớp.';
  const u = await offline.usage();
  $('off-usage').textContent = `Đã dùng ${formatMB(u.used)}${u.free !== null ? ` · còn trống khoảng ${formatMB(u.free)}` : ''}`;
  if (offline.evicted.length && !status.textContent)
    status.textContent = `Trình duyệt đã xoá bản đồ ${offline.evicted.join(', ')} (thường do lâu không mở app). Anh tải lại khi cần; cài app vào màn hình chính để hạn chế bị xoá.`;
}

async function startDownload(slug: string): Promise<void> {
  const p = provinces.find((x) => x.slug === slug);
  if (!p || dl) return;
  dl = { slug, got: 0, total: p.bytes, ctl: new AbortController() };
  $('off-status').textContent = '';
  void renderOffline();
  let last = 0;
  try {
    await offline.download(
      p,
      provincesUpdated,
      (got, total) => {
        if (!dl) return;
        dl.got = got;
        dl.total = total;
        if (Date.now() - last > 300) {
          last = Date.now();
          void renderOffline();
        }
      },
      dl.ctl.signal,
    );
    $('off-status').textContent = `Đã tải xong bản đồ ${p.name}. Có thể dùng khi mất mạng.`;
  } catch (e) {
    $('off-status').textContent =
      (e as Error).name === 'AbortError' ? 'Đã dừng tải.' : (e as Error).message || 'Tải không thành công, vui lòng thử lại.';
  } finally {
    dl = null;
    void renderOffline();
  }
}

$('btn-offline').addEventListener('click', () => {
  settingsDlg.close();
  ($('off-q') as HTMLInputElement).value = '';
  $('off-status').textContent = '';
  offDlg.showModal();
  void renderOffline();
});
$('btn-off-close').addEventListener('click', () => offDlg.close());
$('off-q').addEventListener('input', () => void renderOffline());

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

/* Danh bạ tên trên máy (tải theo mảnh quanh vị trí, service worker giữ lại để dùng khi mất mạng) */
const nameShards = new Map<string, NameEntry[]>();
async function localEntries(): Promise<NameEntry[]> {
  if (!lastFix) return [];
  const keys = shardsAround(lastFix.lat, lastFix.lng);
  await Promise.all(
    keys
      .filter((k) => !nameShards.has(k))
      .map(async (k) => {
        try {
          const r = await fetch(`./data/names/${k}.json`);
          nameShards.set(k, r.ok ? parseNameShard(await r.json()) : []);
        } catch {
          /* mất mạng & chưa lưu: bỏ qua mảnh này */
        }
      }),
  );
  return keys.flatMap((k) => nameShards.get(k) ?? []);
}

function renderResults(places: Place[]): void {
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
      (b as HTMLButtonElement & { _place?: Place })._place = p;
      li.append(b);
      return li;
    }),
  );
}

/** Gộp kết quả: trên máy trước; bỏ kết quả trực tuyến trùng tên ở gần (≤ 1 km). */
function mergePlaces(local: Place[], online: Place[]): Place[] {
  const out = [...local];
  for (const p of online) {
    if (out.some((x) => foldName(x.name) === foldName(p.name) && haversine(x, p) < 1000)) continue;
    out.push(p);
  }
  return out.slice(0, 8);
}

/** Link rút gọn maps.app.goo.gl → toạ độ, qua hàm máy chủ expand-link (trình duyệt không đọc được chuyển hướng). */
async function expandMapLink(u: string, signal: AbortSignal): Promise<{ lat: number; lng: number } | { q: string } | null> {
  if (!navigator.onLine) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/expand-link?u=${encodeURIComponent(u.trim())}`, { headers: authHeaders(), signal });
    if (!r.ok) return null;
    const j = (await r.json()) as { url?: string; lat?: number; lng?: number; q?: string | null };
    if (typeof j.lat === 'number' && typeof j.lng === 'number') return { lat: j.lat, lng: j.lng };
    const c = j.url ? parseCoords(j.url) : null;
    if (c) return c;
    // link theo tên địa điểm (không có toạ độ) → tìm theo tên
    return typeof j.q === 'string' && j.q.trim() ? { q: j.q.trim() } : null;
  } catch {
    return null;
  }
}

async function doSearch(q: string): Promise<void> {
  searchCtl?.abort();
  const ctl = (searchCtl = new AbortController());
  // gõ/dán toạ độ (hoặc link Google Maps) → đi thẳng tới điểm đó, kèm tên nơi nếu tra được
  let c = parseCoords(q);
  if (!c && isShortMapLink(q)) {
    destMsg('Đang mở link Google Maps…');
    const ex = await expandMapLink(q, ctl.signal);
    if (ctl.signal.aborted) return;
    if (ex && 'q' in ex) {
      destMsg(`Link là địa điểm “${ex.q}” — đang tìm theo tên…`);
      return doSearch(ex.q);
    }
    c = ex;
    if (!c) {
      renderResults([]);
      return destMsg('Chưa mở được link rút gọn. Cách khác: trong Google Maps chạm giữ vào điểm → chép toạ độ (dạng 10.77, 106.70) rồi dán vào đây.');
    }
  }
  if (c) {
    const coordPlace: Place = { name: `Toạ độ ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`, detail: lastFix ? `cách ${formatDistance(haversine(lastFix, c))}` : 'Điểm theo toạ độ', lat: c.lat, lng: c.lng };
    renderResults([coordPlace]);
    destMsg('');
    if (!navigator.onLine) return;
    const nearby = await reversePlace(c.lat, c.lng, ctl.signal);
    if (ctl.signal.aborted || !nearby[0]) return;
    renderResults([{ ...coordPlace, detail: `${coordPlace.detail} · gần ${nearby[0].name}${nearby[0].detail ? `, ${nearby[0].detail}` : ''}` }]);
    return;
  }
  destMsg('Đang tìm…');
  const near = lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null;
  const local = searchLocal(await localEntries(), q, near, 5);
  if (ctl.signal.aborted) return;
  if (local.length) renderResults(local);
  try {
    const online = navigator.onLine ? await searchPlaces(q, near, ctl.signal) : [];
    if (ctl.signal.aborted) return;
    const all = mergePlaces(local, online);
    renderResults(all);
    destMsg(all.length ? '' : 'Không tìm thấy nơi nào khớp.');
  } catch (e) {
    if ((e as Error).name === 'AbortError') return;
    renderResults(local);
    destMsg(local.length ? '' : 'Không tìm được lúc này (có thể mất mạng). Thử lại sau.');
  }
}

async function choose(p: Place): Promise<void> {
  destMsg('Đang tìm đường…');
  try {
    await beginRoute(p, true, true);
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
  // ô tìm còn nội dung từ lần trước (vd link/toạ độ đã dán) → tìm lại ngay
  const prev = destQ.value.trim();
  if (prev.length >= 3) void doSearch(prev);
});
$('btn-dest-close').addEventListener('click', () => destDlg.close());

/* Chọn điểm đến bằng cách kéo bản đồ dưới ghim cố định */
function startPick(): void {
  if (!mapView || !lastFix) {
    destMsg('Hãy bấm “Bắt đầu lái xe” và chờ bản đồ hiện rồi chọn trên bản đồ.');
    return;
  }
  destDlg.close();
  setMapFull(true);
  mapView.stopFollow();
  mapbox.classList.add('picking');
  $('map-pick').hidden = false;
  $('map-pick-hint').textContent = 'Kéo bản đồ để đặt ghim vào nơi muốn đến';
}
function endPick(): void {
  mapbox.classList.remove('picking');
  $('map-pick').hidden = true;
}
$('btn-dest-map').addEventListener('click', startPick);
$('btn-pick-cancel').addEventListener('click', () => {
  endPick();
  mapView?.recenter();
});
$('btn-pick-go').addEventListener('click', async () => {
  const c = mapView?.center();
  if (!c) return;
  const btn = $('btn-pick-go') as HTMLButtonElement;
  btn.disabled = true;
  $('map-pick-hint').textContent = 'Đang tìm đường…';
  try {
    const place = pickedPlace(c.lat, c.lng, navigator.onLine ? await reversePlace(c.lat, c.lng) : []);
    endPick();
    await beginRoute(place, true, true);
    if (!choice) mapView?.recenter();
  } catch (e) {
    $('map-pick-hint').textContent = (e as Error).message || 'Không tìm được đường đi tới điểm này.';
  } finally {
    btn.disabled = false;
  }
});
$('btn-nav-stop').addEventListener('click', stopNav);
// bấm Enter / nút tìm trên bàn phím → tìm ngay, không chờ
destQ.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const q = destQ.value.trim();
  if (q.length < 2) return;
  if (searchTimer !== null) window.clearTimeout(searchTimer);
  void doSearch(q);
});
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
window.addEventListener('online', () => {
  refreshNotes();
  mapView?.reloadTiles();
  void syncMarks(true);
});
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

/* ---------- Tự cập nhật ---------- */
let updatePending = false;
function applyUpdateIfSafe(): void {
  const a = updateAction(updatePending, mode);
  if (a === 'reload') location.reload();
  else if (a === 'prompt') toast('Đã có bản mới của app.', () => location.reload(), 'Cập nhật', 20_000);
}
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  let controlled = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true; // lần cài đầu tiên: trang đang chạy đã là bản mới
      return;
    }
    updatePending = true;
    applyUpdateIfSafe();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      const check = () => void reg.update().catch(() => {});
      window.setInterval(check, 15 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
      window.addEventListener('online', check);
    })
    .catch(() => {});
}

/* ---------- 8 tính năng (HUD, địa điểm lưu, nhắc nghỉ, báo đèn, chuyến đi, đội xe, lệnh giọng nói, camera hành trình) ---------- */
const features = setupFeatures({
  $,
  lsGet,
  lsSet,
  speak: (t) => voice.speak(t),
  toast,
  lastFix: () => lastFix,
  heading: () => engine.currentHeading(),
  mode: () => mode,
  deviceId,
  goTo: async (p, pick = false) => {
    await beginRoute(p, true, pick);
    if (destDlg.open) destDlg.close();
  },
  stopNav,
  markCamera: markHere,
  toggleVoice: (on) => {
    voice.enabled = on;
    settings.voice = on;
    saveSettings();
    applyVoiceUi();
    voice.speak(on ? 'Đã bật giọng nói.' : 'Đã tắt giọng nói.', true);
  },
  openSettings: () => settingsDlg.showModal(),
  closeSettings: () => settingsDlg.close(),
});

/* ---------- nhóm 2: chia sẻ hành trình, thời tiết, cấm xe tải/ngập, SOS, tuần tra, QR, đèn tín hiệu, OBD, nhận dạng biển ---------- */
let speedOverrideKmh: number | null = null;
const features2 = setupFeatures2({
  $,
  lsGet,
  lsSet,
  speak: (t) => voice.speak(t),
  toast,
  lastFix: () => lastFix,
  heading: () => engine.currentHeading(),
  mode: () => mode,
  deviceId,
  goTo: async (p, pick = false) => {
    await beginRoute(p, true, pick);
    if (destDlg.open) destDlg.close();
  },
  stopNav,
  markCamera: markHere,
  toggleVoice: () => {},
  openSettings: () => settingsDlg.showModal(),
  closeSettings: () => settingsDlg.close(),
  view: () => engine.view(),
  navInfo: () => {
    if (!navRoute || !navDest || !lastNavState) return null;
    const secs = (navRoute.durS * lastNavState.remainingM) / Math.max(1, navRoute.distM);
    return { dest: navDest.name, etaT: Date.now() + secs * 1000 };
  },
  reportHere: features.reportHere,
  camPreview: features.camPreview,
  onImpact: features.onImpact,
  setSpeedOverride: (k) => (speedOverrideKmh = k),
  vehicle: () => settings.vehicle,
  showDialog: (id) => {
    settingsDlg.close();
    ($(id) as HTMLDialogElement).showModal();
  },
});
/* ---------- Góp ý & đánh giá gửi người phát triển ---------- */
const feedback = setupFeedback({
  $,
  lsGet,
  lsSet,
  toast,
  lastFix: () => lastFix,
  view: () => engine.view(),
  segment: () => engine.currentSegment(),
  vehicle: () => settings.vehicle,
  deviceId,
  closeSettings: () => settingsDlg.close(),
});
$('btn-obd-open').addEventListener('click', () => {
  settingsDlg.close();
  ($('obd') as HTMLDialogElement).showModal();
});

applyTheme();
applyVoiceUi();
refreshNotes();
