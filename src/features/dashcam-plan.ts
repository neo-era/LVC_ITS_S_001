export interface ClipMeta {
  id: string;
  bytes: number;
  startedAt: number;
  endedAt?: number;
  locked: boolean;
  mime?: string;
}

/** Các đoạn video giao với cửa sổ thời gian (vd ±15 giây quanh va chạm). */
export function clipsToLock(clips: ClipMeta[], w: { from: number; to: number }): string[] {
  return clips.filter((c) => c.startedAt <= w.to && (c.endedAt ?? Infinity) >= w.from).map((c) => c.id);
}
