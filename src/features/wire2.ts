/** Nối giao diện nhóm 2: chia sẻ hành trình, thời tiết, cấm xe tải/ngập, SOS, tuần tra, QR trụ, đèn tín hiệu, OBD-II, nhận dạng biển. */
import { haversine } from '../core/geo';
import { formatDistance } from '../core/format';
import type { GpsSample } from '../core/gps';
import type { ViewState } from '../engine';
import { authHeaders, SUPABASE_URL } from '../sync';
import { ImpactDetector } from './dashcam-plan';
import { fleetPingBody, shareName } from './fleet';
import { Obd } from './obd';
import { nextPole, parsePoles, patrolCsv, STATUS_LABEL, type PatrolRecord, type Pole, type PoleStatus } from './patrol';
import { poleFromSearch, poleUrl, qrSvg } from './qr';
import { fmtVnTime, type Report } from './reports';
import { glosa, parseSignals, phaseAt, pickApproach, type SignalPlan } from './signals';
import { DigitTemplates, findRedCircles, readLimit, SignVoter } from './signocr';
import { smsUrl, sosMessage } from './sos';
import { weatherAdvice, weatherUrl, type Advice } from './weather';
import type { Ctx } from './wire';

export interface Ctx2 extends Ctx {
  view: () => ViewState;
  navInfo: () => { dest: string; etaT: number } | null;
  reportHere: (kind: Report['kind'], pole?: string, at?: { lat: number; lng: number }) => void;
  camPreview: () => HTMLVideoElement | null;
  onImpact: (fn: () => void) => void;
  setSpeedOverride: (kmh: number | null) => void;
  setSignLimit: (kmh: number | null) => void;
  showDialog: (id: string) => void;
}

const rand = (n: number) => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('').toUpperCase();
};

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
  const chip = (id: string, text: string, cls = '') => {
    let el = document.getElementById(`chip-${id}`);
    if (!text) return el?.remove();
    if (!el) {
      el = document.createElement('span');
      el.id = `chip-${id}`;
      chips.append(el);
    }
    el.className = `status-chip ${cls}`;
    el.textContent = text;
  };

  /* ===== 15. Chia sẻ hành trình ===== */
  let shareToken: string | null = null;
  let lastShare = 0;
  async function shareLink(): Promise<void> {
    if (!shareToken) shareToken = `S-${rand(14)}`;
    const url = new URL('./fleet.html', location.href).href + `#${shareToken}`;
    const text = `Theo dõi hành trình của tôi: ${url}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Theo dõi hành trình', text, url });
      else {
        await navigator.clipboard.writeText(url);
        ctx.toast('Đã chép link theo dõi. Gửi cho người nhà qua Zalo/tin nhắn.');
      }
    } catch {
      ctx.toast(url, undefined, undefined, 15_000);
    }
    $('btn-share').classList.add('active');
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
    $('btn-share').classList.remove('active');
    void fetch(`${SUPABASE_URL}/rest/v1/rpc/fleet_leave`, {
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify({ p_team: tok, p_device: ctx.deviceId() }),
    }).catch(() => {});
  }
  $('btn-share').addEventListener('click', () => (shareToken ? (stopShare(), ctx.toast('Đã tắt chia sẻ hành trình.')) : void shareLink()));

  /* ===== 12. Thời tiết ===== */
  let advice: Advice = { level: 'none', reduceKmh: 0, text: '' };
  let weatherAt = 0;
  let weatherSpoken = '';
  async function refreshWeather(f: GpsSample): Promise<void> {
    if (!navigator.onLine || Date.now() - weatherAt < 15 * 60_000 || ctx.lsGet('lat.weather') === '0') return;
    weatherAt = Date.now();
    try {
      const r = await fetch(weatherUrl(f.lat, f.lng), { signal: AbortSignal.timeout(8000) });
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
  sosPhone.addEventListener('change', () => ctx.lsSet('lat.sos.phone', sosPhone.value.trim()));
  const sosDetector = new ImpactDetector();
  let sosMotionOn = false;
  const onSosMotion = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null || ctx.mode() !== 'gps') return;
    if (sosDetector.push({ x: a.x, y: a.y, z: a.z }, Date.now())) triggerSos();
  };
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
  ctx.onImpact(() => triggerSos());
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
    if (!phone) return ctx.toast('Chưa có số điện thoại người thân trong Cài đặt → SOS.');
    const msg = sosMessage(f?.lat ?? 0, f?.lng ?? 0, Date.now(), ctx.lsGet('lat.fleet.name') || '');
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
      return parsePoles(ctx.lsGet(POLES) ?? '');
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
  const checked = () => new Set(records.map((r) => r.code));
  const savePatrol = () => ctx.lsSet(PATROL, JSON.stringify(records));
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
    try {
      ctx.lsSet(POLES, text.length < 4_000_000 ? text : '');
    } catch {
      ctx.toast('Danh sách quá lớn để lưu lâu dài; dùng được trong phiên này.');
    }
    records = [];
    savePatrol();
    renderPatrolInfo();
    ctx.toast(`Đã nạp ${p.length} trụ.`);
  });
  $('patrol-on').addEventListener('change', (e) => {
    patrolOn = (e.target as HTMLInputElement).checked;
    if (patrolOn && !poles.length) {
      patrolOn = false;
      (e.target as HTMLInputElement).checked = false;
      return ctx.toast('Nạp danh sách trụ trước.');
    }
    $('patrol-box').hidden = !patrolOn;
    if (patrolOn) ctx.speak(`Bắt đầu tuần tra, ${poles.length - checked().size} trụ chưa kiểm.`);
    else current = null;
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
    if (status !== 'sang') ctx.reportHere(status === 'tat' ? 'den_tat' : 'su_co', p.code);
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
    const fx = f ?? lastPatrolFix;
    if (fx) current = nextPole(poles, { lat: fx.lat, lng: fx.lng }, ctx.heading(), checked());
    const box = $('patrol-box');
    box.hidden = false;
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
  $('btn-qr-print').addEventListener('click', () => {
    if (!poles.length) return ctx.toast('Nạp danh sách trụ trước (mục Tuần tra).');
    const base = new URL('./', location.href).href;
    const items = poles
      .map((p) => `<figure><div class="q">${qrSvg(poleUrl(base, p.code))}</div><figcaption>${p.code.replace(/[<>&]/g, '')}${p.route ? `<br><small>${p.route.replace(/[<>&]/g, '')}</small>` : ''}</figcaption></figure>`)
      .join('');
    const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Mã QR trụ đèn</title><style>
      body{font-family:Arial,sans-serif;margin:10mm}h1{font-size:16px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:6mm}
      figure{margin:0;text-align:center;break-inside:avoid;border:1px solid #ccc;padding:3mm;border-radius:3mm}.q svg{width:38mm;height:38mm}
      figcaption{font-weight:700;font-size:13px;margin-top:2mm}small{font-weight:400;color:#555}@media print{h1,p{display:none}}</style></head>
      <body><h1>Mã QR trụ đèn — quét bằng camera điện thoại để báo sự cố</h1><p>Bấm Ctrl+P / Chia sẻ → In. ${poles.length} mã.</p><div class="grid">${items}</div></body></html>`;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
  const scanned = poleFromSearch(location.search);
  if (scanned) {
    history.replaceState(null, '', location.pathname);
    $('qr-pole').textContent = scanned;
    ctx.showDialog('qrreport');
    const send = (kind: Report['kind']) => {
      const p = poles.find((x) => x.code === scanned);
      // đứng ngay trụ: dùng toạ độ trụ trong danh sách (chính xác hơn GPS); không có thì cần GPS tốt
      if (p) ctx.reportHere(kind, scanned, { lat: p.lat, lng: p.lng });
      else if (ctx.lastFix()) ctx.reportHere(kind, scanned);
      else return ctx.toast('Chưa có vị trí. Bấm “Bắt đầu lái xe”, chờ GPS rồi quét lại.');
      ($('qrreport') as HTMLDialogElement).close();
    };
    $('btn-qr-off').addEventListener('click', () => send('den_tat'));
    $('btn-qr-bad').addEventListener('click', () => send('su_co'));
  }

  /* ===== 11. Đèn tín hiệu ===== */
  let signals: SignalPlan[] = [];
  void fetch('./rules/signals.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((j) => (signals = parseSignals(j)))
    .catch(() => {});
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
    const limit = v.limit ?? 50;
    const g = glosa(best.d, ph, limit);
    const color = ph.color === 'green' ? 'Xanh' : ph.color === 'yellow' ? 'Vàng' : 'Đỏ';
    let text = `${best.s.name}: ${color} còn ${ph.remainS}s`;
    if (g) text += ph.color === 'green' ? ` · giữ ${g.minKmh}–${g.maxKmh} km/h là qua` : ` · chạy ≤ ${g.maxKmh} km/h tới nơi vừa xanh`;
    chip('sig', text, ph.color === 'red' ? 'danger' : ph.color === 'green' ? 'ok' : 'warn');
    const key = `${best.s.id}:${ph.color}`;
    if (sigSpoken !== key && best.d < 300) {
      sigSpoken = key;
      ctx.speak(ph.color === 'red' ? `Đèn đỏ phía trước, còn ${ph.remainS} giây.` : ph.color === 'green' && g ? `Đèn xanh còn ${ph.remainS} giây, giữ ${g.minKmh} ki lô mét trên giờ là qua.` : '');
    }
  }

  /* ===== 16. OBD-II ===== */
  const obd = new Obd();
  let obdAt = 0;
  let obdInfo = { rpm: 0, coolant: 0 };
  obd.onValue = (v) => {
    if (v.pid === 'speed') {
      obdAt = Date.now();
      ctx.setSpeedOverride(v.value);
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
      await obd.connect();
      $('obd-status').textContent = 'Đã kết nối. Tốc độ lấy từ xe thay cho GPS.';
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
  function runOcr(): void {
    if (!ocrOn.checked || !wctx || Date.now() - lastOcr < 1500) return;
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
      const c2 = document.createElement('canvas');
      c2.width = S;
      c2.height = S;
      const g2 = c2.getContext('2d')!;
      g2.drawImage(work, cx - r, cy - r, 2 * r, 2 * r, 0, 0, S, S);
      const res = readLimit(g2.getImageData(8, 8, S - 16, S - 16), templates);
      if (res && res.conf >= 0.15) {
        found = res.value;
        break;
      }
    }
    const v = voter.push(found);
    if (v !== null) {
      signAt = Date.now();
      ctx.setSignLimit(v);
      chip('ocr', `Biển nhận dạng: ${v}`, 'ok');
    } else if (signAt && Date.now() - signAt > 5 * 60_000) {
      signAt = 0;
      ctx.setSignLimit(null);
      chip('ocr', '');
    }
  }

  return {
    onSample(f: GpsSample, v: ViewState): void {
      renderBan(v);
      renderSignal(f, v);
      runOcr();
      if (ctx.mode() !== 'gps') return;
      void refreshWeather(f);
      void pingShare(f, v);
      renderPatrol(f);
    },
    onStop(): void {
      stopShare();
      closeSos();
      obd.close();
      chip('weather', '');
      chip('sig', '');
      chip('ban', '');
    },
    advice: () => advice,
  };
}
