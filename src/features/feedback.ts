/**
 * Góp ý & đánh giá của người dùng gửi cho người phát triển.
 * Lưu trên máy trước (gửi được cả khi mất mạng), rồi gửi lên Supabase bảng lat_feedback (khoá công khai chỉ được GHI).
 * Vị trí chỉ gửi khi người dùng tích "gửi kèm vị trí".
 */
import type { Vehicle } from '../core/vehicle';

export const FEEDBACK_KINDS = {
  de_xuat: 'Đề xuất tính năng',
  loi: 'Lỗi app',
  sai_toc_do: 'Sai giới hạn tốc độ',
  sai_camera: 'Sai / thiếu camera',
  khac: 'Khác',
} as const;
export type FeedbackKind = keyof typeof FEEDBACK_KINDS;

export interface RoadCtx {
  limit: number | null;
  estimated: boolean;
  segment?: string | null;
  /** Số trên biển thật người dùng báo (km/h); 0 = không có biển. */
  posted?: number | null;
}

export interface FeedbackItem {
  id: string;
  rating: number | null;
  kind: FeedbackKind;
  text: string;
  lat?: number;
  lng?: number;
  ctx: Record<string, unknown>;
  build: string;
  device: string;
  t: number;
  synced?: boolean;
}

export function buildFeedback(o: {
  rating: number | null;
  kind: FeedbackKind;
  text: string;
  now: number;
  device: string;
  build: string;
  vehicle: Vehicle;
  at?: { lat: number; lng: number } | null;
  withLocation?: boolean;
  road?: RoadCtx | null;
  rand?: () => number;
}): { ok: true; item: FeedbackItem } | { ok: false; reason: string } {
  if (!(o.kind in FEEDBACK_KINDS)) return { ok: false, reason: 'Loại góp ý không hợp lệ.' };
  if (o.rating !== null && !(Number.isInteger(o.rating) && o.rating >= 1 && o.rating <= 5)) return { ok: false, reason: 'Số sao từ 1 đến 5.' };
  const text = o.text.trim().replace(/[ \t]+/g, ' ').slice(0, 2000);
  if (o.rating === null && !text) return { ok: false, reason: 'Chọn số sao hoặc viết vài dòng góp ý.' };
  const r5 = (x: number) => Math.round(x * 1e5) / 1e5;
  const ctx: Record<string, unknown> = { vehicle: o.vehicle };
  if (o.withLocation && o.road) {
    ctx.limit = o.road.limit;
    ctx.estimated = o.road.estimated;
    if (o.road.segment) ctx.segment = o.road.segment;
    if (o.road.posted !== undefined && o.road.posted !== null) ctx.posted = o.road.posted;
  }
  const item: FeedbackItem = {
    id: `f${o.now.toString(36)}${(o.rand ?? Math.random)().toString(36).slice(2, 6)}`,
    rating: o.rating,
    kind: o.kind,
    text,
    ctx,
    build: o.build.slice(0, 40),
    device: o.device,
    t: o.now,
  };
  if (o.withLocation && o.at && Number.isFinite(o.at.lat) && Number.isFinite(o.at.lng)) {
    item.lat = r5(o.at.lat);
    item.lng = r5(o.at.lng);
  }
  return { ok: true, item };
}

export function feedbackRows(list: FeedbackItem[]) {
  return list.map((f) => ({
    id: f.id,
    rating: f.rating,
    kind: f.kind,
    text: f.text,
    lat: f.lat ?? null,
    lng: f.lng ?? null,
    ctx: f.ctx,
    app_build: f.build,
    device: f.device,
    t_client: f.t,
  }));
}

export const pendingFeedback = (list: FeedbackItem[]) => list.filter((f) => !f.synced);

export function parseFeedback(raw: unknown): FeedbackItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is FeedbackItem => !!f && typeof f.id === 'string' && typeof f.kind === 'string' && f.kind in FEEDBACK_KINDS && typeof f.t === 'number').slice(-200);
}

/** Mời đánh giá đúng một lần, sau khi đã đi đủ 3 chuyến. */
export function shouldAskRating(tripCount: number, alreadyAsked: boolean): boolean {
  return !alreadyAsked && tripCount >= 3;
}
