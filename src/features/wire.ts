/** Nối giao diện cho 8 tính năng: HUD kính lái, địa điểm lưu, nhắc nghỉ, báo đèn tắt, nhật ký chuyến, đội xe, lệnh giọng nói, camera hành trình. */
import type { GpsSample } from '../core/gps';
import type { ViewState } from '../engine';
import type { Place } from '../nav/geocode';
import { authHeaders, SUPABASE_URL } from '../sync';
import { Dashcam } from './dashcam';
import { fleetPingBody, isTeamCode } from './fleet';
import { addPlace, findPlaceByName, parsePlaces, removePlace, type SavedPlace } from './places';
import { fmtVnTime, parseReports, REPORT_LABEL, reportsToCsv, type Report } from './reports';
import { RestTracker } from './rest';
import { TripRecorder, type TripSummary } from './trip';
import { parseCommand } from './voicecmd';

export interface Ctx {
  $: <T extends HTMLElement>(id: string) => T;
  lsGet: (k: string) => string | null;
  lsSet: (k: string, v: string) => void;
  speak: (t: string) => void;
  toast: (text: string, action?: () => void, label?: string, ms?: number) => void;
  lastFix: () => GpsSample | null;
  heading: () => number | null;
  mode: () => 'idle' | 'gps' | 'sim';
  deviceId: () => string;
  goTo: (p: Place) => Promise<void>;
  stopNav: () => void;
  markCamera: () => void;
  toggleVoice: (on: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
}

function readJson<T>(ctx: Ctx, key: string, parse: (v: unknown) => T, dflt: T): T {
  try {
    return parse(JSON.parse(ctx.lsGet(key) ?? 'null'));
  } catch {
    return dflt;
  }
}

function download(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const fmtKm = (m: number) => `${(m / 1000).toFixed(1).replace('.', ',')} km`;
const fmtDur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} giờ ${Math.round((s % 3600) / 60)} phút` : `${Math.round(s / 60)} phút`);
const fmtMB = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : `${Math.round(b / 1024 ** 2)} MB`);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });

export function setupFeatures(ctx: Ctx) {
  const { $ } = ctx;
  const openDlg = (id: string) => {
    ctx.closeSettings();
    ($(id) as HTMLDialogElement).showModal();
  };
  document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
    b.addEventListener('click', () => ($(b.dataset.close!) as HTMLDialogElement).close()),
  );

  /* ===== 4. Địa điểm lưu ===== */
  const PLACES = 'lat.places.v1';
  let places: SavedPlace[] = readJson(ctx, PLACES, parsePlaces, []);
  const savePlaces = () => ctx.lsSet(PLACES, JSON.stringify(places));
  function renderPlaces(): void {
    const box = $('saved-places');
    box.replaceChildren(
      ...places.map((p) => {
        const wrap = document.createElement('span');
        wrap.className = 'saved-chip';
        const go = document.createElement('button');
        go.type = 'button';
        go.textContent = `★ ${p.name}`;
        go.addEventListener('click', () => void ctx.goTo({ name: p.name, detail: 'Địa điểm đã lưu', lat: p.lat, lng: p.lng }));
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'x';
        del.textContent = '×';
        del.setAttribute('aria-label', `Xoá ${p.name}`);
        del.addEventListener('click', () => {
          places = removePlace(places, p.name);
          savePlaces();
          renderPlaces();
        });
        wrap.append(go, del);
        return wrap;
      }),
    );
  }
  $('btn-save-here').addEventListener('click', () => {
    const f = ctx.lastFix();
    if (!f) return ctx.toast('Chưa có vị trí GPS để lưu.');
    const name = ($('dest-q') as HTMLInputElement).value.trim() || `Điểm đã lưu ${places.length + 1}`;
    places = addPlace(places, { name, lat: f.lat, lng: f.lng });
    savePlaces();
    renderPlaces();
    ctx.toast(`Đã lưu “${name}”.`);
  });
  /** Thêm nút ☆ Lưu vào mỗi kết quả tìm kiếm. */
  const results = $('dest-results');
  new MutationObserver(() => {
    results.querySelectorAll('li').forEach((li) => {
      if (li.querySelector('.save-star')) return;
      const btn = li.querySelector('button');
      const place = (btn as HTMLButtonElement & { _place?: Place })?._place;
      if (!place) return;
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'save-star';
      star.textContent = '☆ Lưu';
      star.setAttribute('aria-label', `Lưu ${place.name}`);
      star.addEventListener('click', () => {
        places = addPlace(places, { name: place.name, lat: place.lat, lng: place.lng });
        savePlaces();
        renderPlaces();
        star.textContent = '★ Đã lưu';
      });
      li.append(star);
    });
  }).observe(results, { childList: true });

  /* ===== 6. Nhắc nghỉ ===== */
  const restSel = $('set-rest') as HTMLSelectElement;
  restSel.value = ctx.lsGet('lat.rest') ?? '120';
  const rest = new RestTracker(Number(restSel.value));
  restSel.addEventListener('change', () => {
    ctx.lsSet('lat.rest', restSel.value);
    rest.setThreshold(Number(restSel.value));
  });

  /* ===== 5. HUD kính lái ===== */
  const hud = $('hudmode');
  const flipSel = $('set-hud-flip') as HTMLSelectElement;
  flipSel.value = ctx.lsGet('lat.hudflip') ?? 'none';
  const applyFlip = () => {
    $('hm-inner').style.transform = flipSel.value === 'x' ? 'scaleX(-1)' : flipSel.value === 'y' ? 'scaleY(-1)' : '';
  };
  flipSel.addEventListener('change', () => {
    ctx.lsSet('lat.hudflip', flipSel.value);
    applyFlip();
  });
  applyFlip();
  const hudOn = (on: boolean) => {
    hud.hidden = !on;
    if (on) ctx.closeSettings();
  };
  $('btn-hud').addEventListener('click', () => hudOn(true));
  $('btn-hud-exit').addEventListener('click', () => hudOn(false));
  hud.addEventListener('dblclick', () => hudOn(false));
  function renderHud(v: ViewState): void {
    if (hud.hidden) return;
    $('hm-speed').textContent = v.kmh === null || v.status === 'lost' ? '--' : String(Math.round(v.kmh));
    $('hm-speed').dataset.state = v.state;
    const sign = $('hm-limit');
    sign.hidden = v.limit === null;
    sign.textContent = v.limit === null ? '' : String(v.limit);
    sign.classList.toggle('est', v.limitEstimated);
    let line = '';
    if (!$('nav').hidden) line = `${$('nav-dist').textContent} · ${$('nav-instr').textContent}`;
    else if (v.alert) line = `${$('alert-title').textContent} ${$('alert-dist').textContent}`;
    $('hm-line').textContent = line;
  }

  /* ===== 1. Báo đèn tắt ===== */
  const REPS = 'lat.reports.v1';
  let reports: Report[] = readJson(ctx, REPS, parseReports, []);
  const saveReps = () => ctx.lsSet(REPS, JSON.stringify(reports));
  async function syncReports(silent: boolean): Promise<void> {
    const pending = reports.filter((r) => !r.synced);
    const say = (t: string) => !silent && ($('rep-status').textContent = t);
    if (!pending.length) return void say('Không có báo cáo nào cần gửi.');
    if (!navigator.onLine) return void say('Đang ngoại tuyến — báo cáo vẫn lưu trên máy.');
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lat_reports?on_conflict=id`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(pending.map((r) => ({ id: r.id, kind: r.kind, lat: r.lat, lng: r.lng, dir: r.dir ?? null, device: ctx.deviceId(), t_client: r.t }))),
      });
      if (!res.ok) throw new Error(String(res.status));
      const ids = new Set(pending.map((r) => r.id));
      reports = reports.map((r) => (ids.has(r.id) ? { ...r, synced: true } : r));
      saveReps();
      say(`Đã gửi ${ids.size} báo cáo.`);
    } catch (e) {
      say(`Chưa gửi được (${(e as Error).message}). Báo cáo vẫn lưu trên máy, xuất CSV được.`);
    }
    renderReports();
  }
  function reportHere(): void {
    if (ctx.mode() === 'sim') return ctx.toast('Không báo khi đang chạy thử mô phỏng.');
    const f = ctx.lastFix();
    if (!f) return ctx.toast('Chưa có vị trí GPS.');
    const h = ctx.heading();
    const r: Report = { id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind: 'den_tat', lat: f.lat, lng: f.lng, t: Date.now() };
    if (h !== null) r.dir = Math.round(h) % 360;
    reports = [...reports, r].slice(-1000);
    saveReps();
    ctx.speak('Đã ghi đèn tắt.');
    ctx.toast('Đã ghi đèn tắt tại vị trí này.', () => {
      reports = reports.filter((x) => x.id !== r.id);
      saveReps();
      $('toast').hidden = true;
    });
    void syncReports(true);
  }
  function renderReports(): void {
    const pending = reports.filter((r) => !r.synced).length;
    $('rep-info').textContent = `${reports.length} báo cáo trên máy, ${pending} chưa gửi.`;
    $('rep-list').replaceChildren(
      ...reports
        .slice(-20)
        .reverse()
        .map((r) => {
          const li = document.createElement('li');
          li.className = 'off-row';
          const d = document.createElement('div');
          d.className = 'off-name';
          d.textContent = `${REPORT_LABEL[r.kind]} · ${fmtVnTime(r.t)}`;
          const sm = document.createElement('small');
          sm.textContent = `${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}${r.synced ? ' · đã gửi' : ''}`;
          d.append(sm);
          const a = document.createElement('a');
          a.className = 'mini-link';
          a.href = `https://www.google.com/maps?q=${r.lat.toFixed(6)},${r.lng.toFixed(6)}`;
          a.target = '_blank';
          a.rel = 'noopener';
          a.textContent = 'Bản đồ';
          li.append(d, a);
          return li;
        }),
    );
  }
  $('btn-light').addEventListener('click', reportHere);
  $('btn-reports').addEventListener('click', () => {
    renderReports();
    $('rep-status').textContent = '';
    openDlg('reports');
  });
  $('btn-rep-csv').addEventListener('click', () => download(`bao-den-tat-${today()}.csv`, reportsToCsv(reports)));
  $('btn-rep-sync').addEventListener('click', () => void syncReports(false));
  let repArmed = false;
  $('btn-rep-clear').addEventListener('click', () => {
    const b = $('btn-rep-clear');
    if (!repArmed) {
      repArmed = true;
      b.textContent = 'Chạm lần nữa để xoá hết';
      setTimeout(() => ((repArmed = false), (b.textContent = 'Xoá danh sách trên máy')), 4000);
      return;
    }
    reports = [];
    saveReps();
    renderReports();
  });

  /* ===== 2. Nhật ký chuyến đi ===== */
  const TRIPS = 'lat.trips.v1';
  let trips: TripSummary[] = readJson(ctx, TRIPS, (v) => (Array.isArray(v) ? (v as TripSummary[]) : []), []);
  let trip: TripRecorder | null = null;
  function endTrip(): void {
    if (!trip) return;
    const s = trip.summary(Date.now());
    trip = null;
    if (s.distM < 200) return; // chuyến quá ngắn: bỏ
    trips = [...trips, s].slice(-100);
    ctx.lsSet(TRIPS, JSON.stringify(trips));
    ctx.toast(`Chuyến đi: ${fmtKm(s.distM)}, ${fmtDur(s.movingS)}, điểm lái an toàn ${s.score}/100.`, undefined, undefined, 8000);
  }
  function renderTrips(): void {
    $('trip-list').replaceChildren(
      ...trips
        .slice()
        .reverse()
        .map((t) => {
          const li = document.createElement('li');
          li.className = 'off-row';
          const d = document.createElement('div');
          d.className = 'off-name';
          d.textContent = `${fmtVnTime(t.startT)} · ${fmtKm(t.distM)}`;
          const sm = document.createElement('small');
          sm.textContent = `${fmtDur(t.movingS)} · TB ${t.avgKmh} km/h · cao nhất ${t.maxKmh} · vượt tốc độ ${t.overCount} lần · phanh gấp ${t.hardBrakes}`;
          d.append(sm);
          const sc = document.createElement('strong');
          sc.className = `score ${t.score >= 85 ? 'good' : t.score >= 60 ? 'mid' : 'bad'}`;
          sc.textContent = String(t.score);
          sc.title = 'Điểm lái an toàn';
          li.append(d, sc);
          return li;
        }),
    );
    if (!trips.length) $('trip-list').innerHTML = '<li class="muted note">Chưa có chuyến nào.</li>';
  }
  $('btn-trips').addEventListener('click', () => {
    renderTrips();
    openDlg('trips');
  });
  $('btn-trip-csv').addEventListener('click', () => {
    const rows = [['Bắt đầu', 'Kết thúc', 'Quãng đường (km)', 'Thời gian chạy (phút)', 'TB (km/h)', 'Cao nhất (km/h)', 'Số lần vượt', 'Giây vượt', 'Phanh gấp', 'Điểm']];
    for (const t of trips)
      rows.push([fmtVnTime(t.startT), fmtVnTime(t.endT), (t.distM / 1000).toFixed(2), String(Math.round(t.movingS / 60)), String(t.avgKmh), String(t.maxKmh), String(t.overCount), String(t.overSeconds), String(t.hardBrakes), String(t.score)]);
    download(`chuyen-di-${today()}.csv`, '﻿' + rows.map((r) => r.join(',')).join('\r\n'));
  });
  let tripArmed = false;
  $('btn-trip-clear').addEventListener('click', () => {
    const b = $('btn-trip-clear');
    if (!tripArmed) {
      tripArmed = true;
      b.textContent = 'Chạm lần nữa để xoá hết';
      setTimeout(() => ((tripArmed = false), (b.textContent = 'Xoá lịch sử chuyến đi')), 4000);
      return;
    }
    trips = [];
    ctx.lsSet(TRIPS, '[]');
    renderTrips();
  });

  /* ===== 3. Đội xe ===== */
  const fName = $('fleet-name') as HTMLInputElement;
  const fTeam = $('fleet-team') as HTMLInputElement;
  const fOn = $('fleet-on') as HTMLInputElement;
  fName.value = ctx.lsGet('lat.fleet.name') ?? '';
  fTeam.value = ctx.lsGet('lat.fleet.team') ?? '';
  fOn.checked = ctx.lsGet('lat.fleet.on') === '1' && isTeamCode(fTeam.value);
  const fleetMsg = (t: string) => ($('fleet-status').textContent = t);
  const syncFleetLink = () => (($('fleet-open') as HTMLAnchorElement).href = `./fleet.html${isTeamCode(fTeam.value) ? `#${encodeURIComponent(fTeam.value)}` : ''}`);
  syncFleetLink();
  fName.addEventListener('change', () => ctx.lsSet('lat.fleet.name', fName.value.trim()));
  fTeam.addEventListener('change', () => {
    ctx.lsSet('lat.fleet.team', fTeam.value.trim());
    syncFleetLink();
  });
  fOn.addEventListener('change', () => {
    if (fOn.checked && !isTeamCode(fTeam.value.trim())) {
      fOn.checked = false;
      return fleetMsg('Mã đội cần ít nhất 8 ký tự (chữ, số, dấu gạch).');
    }
    ctx.lsSet('lat.fleet.on', fOn.checked ? '1' : '0');
    fleetMsg(fOn.checked ? 'Đang chia sẻ vị trí khi lái.' : 'Đã tắt chia sẻ vị trí.');
  });
  $('btn-fleet').addEventListener('click', () => openDlg('fleet'));
  let lastPing = 0;
  async function pingFleet(f: GpsSample, v: ViewState): Promise<void> {
    if (!fOn.checked || ctx.mode() !== 'gps' || !navigator.onLine) return;
    const moving = (v.kmh ?? 0) > 5;
    if (Date.now() - lastPing < (moving ? 15_000 : 60_000)) return;
    lastPing = Date.now();
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fleet_ping`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify(fleetPingBody(fTeam.value.trim(), ctx.deviceId(), fName.value.trim() || 'Xe chưa đặt tên', { lat: f.lat, lng: f.lng, kmh: v.kmh, heading: ctx.heading() })),
      });
      fleetMsg(res.ok ? `Đã gửi vị trí lúc ${fmtVnTime(Date.now()).slice(11)}.` : `Máy chủ chưa nhận (mã ${res.status}) — kiểm tra đã chạy file SQL chưa.`);
    } catch {
      fleetMsg('Chưa gửi được vị trí (mạng).');
    }
  }

  /* ===== 8. Camera hành trình ===== */
  const cam = new Dashcam();
  cam.preview = $('cam-preview') as HTMLVideoElement;
  const limSel = $('set-cam-limit') as HTMLSelectElement;
  limSel.value = ctx.lsGet('lat.cam.limit') ?? '2';
  cam.limitBytes = Number(limSel.value) * 1024 ** 3;
  const autoBox = $('set-cam-auto') as HTMLInputElement;
  autoBox.checked = ctx.lsGet('lat.cam.auto') !== '0';
  cam.autoLock = autoBox.checked;
  limSel.addEventListener('change', () => {
    ctx.lsSet('lat.cam.limit', limSel.value);
    cam.limitBytes = Number(limSel.value) * 1024 ** 3;
  });
  autoBox.addEventListener('change', () => {
    ctx.lsSet('lat.cam.auto', autoBox.checked ? '1' : '0');
    cam.autoLock = autoBox.checked;
  });
  cam.onWarn = (m) => {
    ctx.toast(m, undefined, undefined, 8000);
    if (m.includes('va chạm')) ctx.speak('Đã khoá video va chạm.');
  };
  const renderCamState = () => {
    $('rec').hidden = !cam.recording;
    $('cam-preview').hidden = !cam.recording;
    $('btn-cam').setAttribute('aria-pressed', String(cam.recording));
    $('btn-cam').classList.toggle('rec-on', cam.recording);
  };
  cam.onChange = () => {
    renderCamState();
    if (($('clips') as HTMLDialogElement).open) renderClips();
  };
  async function camToggle(on?: boolean): Promise<void> {
    const want = on ?? !cam.recording;
    try {
      if (want) {
        await cam.start();
        ctx.speak('Bắt đầu quay video hành trình.');
      } else {
        cam.stop();
        ctx.speak('Đã dừng quay.');
      }
    } catch (e) {
      ctx.toast((e as Error).name === 'NotAllowedError' ? 'Chưa được cấp quyền camera.' : (e as Error).message || 'Không mở được camera.');
    }
    renderCamState();
  }
  $('btn-cam').addEventListener('click', () => void camToggle());
  $('cam-preview').addEventListener('click', () => $('cam-preview').classList.toggle('big'));
  $('btn-cam-lock').addEventListener('click', () => {
    if (!cam.recording) return ctx.toast('Chưa quay video.');
    cam.lockNow();
    ctx.toast('Đã khoá đoạn video quanh thời điểm này.');
  });
  function renderClips(): void {
    $('clip-usage').textContent = `${cam.meta.length} đoạn · ${fmtMB(cam.usedBytes())} / ${fmtMB(cam.limitBytes)} · ${cam.meta.filter((m) => m.locked).length} đoạn đã khoá`;
    $('clip-list').replaceChildren(
      ...cam.meta
        .slice()
        .reverse()
        .slice(0, 60)
        .map((m) => {
          const li = document.createElement('li');
          li.className = 'off-row';
          const d = document.createElement('div');
          d.className = 'off-name';
          d.textContent = `${m.locked ? '🔒 ' : ''}${fmtVnTime(m.startedAt)}`;
          const sm = document.createElement('small');
          sm.textContent = `${Math.round(((m.endedAt ?? m.startedAt) - m.startedAt) / 1000)} giây · ${fmtMB(m.bytes)}`;
          d.append(sm);
          const mk = (label: string, fn: () => void) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'del';
            b.textContent = label;
            b.addEventListener('click', fn);
            return b;
          };
          const play = mk('Xem', async () => {
            const blob = await cam.blob(m.id);
            if (!blob) return;
            const v = $('clip-player') as HTMLVideoElement;
            if (v.src) URL.revokeObjectURL(v.src);
            v.src = URL.createObjectURL(blob);
            v.hidden = false;
            void v.play().catch(() => {});
          });
          const dl = mk('Tải', async () => {
            const blob = await cam.blob(m.id);
            if (!blob) return;
            const ext = (m.mime ?? '').includes('mp4') ? 'mp4' : 'webm';
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hanh-trinh-${fmtVnTime(m.startedAt).replace(/[/: ]/g, '-')}.${ext}`;
            document.body.append(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10_000);
          });
          const lk = mk(m.locked ? 'Bỏ khoá' : 'Khoá', () => cam.setLocked(m.id, !m.locked));
          const rm = mk('Xoá', () => void cam.remove(m.id));
          li.append(d, play, dl, lk, rm);
          return li;
        }),
    );
  }
  $('btn-clips').addEventListener('click', () => {
    renderClips();
    openDlg('clips');
  });
  $('btn-clip-clear').addEventListener('click', () => void cam.removeUnlocked());
  if (!Dashcam.supported()) $('btn-cam').hidden = true;

  /* ===== 7. Lệnh giọng nói ===== */
  type SR = { lang: string; interimResults: boolean; maxAlternatives: number; start: () => void; onresult: ((e: { results: { 0: { transcript: string } }[] }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
  const SRC = (window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;
  let listening = false;
  async function runCommand(text: string): Promise<void> {
    const c = parseCommand(text);
    switch (c.type) {
      case 'mark_camera':
        return ctx.markCamera();
      case 'report_light':
        return reportHere();
      case 'stop_nav':
        ctx.stopNav();
        return ctx.speak('Đã dừng dẫn đường.');
      case 'go_place': {
        const p = findPlaceByName(places, c.name);
        if (!p) return ctx.speak(`Chưa có địa điểm ${c.name} trong danh sách đã lưu.`);
        try {
          await ctx.goTo({ name: p.name, detail: 'Địa điểm đã lưu', lat: p.lat, lng: p.lng });
        } catch (e) {
          ctx.speak((e as Error).message);
        }
        return;
      }
      case 'voice':
        return ctx.toggleVoice(c.on);
      case 'dashcam':
        return camToggle(c.on);
      case 'dashcam_lock':
        if (!cam.recording) return ctx.speak('Chưa bật quay video.');
        cam.lockNow();
        return ctx.speak('Đã khoá video.');
      case 'say_speed': {
        const sp = $('speed-num').textContent;
        return ctx.speak(sp && sp !== '--' ? `${sp} ki lô mét trên giờ.` : 'Chưa có tốc độ.');
      }
      default:
        ctx.toast(`Chưa hiểu lệnh: “${text}”.`);
        ctx.speak('Em chưa hiểu lệnh.');
    }
  }
  if (SRC) {
    $('btn-mic').hidden = false;
    $('btn-mic').addEventListener('click', () => {
      if (listening) return;
      const r = new SRC();
      r.lang = 'vi-VN';
      r.interimResults = false;
      r.maxAlternatives = 1;
      listening = true;
      $('btn-mic').classList.add('rec-on');
      r.onresult = (e) => void runCommand(e.results[0][0].transcript);
      r.onerror = (e) => e.error !== 'no-speech' && ctx.toast(e.error === 'not-allowed' ? 'Chưa được cấp quyền micro.' : 'Không nghe rõ, anh thử lại.');
      r.onend = () => {
        listening = false;
        $('btn-mic').classList.remove('rec-on');
      };
      try {
        r.start();
      } catch {
        listening = false;
      }
    });
  }

  renderPlaces();
  renderCamState();

  return {
    /** Gọi mỗi mẫu GPS (cả mô phỏng). */
    onSample(f: GpsSample, v: ViewState): void {
      renderHud(v);
      if (ctx.mode() !== 'gps') return;
      if (!trip) trip = new TripRecorder(f.t, f.lat, f.lng);
      trip.push({ t: f.t, lat: f.lat, lng: f.lng, kmh: v.kmh, limit: v.limit, limitEstimated: v.limitEstimated });
      const ev = rest.push(f.t, v.kmh);
      if (ev === 'remind') {
        const h = Math.round(rest.drivingMs / 60_000);
        ctx.speak(`Anh đã lái liên tục ${Math.floor(h / 60)} giờ ${h % 60} phút. Hãy dừng nghỉ ít nhất 15 phút.`);
        ctx.toast(`Đã lái liên tục ${fmtDur(rest.drivingMs / 1000)} — nên dừng nghỉ ít nhất 15 phút.`, undefined, undefined, 15_000);
      } else if (ev === 'day_limit') {
        ctx.speak('Hôm nay anh đã lái đủ 10 giờ. Nên dừng lái.');
        ctx.toast('Đã lái 10 giờ trong ngày (mức tối đa với xe kinh doanh vận tải).', undefined, undefined, 15_000);
      }
      void pingFleet(f, v);
    },
    onStop(): void {
      endTrip();
      if (cam.recording) cam.stop();
    },
    renderPlaces,
  };
}
