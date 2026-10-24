import { detectImpact, lockWindow, planRetention } from '../core/dashcam';
import { clipsToLock, type ClipMeta } from './dashcam-plan';

/**
 * Camera hành trình chạy trong trình duyệt (PWA): quay camera sau theo từng đoạn 60 giây,
 * lưu video trên máy (IndexedDB), quay vòng theo dung lượng đặt, khoá đoạn quanh va chạm hoặc khi bấm.
 * Giới hạn PWA: chỉ quay khi app đang mở và màn hình sáng.
 */
const DB = 'lat-dashcam';
const STORE = 'clips';
const META = 'lat.dashcam.meta.v1';
const SEGMENT_MS = 60_000;

function idb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

function readMeta(): ClipMeta[] {
  try {
    const v = JSON.parse(localStorage.getItem(META) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

export class Dashcam {
  meta: ClipMeta[] = readMeta();
  limitBytes = 2 * 1024 ** 3;
  autoLock = true;
  onChange: () => void = () => {};
  onWarn: (msg: string) => void = () => {};
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private current: ClipMeta | null = null;
  private timer: number | null = null;
  private lockPending: { from: number; to: number } | null = null;
  private lastImpact = 0;
  private motionOn = false;
  preview: HTMLVideoElement | null = null;

  get recording(): boolean {
    return this.stream !== null;
  }

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && 'indexedDB' in window;
  }

  private save(): void {
    try {
      localStorage.setItem(META, JSON.stringify(this.meta));
    } catch {
      /* bỏ qua */
    }
    this.onChange();
  }

  /** Gọi trong thao tác chạm (iOS cần xin quyền cảm biến chuyển động). */
  async start(): Promise<void> {
    if (this.stream) return;
    if (!Dashcam.supported()) throw new Error('Trình duyệt này chưa hỗ trợ quay video.');
    try {
      const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (this.autoLock && DME.requestPermission) await DME.requestPermission();
    } catch {
      /* không có cảm biến thì vẫn quay, chỉ không tự khoá */
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    if (this.preview) {
      this.preview.srcObject = this.stream;
      void this.preview.play().catch(() => {});
    }
    if (!this.motionOn) {
      window.addEventListener('devicemotion', this.onMotion);
      this.motionOn = true;
    }
    this.nextSegment();
    this.onChange();
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const s = this.stream;
    this.stream = null;
    if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); // onstop lưu đoạn cuối
    s?.getTracks().forEach((t) => t.stop());
    if (this.preview) this.preview.srcObject = null;
    if (this.motionOn) {
      window.removeEventListener('devicemotion', this.onMotion);
      this.motionOn = false;
    }
    this.onChange();
  }

  private nextSegment(): void {
    if (!this.stream) return;
    const mime = pickMime();
    const rec = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000 });
    const chunks: Blob[] = [];
    const clip: ClipMeta = { id: `v${Date.now().toString(36)}`, bytes: 0, startedAt: Date.now(), locked: false, mime: rec.mimeType || mime };
    if (this.lockPending && this.lockPending.to >= clip.startedAt) clip.locked = true;
    this.current = clip;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => void this.finish(clip, chunks);
    rec.start(1000);
    this.rec = rec;
    this.timer = window.setTimeout(() => {
      if (rec.state !== 'inactive') rec.stop();
      this.nextSegment();
    }, SEGMENT_MS);
  }

  private async finish(clip: ClipMeta, chunks: Blob[]): Promise<void> {
    clip.endedAt = Date.now();
    const blob = new Blob(chunks, { type: clip.mime || 'video/webm' });
    clip.bytes = blob.size;
    if (this.current === clip) this.current = null;
    if (!blob.size) return;
    if (this.lockPending && clipsToLock([clip], this.lockPending).length) clip.locked = true;
    try {
      await tx('readwrite', (s) => s.put(blob, clip.id));
      this.meta = [...this.meta, clip];
      await this.applyRetention();
    } catch (e) {
      this.onWarn((e as Error).name === 'QuotaExceededError' ? 'Điện thoại hết chỗ lưu video — đang xoá đoạn cũ.' : 'Không lưu được đoạn video.');
      await this.applyRetention(true);
    }
    this.save();
  }

  private async applyRetention(tight = false): Promise<void> {
    const limit = tight ? Math.max(1, this.meta.reduce((a, m) => a + m.bytes, 0) * 0.8) : this.limitBytes;
    const plan = planRetention(this.meta, limit);
    for (const id of plan.deleteIds) await tx('readwrite', (s) => s.delete(id)).catch(() => {});
    this.meta = this.meta.filter((m) => !plan.deleteIds.includes(m.id));
    if (plan.warning) this.onWarn('Video đã khoá chiếm hết dung lượng đặt — hãy tải về hoặc bỏ khoá bớt.');
  }

  /** Khoá các đoạn quanh thời điểm hiện tại (±15 giây). */
  lockNow(at = Date.now()): number {
    const w = lockWindow(at);
    this.lockPending = w;
    const ids = clipsToLock(this.meta, w);
    this.meta = this.meta.map((m) => (ids.includes(m.id) ? { ...m, locked: true } : m));
    if (this.current) this.current.locked = true;
    this.save();
    return ids.length + (this.current ? 1 : 0);
  }

  private onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    if (!this.autoLock || !this.stream || !a || a.x === null || a.y === null || a.z === null) return;
    if (detectImpact({ x: a.x, y: a.y, z: a.z }) && Date.now() - this.lastImpact > 10_000) {
      this.lastImpact = Date.now();
      this.lockNow();
      this.onWarn('Phát hiện va chạm mạnh — đã khoá video quanh thời điểm này.');
    }
  };

  async blob(id: string): Promise<Blob | undefined> {
    return tx<Blob | undefined>('readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
  }

  setLocked(id: string, locked: boolean): void {
    this.meta = this.meta.map((m) => (m.id === id ? { ...m, locked } : m));
    this.save();
  }

  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id)).catch(() => {});
    this.meta = this.meta.filter((m) => m.id !== id);
    this.save();
  }

  async removeUnlocked(): Promise<void> {
    for (const m of this.meta.filter((x) => !x.locked)) await tx('readwrite', (s) => s.delete(m.id)).catch(() => {});
    this.meta = this.meta.filter((m) => m.locked);
    this.save();
  }

  usedBytes(): number {
    return this.meta.reduce((a, m) => a + m.bytes, 0);
  }
}
