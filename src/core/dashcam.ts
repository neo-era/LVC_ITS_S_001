export interface ClipFile {
  id: string;
  bytes: number;
  /** Thời điểm bắt đầu quay (mili giây). */
  startedAt: number;
  locked: boolean;
}

export interface RetentionPlan {
  deleteIds: string[];
  warning: 'locked_exceeds_limit' | null;
}

/** Chọn các clip thường cũ nhất cần xoá để tổng dung lượng ≤ limitBytes. Clip khoá không bao giờ bị xoá. */
export function planRetention(files: ClipFile[], limitBytes: number): RetentionPlan {
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    throw new Error('Giới hạn dung lượng phải là số dương');
  }
  let total = files.reduce((sum, f) => sum + f.bytes, 0);
  const deletable = files.filter((f) => !f.locked).sort((a, b) => a.startedAt - b.startedAt);
  const deleteIds: string[] = [];
  for (const f of deletable) {
    if (total <= limitBytes) break;
    deleteIds.push(f.id);
    total -= f.bytes;
  }
  return { deleteIds, warning: total > limitBytes ? 'locked_exceeds_limit' : null };
}

const G = 9.80665;

export interface AccelSample {
  /** m/s², gồm cả trọng lực. */
  x: number;
  y: number;
  z: number;
}

/** Va chạm khi độ lớn gia tốc tổng ≥ thresholdG (mặc định 2,5 g; xe đứng yên ≈ 1 g). */
export function detectImpact(s: AccelSample, thresholdG = 2.5): boolean {
  if (![s.x, s.y, s.z].every(Number.isFinite)) return false;
  return Math.hypot(s.x, s.y, s.z) / G >= thresholdG;
}

/** Khoảng thời gian (mili giây) cần giữ quanh thời điểm va chạm. */
export function lockWindow(impactAtMs: number, preSec = 15, postSec = 15): { from: number; to: number } {
  return { from: Math.max(0, impactAtMs - preSec * 1000), to: impactAtMs + postSec * 1000 };
}
