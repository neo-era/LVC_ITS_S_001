/** Nối giao diện nhóm 2: chia sẻ hành trình, thời tiết, cấm xe tải/ngập, SOS, tuần tra, QR trụ, đèn tín hiệu, OBD-II, nhận dạng biển. */
import { haversine } from '../core/geo';
import { formatDistance } from '../core/format';
import type { GpsSample } from '../core/gps';
import type { ViewState } from '../engine';
import { authHeaders, SUPABASE_URL } from '../sync';
import { ImpactDetector } from './dashcam-plan';
import { fleetPingBody, shareName } from './fleet';
import { Obd, ObdSanity } from './obd';
import { dupCodes, parsePoles, patrolCsv, PoleTracker, STATUS_LABEL, type PatrolRecord, type Pole, type PoleStatus } from './patrol';
import { poleFromSearch, poleUrl, qrSvg } from './qr';
import { fmtVnTime, type Report } from './reports';
import { glosa, parseSignals, phaseAt, pickApproach, signalAhead, type SignalPlan } from './signals';
import { DigitTemplates, findRedCircles, readLimit, SignVoter } from './signocr';
import { CrashConfirm, smsUrl, sosMessage, validPhone } from './sos';
import { weatherAdvice, weatherUrl, type Advice } from './weather';
import type { Vehicle } from '../core/vehicle';
import { freshFix, type Ctx } from './wire';

export interface Ctx2 extends Ctx {
  view: () => ViewState;
  navInfo: () => { dest: string; etaT: number } | null;
  reportHere: (kind: Report['kind'], pole?: string, at?: { lat: number; lng: number }, now?: boolean) => boolean;
  camPreview: () => HTMLVideoElement | null;
  onImpact: (fn: () => void) => void;
  setSpeedOverride: (kmh: number | null) => void;
  vehicle: () => Vehicle;
  showDialog: (id: string) => void;
}

const rand = (n: number) => {
  const out: string[] = [];
  while (out.length < n) {
    const a = new Uint8Array(n * 2);
    crypto.getRandomValues(a);
    // 252 = 7 × 36: bỏ giá trị ≥ 252 để phân bố đều
    for (const b of a) if (b < 252 && out.length < n) out.push((b % 36).toString(36));
  }
  return out.join('').toUpperCase();
};

/** fetch có hạn giờ (AbortSignal.timeout chưa có trên iOS < 16). */
function fetchT(url: string, ms: number, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  return fetch(url, { ...init, signal: ac.signal }).finally(() => clearTimeout(t));
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function setupFeatures2(ctx: Ctx2) {
  const { $ } = ctx;
  const chips = $('status-chips');
  const chip = (id: string, text: string, cls = '', onClick?: () => void) => {
    let el = document.getElementById(`chip-${id}`);
    if (!text) return el?.remove();
    if (!el) {
      el = document.createElement(onClick ? 'button' : 'span');
      el.id = `chip-${id}`;
      if (onClick) {
        (el as HTMLButtonElement).type = 'button';
        el.addEventListener('click', onClick);
      }
      chips.append(el);
    }
    el.className = `status-chip ${cls}`;
    el.textContent = text;
  };

  /* ===== 15. Chia sẻ hành trình ===== */
  const SHARE_KEY = 'lat.share';
  const ssGet = (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  };
  const ssSet = (k: string, v: string | null) => {
    try {
      if (v === null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch {
      /* bỏ qua */
    }
  };
  // app bị hệ điều hành đóng/tự cập nhật giữa chuyến → tiếp tục chia sẻ với cùng link
  let shareToken: string | null = ssGet(SHARE_KEY);
  let lastShare = 0;
  const showShare = () => {
    $('btn-share').classList.toggle('active', !!shareToken);
    chip('share', shareToken ? 'Đang chia sẻ hành trình · bấm để tắt' : '', 'ok', () => {
      stopShare();
      ctx.toast('Đã tắt chia sẻ hành trình.');
    });
  };
  async function shareLink(): Promise<void> {
    const tok = shareToken ?? `S-${rand(14)}`;
    const url = new URL('./fleet.html', location.href).href + `#${tok}`;
    const text = `Theo dõi hành trình của tôi: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Theo dõi hành trình', text, url });
      else {
        await navigator.clipboard.writeText(url);
        ctx.toast('Đã chép link theo dõi. Gửi cho người nhà qua Zalo/tin nhắn.');
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return; // người dùng huỷ: không bật chia sẻ
      ctx.toast(url, undefined, undefined, 15_000);
    }
    shareToken = tok;
    ssSet(SHARE_KEY, tok);
    lastShare = 0;
    showShare();
    ctx.speak('Đang chia sẻ hành trình.');
  }
  async function pingShare(f: GpsSample, v: ViewState): Promise<void> {
    if (!shareToken || !navigator.onLine || Date.now() - lastShare < 15_000) return;
    lastShare = Date.now();
    const nav = ctx.navInfo();
    const name = nav ? shareName(ctx.lsGet('lat.fleet.name') || 'Xe', nav.dest, nav.etaT) : ctx.lsGet('lat.fleet.name') || 'Xe';
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/fleet_ping`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(fleetPingBody(shareToken, ctx.deviceId(), name, { lat: f.lat, lng: f.lng, kmh: v.kmh, heading: ctx.heading() })),
      });
    } catch {
      /* lần sau */
    }
  }
  function stopShare(): void {
    if (!shareToken) return;
    const tok = shareToken;
    shareToken = null;
    ssSet(SHARE_KEY, null);
    showShare();
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/fleet_leave`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ p_team: tok, p_device: ctx.deviceId() }),
    }).catch(() => {});
  }
  if (shareToken) showShare();
  $('btn-share').addEventListener('click', () => (shareToken ? (stopShare(), ctx.toast('Đã tắt chia sẻ hành trình.')) : void shareLink()));

  /* ===== 12. Thời tiết ===== */
  let advice: Advice = { level: 'none', reduceKmh: 0, text: '' };
  let weatherAt = 0;
  let weatherSpoken = '';
  async function refreshWeather(f: GpsSample): Promise<void> {
    if (!navigator.onLine || Date.now() - weatherAt < 15 * 60_000 || ctx.lsGet('lat.weather') === '0') return;
    weatherAt = Date.now();
    try {
      const r = await fetchT(weatherUrl(f.lat, f.lng), 8000);
      const j = (await r.json()) as { current?: { weather_code?: number; rain?: number; precipitation?: number; visibility?: number } };
      const c = j.current ?? {};
      advice = weatherAdvice({ code: c.weather_code ?? null, rainMm: c.rain ?? c.precipitation ?? null, visibilityM: c.visibility ?? null });
      chip('weather', advice.level === 'none' ? '' : `${advice.text}`, 'warn');
      if (advice.level !== 'none' && weatherSpoken !== advice.level) {
        weatherSpoken = advice.level;
        ctx.speak(advice.text);
      }
      if (advice.level === 'none') weatherSpoken = '';
    } catch {
      /* giữ khuyến nghị cũ */
    }
  }

  /* ===== 13. Cấm xe tải / ngập ===== */
  let banSpokenAt = 0;
  function renderBan(v: ViewState): void {
    chip('ban', v.truckBan ? 'Đường cấm xe tải giờ này' : '', 'danger');
    if (v.truckBan && Date.now() - banSpokenAt > 120_000) {
      banSpokenAt = Date.now();
      ctx.speak('Chú ý: đường này cấm xe tải vào giờ này.');
    }
  }

  /* ===== 14. SOS ===== */
  const sosPhone = $('set-sos-phone') as HTMLInputElement;
  const sosOn = $('set-sos-on') as HTMLInputElement;
  sosPhone.value = ctx.lsGet('lat.sos.phone') ?? '';
  sosOn.checked = ctx.lsGet('lat.sos.on') === '1';
  sosPhone.addEventListener('change', () => {
    const v = sosPhone.value.trim();
    ctx.lsSet('lat.sos.phone', v);
    if (v && !validPhone(v)) ctx.toast('Số điện thoại SOS chưa đúng (cần 9–12 chữ số).');
  });
  // xe máy dằn xóc nhiều hơn → ngưỡng cao hơn
  const sosDetector = new ImpactDetector(2.5);
  const sosDetectorMoto = new ImpactDetector(3.5);
  const crash = new CrashConfirm();
  let sosMotionOn = false;
  const onSosMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null || ctx.mode() !== 'gps') return;
    const det = ctx.vehicle() === 'motorbike' ? sosDetectorMoto : sosDetector;
    if (det.push({ x: a.x, y: a.y, z: a.z }, Date.now())) onShock();
  };
  /** Cú sốc mạnh: chưa báo ngay, chờ xác nhận xe dừng hẳn (tránh báo nhầm khi qua ổ gà). */
  function onShock(): void {
    if (!sosOn.checked || ctx.mode() !== 'gps') return;
    crash.shock(Date.now());
  }
  setInterval(() => crash.tick(Date.now()) === 'trigger' && triggerSos(), 1000);
  const motionPermissionFn = (): (() => Promise<string>) | null => {
    if (typeof DeviceMotionEvent === 'undefined') return null;
    const f = (DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission;
    return typeof f === 'function' ? f : null;
  };
  async function armSos(on: boolean): Promise<void> {
    if (on) {
      const req = motionPermissionFn();
      if (req) {
        try {
          if ((await req()) !== 'granted') ctx.toast('Chưa được cấp quyền cảm biến: SOS chỉ kích hoạt được từ camera hành trình hoặc bằng tay.');
        } catch {
          ctx.toast('Không xin được quyền cảm biến (cần bật từ thao tác chạm). SOS vẫn chạy khi camera hành trình phát hiện va chạm.');
        }
      }
      if (typeof DeviceMotionEvent !== 'undefined' && !sosMotionOn) window.addEventListener('devicemotion', onSosMotion);
      sosMotionOn = true;
    } else if (sosMotionOn) {
      window.removeEventListener('devicemotion', onSosMotion);
      sosMotionOn = false;
    }
  }
  sosOn.addEventListener('change', () => {
    ctx.lsSet('lat.sos.on', sosOn.checked ? '1' : '0');
    void armSos(sosOn.checked);
  });
  if (sosOn.checked && !motionPermissionFn()) void armSos(true);
  // iOS: quyền cảm biến phải xin trong thao tác chạm → xin lại mỗi lần bấm "Bắt đầu lái xe"
  $('btn-start').addEventListener('click', () => {
    if (sosOn.checked && motionPermissionFn()) void armSos(true);
  });
  ctx.onImpact(() => onShock());
  let sosTimer: number | null = null;
  let sosTick: number | null = null;
  function triggerSos(): void {
    if (!sosOn.checked || sosTimer !== null) return;
    const box = $('sos') as HTMLDialogElement;
    document.querySelectorAll('dialog[open]').forEach((d) => d !== box && (d as HTMLDialogElement).close());
    if (!box.open) box.showModal();
    let left = 20;
    $('sos-count').textContent = String(left);
    ctx.speak('Phát hiện va chạm. Anh có ổn không? Sau 20 giây sẽ mở tin nhắn khẩn cấp.');
    if (navigator.vibrate) navigator.vibrate([400, 200, 400]);
    sosTick = window.setInterval(() => ($('sos-count').textContent = String(--left)), 1000);
    sosTimer = window.setTimeout(() => sendSos(), 20_000);
  }
  function closeSos(): void {
    if (sosTimer !== null) clearTimeout(sosTimer);
    if (sosTick !== null) clearInterval(sosTick);
    sosTimer = null;
    sosTick = null;
    const box = $('sos') as HTMLDialogElement;
    if (box.open) box.close();
  }
  ($('sos') as HTMLDialogElement).addEventListener('cancel', (e) => {
    e.preventDefault();
    closeSos();
  });
  function sendSos(): void {
    closeSos();
    const f = ctx.lastFix();
    const phone = sosPhone.value.trim();
    if (!phone || !validPhone(phone)) return ctx.toast('Chưa có số điện thoại người thân hợp lệ trong Cài đặt → SOS.');
    const msg = sosMessage(f ? { lat: f.lat, lng: f.lng, t: f.t } : null, Date.now(), ctx.lsGet('lat.fleet.name') || '');
    ctx.speak('Đang mở tin nhắn khẩn cấp. Hãy bấm gửi.');
    location.href = smsUrl(phone, msg);
  }
  $('btn-sos-ok').addEventListener('click', () => {
    closeSos();
    ctx.speak('Đã huỷ.');
  });
  $('btn-sos-send').addEventListener('click', sendSos);
  $('btn-sos-test').addEventListener('click', () => {
    if (!sosOn.checked) return ctx.toast('Bật SOS trước.');
    triggerSos();
  });

  /* ===== 9. Tuần tra chiếu sáng ===== */
  const POLES = 'lat.poles.v1';
  const PATROL = 'lat.patrol.v1';
  let poles: Pole[] = (() => {
    try {
      const raw = ctx.lsGet(POLES) ?? '';
      if (raw.startsWith('[')) {
        const v = JSON.parse(raw) as unknown[];
        if (!Array.isArray(v)) return [];
        return v
          .map((e): Pole | null => (Array.isArray(e) && typeof e[0] === 'string' && Number.isFinite(e[1]) && Number.isFinite(e[2]) ? { code: e[0], lat: e[1], lng: e[2], ...(typeof e[3] === 'string' ? { route: e[3] } : {}) } : null))
          .filter((p): p is Pole => p !== null);
      }
      return parsePoles(raw); // bản cũ lưu nguyên văn CSV
    } catch {
      return [];
    }
  })();
  let records: PatrolRecord[] = (() => {
    try {
      const v = JSON.parse(ctx.lsGet(PATROL) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  })();
  let patrolOn = false;
  let current: { pole: Pole; distM: number } | null = null;
  const tracker = new PoleTracker();
  const checked = () => new Set(records.map((r) => r.code));
  const savePatrol = () => ctx.lsSet(PATROL, JSON.stringify(records)) || ctx.toast('Bộ nhớ máy đầy: kết quả tuần tra chưa lưu được. Hãy xuất CSV ngay.');
  function renderPatrolInfo(): void {
    const done = checked().size;
    $('patrol-info').textContent = poles.length
      ? `${poles.length} trụ đã nạp · đã kiểm ${done} · đèn tắt/hư ${records.filter((r) => r.status !== 'sang').length}`
      : 'Chưa nạp danh sách trụ. Chọn file CSV (cột: mã trụ, vĩ độ, kinh độ, tuyến) hoặc GeoJSON xuất từ app khảo sát.';
    ($('patrol-on') as HTMLInputElement).checked = patrolOn;
  }
  ($('patrol-file') as HTMLInputElement).addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const text = await file.text();
    const p = parsePoles(text);
    if (!p.length) return ctx.toast('Không đọc được trụ nào từ file. Cần cột mã trụ, vĩ độ, kinh độ.');
    poles = p;
    tracker.reset();
    // lưu bản đã đọc (gọn hơn nhiều so với nguyên văn file)
    const stored = ctx.lsSet(POLES, JSON.stringify(p.map((x) => (x.route ? [x.code, +x.lat.toFixed(6), +x.lng.toFixed(6), x.route] : [x.code, +x.lat.toFixed(6), +x.lng.toFixed(6)]))));
    records = [];
    savePatrol();
    renderPatrolInfo();
    const dups = dupCodes(p);
    ctx.toast(
      `Đã nạp ${p.length} trụ.${dups.length ? ` Có ${dups.length} mã trùng (vd ${dups.slice(0, 3).join(', ')}) — mỗi mã chỉ ghi được một kết quả.` : ''}${stored ? '' : ' Danh sách quá lớn để lưu lâu dài: dùng được tới khi đóng app.'}`,
      undefined,
      undefined,
      8000,
    );
  });
  $('patrol-on').addEventListener('change', (e) => {
    patrolOn = (e.target as HTMLInputElement).checked;
    if (patrolOn && !poles.length) {
      patrolOn = false;
      (e.target as HTMLInputElement).checked = false;
      return ctx.toast('Nạp danh sách trụ trước.');
    }
    $('patrol-box').hidden = !patrolOn;
    if (patrolOn) {
      ctx.speak(`Bắt đầu tuần tra, ${poles.length - checked().size} trụ chưa kiểm.`);
      renderPatrol();
    } else {
      current = null;
      tracker.reset();
    }
  });
  $('btn-patrol').addEventListener('click', () => {
    renderPatrolInfo();
    ctx.showDialog('patrol');
  });
  $('btn-patrol-csv').addEventListener('click', () => download(`tuan-tra-${new Date().toISOString().slice(0, 10)}.csv`, patrolCsv(poles, records)));
  $('btn-patrol-reset').addEventListener('click', () => {
    records = [];
    savePatrol();
    renderPatrolInfo();
    ctx.toast('Đã xoá kết quả, bắt đầu lượt tuần tra mới.');
  });
  function markPole(status: PoleStatus): void {
    if (!current) return;
    const p = current.pole;
    records = [...records.filter((r) => r.code !== p.code), { code: p.code, status, t: Date.now() }];
    savePatrol();
    ctx.speak(`${p.code}: ${STATUS_LABEL[status].toLowerCase()}.`);
    // dùng toạ độ trụ trong danh sách (xe có thể đang cách trụ vài chục mét)
    if (status !== 'sang') ctx.reportHere(status === 'tat' ? 'den_tat' : 'su_co', p.code, { lat: p.lat, lng: p.lng });
    current = null;
    renderPatrol();
  }
  $('btn-pole-ok').addEventListener('click', () => markPole('sang'));
  $('btn-pole-off').addEventListener('click', () => markPole('tat'));
  $('btn-pole-bad').addEventListener('click', () => markPole('hu'));
  let lastPoleCode = '';
  let lastPatrolFix: GpsSample | null = null;
  function renderPatrol(f?: GpsSample): void {
    if (!patrolOn) return;
    if (f) lastPatrolFix = f;
    const fx = f ?? lastPatrolFix ?? ctx.lastFix();
    const box = $('patrol-box');
    box.hidden = false;
    if (!fx) {
      current = null;
      $('pole-name').textContent = 'Bấm “Bắt đầu lái xe” để tuần tra';
      $('pole-dist').textContent = `${checked().size}/${poles.length}`;
      box.classList.remove('near');
      return;
    }
    current = tracker.update(poles, { lat: fx.lat, lng: fx.lng }, ctx.heading(), checked(), fx.t);
    if (!current) {
      $('pole-name').textContent = 'Không có trụ chưa kiểm trong 80 m';
      $('pole-dist').textContent = `${checked().size}/${poles.length}`;
      box.classList.remove('near');
      return;
    }
    $('pole-name').textContent = `${current.pole.code}${current.pole.route ? ` · ${current.pole.route}` : ''}`;
    $('pole-dist').textContent = formatDistance(current.distM);
    box.classList.toggle('near', current.distM < 30);
    if (lastPoleCode !== current.pole.code) {
      lastPoleCode = current.pole.code;
      ctx.speak(`Sắp tới trụ ${current.pole.code}.`);
    }
  }

  /* ===== 10. QR trụ đèn ===== */
  const QR_BATCH = 200; // mỗi file in tối đa 200 mã (5.000 mã một lúc làm treo trình duyệt)
  $('btn-qr-print').addEventListener('click', () => {
    if (!poles.length) return ctx.toast('Nạp danh sách trụ trước (mục Tuần tra).');
    const base = new URL('./', location.href).href;
    const esc = (t: string) => t.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const batches = Math.ceil(poles.length / QR_BATCH);
    const standalone = matchMedia('(display-mode: standalone)').matches;
    for (let k = 0; k < batches; k++) {
      const part = poles.slice(k * QR_BATCH, (k + 1) * QR_BATCH);
      const items = part
        .map((p) => `<figure><div class="q">${qrSvg(poleUrl(base, p.code))}</div><figcaption>${esc(p.code)}${p.route ? `<br><small>${esc(p.route)}</small>` : ''}</figcaption></figure>`)
        .join('');
      const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mã QR trụ đèn ${k + 1}/${batches}</title><style>
      body{font-family:Arial,sans-serif;margin:10mm}h1{font-size:16px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6mm}
      figure{margin:0;text-align:center;break-inside:avoid;border:1px solid #ccc;padding:3mm;border-radius:3mm}.q svg{width:38mm;height:38mm}
      figcaption{font-weight:700;font-size:13px;margin-top:2mm}small{font-weight:400;color:#555}@media print{h1,p{display:none}}</style></head>
      <body><h1>Mã QR trụ đèn — quét bằng camera điện thoại để báo sự cố</h1><p>Phần ${k + 1}/${batches} · ${part.length} mã. Bấm Ctrl+P / Chia sẻ → In.</p><div class="grid">${items}</div></body></html>`;
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      // 1 phần và không chạy dạng app cài đặt → mở tab in; còn lại tải file HTML về để mở và in
      const win = batches === 1 && !standalone ? window.open(url, '_blank') : null;
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `ma-qr-tru-${k + 1}-${batches}.html`;
        document.body.append(a);
        a.click();
        a.remove();
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
    if (batches > 1 || standalone) ctx.toast(`Đã tải ${batches} file mã QR (mỗi file ≤ ${QR_BATCH} mã). Mở file để in.`, undefined, undefined, 8000);
  });
  const scanned = poleFromSearch(location.search);
  if (scanned) {
    history.replaceState(null, '', location.pathname);
    $('qr-pole').textContent = scanned;
    ctx.showDialog('qrreport');
    let sending = false;
    const done = (ok: boolean) => {
      sending = false;
      if (ok) ($('qrreport') as HTMLDialogElement).close();
    };
    const send = (kind: Report['kind']) => {
      if (sending) return;
      const p = poles.find((x) => x.code === scanned);
      // đứng ngay trụ: dùng toạ độ trụ trong danh sách (chính xác hơn GPS)
      if (p) return done(ctx.reportHere(kind, scanned, { lat: p.lat, lng: p.lng }, true));
      const f = freshFix(ctx.lastFix());
      if (f) return done(ctx.reportHere(kind, scanned, { lat: f.lat, lng: f.lng }, true));
      // người dân quét QR: app chưa chạy GPS → xin vị trí một lần
      if (!('geolocation' in navigator)) return ctx.toast('Điện thoại không cho lấy vị trí.');
      sending = true;
      ctx.toast('Đang lấy vị trí…', undefined, undefined, 15_000);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (pos.coords.accuracy > 100) {
            ctx.toast('Vị trí chưa đủ chính xác (sai số lớn). Ra chỗ thoáng rồi bấm lại.');
            return done(false);
          }
          done(ctx.reportHere(kind, scanned, { lat: pos.coords.latitude, lng: pos.coords.longitude }, true));
        },
        () => {
          ctx.toast('Không lấy được vị trí. Hãy cho phép quyền Vị trí rồi bấm lại.');
          done(false);
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
      );
    };
    $('btn-qr-off').addEventListener('click', () => send('den_tat'));
    $('btn-qr-bad').addEventListener('click', () => send('su_co'));
  }

  /* ===== 11. Đèn tín hiệu ===== */
  let signals: SignalPlan[] = [];
  let signalsLoaded = false;
  const loadSignals = () =>
    !signalsLoaded &&
    void fetch('./rules/signals.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        signals = parseSignals(j);
        signalsLoaded = true;
      })
      .catch(() => {});
  loadSignals();
  window.addEventListener('online', loadSignals);
  const SIM_SIGNALS: SignalPlan[] = [
    { id: 'SIM-N', name: 'Nút mô phỏng', lat: 10.77 + 2200 / 111195, lng: 106.7, cycleS: 90, offsetS: 0, approaches: [{ heading: 0, greenStart: 0, greenEnd: 35, yellowS: 3 }] },
  ];
  let sigSpoken = '';
  function renderSignal(f: GpsSample, v: ViewState): void {
    const list = ctx.mode() === 'sim' ? SIM_SIGNALS : signals;
    const h = ctx.heading();
    let best: { s: SignalPlan; a: number; d: number } | null = null;
    for (const s of list) {
      const d = haversine(f, s);
      if (d > 400 || d < 15) continue;
      if (!signalAhead(f, s, h)) continue; // nút đã ở sau lưng
      const a = pickApproach(s, h);
      if (a < 0) continue;
      if (!best || d < best.d) best = { s, a, d };
    }
    if (!best) {
      chip('sig', '');
      sigSpoken = '';
      return;
    }
    const ph = phaseAt(best.s, best.a, f.t);
    const g = glosa(best.d, ph, v.limit, v.kmh ?? 0);
    const color = ph.color === 'green' ? 'Xanh' : ph.color === 'yellow' ? 'Vàng' : 'Đỏ';
    let text = `${best.s.name}: ${color} còn ${ph.remainS}s`;
    if (g) text += ph.color === 'green' ? ` · giữ ${g.minKmh}–${g.maxKmh} km/h là qua` : ` · chạy ≤ ${g.maxKmh} km/h tới nơi vừa xanh`;
    chip('sig', text, ph.color === 'red' ? 'danger' : ph.color === 'green' ? 'ok' : 'warn');
    const key = `${best.s.id}:${ph.color}`;
    if (sigSpoken !== key && best.d < 300) {
      sigSpoken = key;
      // chỉ đọc màu và số giây, không đọc lời khuyên tốc độ
      const say = ph.color === 'red' ? `Đèn đỏ phía trước, còn ${ph.remainS} giây.` : ph.color === 'green' && g ? `Đèn xanh còn ${ph.remainS} giây.` : '';
      if (say) ctx.speak(say);
    }
  }

  /* ===== 16. OBD-II ===== */
  const obd = new Obd();
  const sanity = new ObdSanity();
  let obdAt = 0;
  let obdInfo = { rpm: 0, coolant: 0 };
  let gps = { kmh: null as number | null, acc: Infinity, t: 0 };
  let obdDistrusted = false;
  obd.onValue = (v) => {
    if (v.pid === 'speed') {
      const now = Date.now();
      const good = now - gps.t < 3000 && gps.acc <= 20 ? gps.kmh : null;
      if (sanity.push(v.value, good, now)) {
        obdAt = now;
        ctx.setSpeedOverride(v.value);
      } else {
        ctx.setSpeedOverride(null);
        if (!obdDistrusted) {
          obdDistrusted = true;
          ctx.toast('Tốc độ OBD lệch nhiều so với GPS — tạm dùng GPS. Kiểm tra đầu đọc OBD.', undefined, undefined, 8000);
        }
      }
    } else if (v.pid === 'rpm') obdInfo.rpm = v.value;
    else obdInfo.coolant = v.value;
    chip('obd', `OBD · ${obdInfo.rpm} v/p · ${obdInfo.coolant}°C`, 'ok');
  };
  obd.onClose = () => {
    chip('obd', '');
    ctx.setSpeedOverride(null);
    $('obd-status').textContent = 'Đã ngắt kết nối.';
  };
  $('btn-obd').addEventListener('click', async () => {
    if (!Obd.supported()) return ($('obd-status').textContent = 'Trình duyệt này không có Web Bluetooth (chỉ Chrome trên Android).');
    $('obd-status').textContent = 'Đang tìm đầu đọc…';
    try {
      sanity.reset();
      obdDistrusted = false;
      await obd.connect();
      $('obd-status').textContent = 'Đã kết nối. Tốc độ lấy từ xe thay cho GPS (có đối chiếu với GPS).';
    } catch (e) {
      $('obd-status').textContent = (e as Error).message || 'Không kết nối được.';
    }
  });
  $('btn-obd-off').addEventListener('click', () => obd.close());
  setInterval(() => {
    if (obdAt && Date.now() - obdAt > 3000) {
      obdAt = 0;
      ctx.setSpeedOverride(null);
    }
  }, 1000);

  /* ===== 17. Nhận dạng biển tốc độ (thử nghiệm) ===== */
  const ocrOn = $('set-ocr') as HTMLInputElement;
  ocrOn.checked = ctx.lsGet('lat.ocr') === '1';
  ocrOn.addEventListener('change', () => ctx.lsSet('lat.ocr', ocrOn.checked ? '1' : '0'));
  let templates: DigitTemplates | null = null;
  const voter = new SignVoter();
  const work = document.createElement('canvas');
  const wctx = work.getContext('2d', { willReadFrequently: true });
  function makeDigit(d: string, font: string): ImageData {
    const c = document.createElement('canvas');
    c.width = 40;
    c.height = 56;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 40, 56);
    g.fillStyle = '#000';
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(d, 20, 28);
    return g.getImageData(0, 0, 40, 56);
  }
  let lastOcr = 0;
  let signAt = 0;
  const clearSign = () => {
    signAt = 0;
    chip('ocr', '');
  };
  const c2 = document.createElement('canvas');
  c2.width = 96;
  c2.height = 96;
  const g2 = c2.getContext('2d', { willReadFrequently: true });
  function runOcr(): void {
    // hết hạn 5 phút kiểm tra trước, kể cả khi đã tắt OCR/camera
    if (signAt && Date.now() - signAt > 5 * 60_000) clearSign();
    if (!ocrOn.checked) return clearSign();
    if (!wctx || !g2 || Date.now() - lastOcr < 1500) return;
    const video = ctx.camPreview();
    if (!video || video.videoWidth === 0) return;
    lastOcr = Date.now();
    templates ??= new DigitTemplates(makeDigit);
    const W = 320;
    const H = Math.round((video.videoHeight / video.videoWidth) * W);
    work.width = W;
    work.height = H;
    wctx.drawImage(video, 0, 0, W, H);
    const frame = wctx.getImageData(0, 0, W, H);
    let found: number | null = null;
    for (const b of findRedCircles(frame)) {
      // lòng biển ≈ 60% đường kính, phóng to để đọc
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = (Math.min(b.w, b.h) / 2) * 0.62;
      const S = 96;
      g2.clearRect(0, 0, S, S);
      g2.drawImage(work, cx - r, cy - r, 2 * r, 2 * r, 0, 0, S, S);
      const res = readLimit(g2.getImageData(8, 8, S - 16, S - 16), templates);
      if (res && res.conf >= 0.4) {
        found = res.value;
        break;
      }
    }
    const v = voter.push(found);
    if (v !== null) {
      signAt = Date.now();
      // chỉ để tham khảo: không thay giới hạn tốc độ (dễ đọc nhầm decal tốc độ dán sau xe tải)
      chip('ocr', `Biển nhận dạng: ${v} (tham khảo)`, 'ok');
    }
  }

  return {
    onSample(f: GpsSample, v: ViewState): void {
      renderBan(v);
      renderSignal(f, v);
      runOcr();
      if (ctx.mode() !== 'gps') return;
      if (crash.pending && v.kmh !== null && crash.sample(Date.now(), v.kmh) === 'trigger') triggerSos();
      void refreshWeather(f);
      void pingShare(f, v);
      renderPatrol(f);
    },
    onStop(): void {
      stopShare();
      closeSos();
      obd.close();
      crash.reset();
      weatherAt = 0;
      sigSpoken = '';
      clearSign();
      tracker.reset();
      current = null;
      $('patrol-box').hidden = true;
      chip('weather', '');
      chip('sig', '');
      chip('ban', '');
    },
    /** Tốc độ GPS gốc (trước khi thay bằng OBD) để đối chiếu. */
    gpsSpeed(kmh: number | null, acc: number, t: number): void {
      gps = { kmh, acc, t };
    },
    /** GPS mất tín hiệu: xoá các thẻ phụ thuộc vị trí để không đứng hình. */
    onLost(): void {
      chip('sig', '');
      chip('ban', '');
      sigSpoken = '';
    },
    advice: () => advice,
  };
}
