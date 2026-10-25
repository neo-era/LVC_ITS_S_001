/** Hộp "Góp ý & đánh giá": chọn sao, loại, nội dung; báo sai tốc độ khi chạm biển; mời đánh giá sau 3 chuyến. */
import type { GpsSample } from '../core/gps';
import type { Vehicle } from '../core/vehicle';
import type { ViewState } from '../engine';
import { authHeaders, SUPABASE_URL } from '../sync';
import { buildFeedback, feedbackRows, parseFeedback, pendingFeedback, shouldAskRating, type FeedbackItem, type FeedbackKind } from './feedback';

declare const __APP_BUILD__: string;
const BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

export interface FbCtx {
  $: <T extends HTMLElement>(id: string) => T;
  lsGet: (k: string) => string | null;
  lsSet: (k: string, v: string) => boolean;
  toast: (text: string, action?: () => void, label?: string, ms?: number) => void;
  lastFix: () => GpsSample | null;
  view: () => ViewState;
  segment: () => string | null;
  vehicle: () => Vehicle;
  deviceId: () => string;
  closeSettings: () => void;
}

const KEY = 'lat.feedback.v1';
const ASKED = 'lat.feedback.asked';
const STAR_TEXT = ['Chạm để chọn số sao', 'Rất tệ', 'Chưa tốt', 'Tạm được', 'Tốt', 'Rất tốt'];

export function setupFeedback(ctx: FbCtx) {
  const { $ } = ctx;
  const dlg = $('feedback') as HTMLDialogElement;
  const kindSel = $('fb-kind') as HTMLSelectElement;
  const text = $('fb-text') as HTMLTextAreaElement;
  const loc = $('fb-loc') as HTMLInputElement;
  const posted = $('fb-posted') as HTMLSelectElement;
  const status = $('fb-status');
  let rating: number | null = null;
  let list: FeedbackItem[] = (() => {
    try {
      return parseFeedback(JSON.parse(ctx.lsGet(KEY) ?? '[]'));
    } catch {
      return [];
    }
  })();
  const save = () => ctx.lsSet(KEY, JSON.stringify(list.slice(-200)));

  const stars = [...$('fb-stars').querySelectorAll<HTMLButtonElement>('button')];
  const paintStars = () => {
    stars.forEach((b) => {
      const v = Number(b.dataset.v);
      b.classList.toggle('on', rating !== null && v <= rating);
      b.setAttribute('aria-checked', String(rating === v));
    });
    $('fb-stars-label').textContent = STAR_TEXT[rating ?? 0];
  };
  stars.forEach((b) => b.addEventListener('click', () => ((rating = Number(b.dataset.v)), paintStars())));

  const syncKind = () => {
    const k = kindSel.value as FeedbackKind;
    $('fb-posted-row').hidden = k !== 'sai_toc_do';
    // báo sai dữ liệu đường thì cần vị trí mới có ích
    if (k === 'sai_toc_do' || k === 'sai_camera') loc.checked = true;
  };
  kindSel.addEventListener('change', syncKind);

  let sending = false;
  async function flush(): Promise<boolean> {
    const pend = pendingFeedback(list);
    if (!pend.length || !navigator.onLine || sending) return false;
    sending = true;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/lat_feedback?on_conflict=id`, {
        method: 'POST',
        headers: { ...authHeaders(), 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(feedbackRows(pend)),
      });
      if (!res.ok) throw new Error(String(res.status));
      const ids = new Set(pend.map((f) => f.id));
      list = list.map((f) => (ids.has(f.id) ? { ...f, synced: true } : f));
      save();
      return true;
    } catch {
      return false;
    } finally {
      sending = false;
    }
  }
  window.addEventListener('online', () => void flush());
  setTimeout(() => void flush(), 6000);

  function open(kind: FeedbackKind = 'de_xuat', withLoc = false): void {
    ctx.closeSettings();
    kindSel.value = kind;
    loc.checked = withLoc;
    posted.value = '';
    status.textContent = '';
    syncKind();
    if (!dlg.open) dlg.showModal();
  }

  $('btn-fb-send').addEventListener('click', async () => {
    const f = ctx.lastFix();
    const v = ctx.view();
    const k = kindSel.value as FeedbackKind;
    const r = buildFeedback({
      rating,
      kind: k,
      text: text.value,
      now: Date.now(),
      device: ctx.deviceId(),
      build: BUILD,
      vehicle: ctx.vehicle(),
      at: f ? { lat: f.lat, lng: f.lng } : null,
      withLocation: loc.checked,
      road: { limit: v.limit, estimated: v.limitEstimated, segment: ctx.segment(), posted: k === 'sai_toc_do' && posted.value !== '' ? Number(posted.value) : null },
    });
    if (!r.ok) return void (status.textContent = r.reason);
    if (loc.checked && !f) status.textContent = 'Chưa có vị trí GPS — góp ý vẫn gửi, không kèm vị trí.';
    list = [...list, r.item];
    save();
    const sent = await flush();
    text.value = '';
    rating = null;
    paintStars();
    dlg.close();
    ctx.toast(sent ? 'Cảm ơn anh/chị! Góp ý đã gửi tới người phát triển.' : 'Đã lưu góp ý trên máy, sẽ tự gửi khi có mạng.', undefined, undefined, 5000);
  });

  $('btn-feedback').addEventListener('click', () => open());
  // chạm biển tốc độ → báo sai giới hạn ngay tại đoạn đường đang đi
  $('limit').addEventListener('click', () => open('sai_toc_do', true));
  paintStars();

  return {
    open,
    /** Gọi khi kết thúc chuyến: mời đánh giá một lần sau chuyến thứ 3. */
    onTripEnd(): void {
      let trips = 0;
      try {
        const v = JSON.parse(ctx.lsGet('lat.trips.v1') ?? '[]');
        trips = Array.isArray(v) ? v.length : 0;
      } catch {
        /* bỏ qua */
      }
      if (!shouldAskRating(trips, ctx.lsGet(ASKED) === '1')) return;
      ctx.lsSet(ASKED, '1');
      setTimeout(() => ctx.toast('Anh/chị thấy app thế nào? Góp ý giúp người phát triển nhé.', () => open(), 'Đánh giá', 10_000), 1500);
    },
  };
}
