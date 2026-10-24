import { lockWindow, planRetention } from '../core/dashcam';
import { clipsToLock, ImpactDetector, type ClipMeta } from './dashcam-plan';

/**
 * Camera hành trình chạy trong trình duyệt (PWA): quay camera sau theo từng đoạn 60 giây,
 * lưu video + danh sách đoạn trong IndexedDB (cùng một CSDL), quay vòng theo dung lượng đặt,
 * khoá đoạn quanh va chạm hoặc khi bấm. Giới hạn PWA: chỉ quay khi app đang mở và màn hình sáng.
 */
const DB = 'lat-dashcam';
const STORE = 'clips';
const META_STORE = 'meta';
const SEGMENT_MS = 60_000;
const MAX_AUTO_LOCKS = 10;

let dbPromise: Promise<IDBDatabase> | null = null;
function idb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE);
    };
    r.onsuccess = () => {
      r.result.onversionchange = () => {
        r.result.close();
        dbPromise = null;
      };
      res(r.result);
    };
    r.onerror = () => {
      dbPromise = null;
      rej(r.error);
    };
  });
  return dbPromise;
}

/** Chạy một giao dịch và chỉ báo xong khi đã ghi hẳn (oncomplete); báo lỗi khi bị huỷ (hết chỗ…). */
async function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  const db = await idb();
  return new Promise<T>((res, rej) => {
    const t = db.transaction(stores, mode);
    let out: T | undefined;
    const req = fn(t);
    if (req) req.onsuccess = () => (out = req.result);
    t.oncomplete = () => res(out as T);
    t.onabort = () => rej(t.error ?? new Error('transaction aborted'));
    t.onerror = () => rej(t.error ?? new Error('transaction error'));
  });
}

export function pickMime(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

export class Dashcam {
  meta: ClipMeta[] = [];
  limitBytes = 2 * 1024 ** 3;
  autoLock = true;
  /** Đã được cấp quyền cảm biến chuyển động (iOS cần chạm). */
  motionGranted = false;
  onChange: () => void = () => {};
  onWarn: (msg: string, severe?: boolean) => void = () => {};
  onImpact: () => void = () => {};
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private current: ClipMeta | null = null;
  private timer: number | null = null;
  private lockPending: { from: number; to: number } | null = null;
  private impact = new ImpactDetector();
  private motionOn = false;
  private pageHideOn = false;
  private fullWarned = false;
  private ready: Promise<void>;
  preview: HTMLVideoElement | null = null;

  constructor() {
    this.ready = this.load();
  }

  get recording(): boolean {
    return this.stream !== null;
  }

  static supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && 'indexedDB' in window;
  }

  /** Đọc danh sách từ IndexedDB và đối chiếu với video thật: bỏ mục không có video, xoá video không có mục. */
  private async load(): Promise<void> {
    try {
      const metaRaw = await tx<unknown>([META_STORE], 'readonly', (t) => t.objectStore(META_STORE).get('list') as IDBRequest<unknown>);
      const keys = await tx<IDBValidKey[]>([STORE], 'readonly', (t) => t.objectStore(STORE).getAllKeys());
      const have = new Set(keys.map(String));
      const list = Array.isArray(metaRaw) ? (metaRaw as ClipMeta[]) : [];
      this.meta = list.filter((m) => m && typeof m.id === 'string' && have.has(m.id));
      const known = new Set(this.meta.map((m) => m.id));
      const orphans = keys.filter((k) => !known.has(String(k)));
      if (orphans.length) await tx([STORE], 'readwrite', (t) => void orphans.forEach((k) => t.objectStore(STORE).delete(k)));
      if (this.meta.length !== list.length) await this.saveMeta();
    } catch {
      this.meta = [];
    }
    this.onChange();
  }

  private async saveMeta(): Promise<void> {
    await tx([META_STORE], 'readwrite', (t) => t.objectStore(META_STORE).put(this.meta, 'list'));
    this.onChange();
  }

  /** Gọi trong thao tác chạm để iOS cấp quyền cảm biến; gọi từ giọng nói thì không có quyền → báo. */
  async requestMotion(): Promise<boolean> {
    const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (!DME.requestPermission) return (this.motionGranted = true);
    try {
      this.motionGranted = (await DME.requestPermission()) === 'granted';
    } catch {
      this.motionGranted = false;
    }
    return this.motionGranted;
  }

  async start(opts: { fromTouch: boolean }): Promise<void> {
    if (this.stream) return;
    if (!Dashcam.supported()) throw new Error('Trình duyệt này chưa hỗ trợ quay video.');
    await this.ready;
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* bỏ qua */
    }
    if (this.autoLock && opts.fromTouch) await this.requestMotion();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    this.stream = stream;
    stream.getVideoTracks().forEach((tr) => (tr.onended = () => this.onStreamLost()));
    if (this.preview) {
      this.preview.srcObject = stream;
      void this.preview.play().catch(() => {});
    }
    if (!this.motionOn) {
      window.addEventListener('devicemotion', this.onMotion);
      this.motionOn = true;
    }
    if (!this.pageHideOn) {
      window.addEventListener('pagehide', this.flush);
      document.addEventListener('visibilitychange', this.onVisibility);
      this.pageHideOn = true;
    }
    if (this.autoLock && !this.motionGranted) this.onWarn('Chưa có quyền cảm biến: video sẽ không tự khoá khi va chạm. Bật quay bằng nút camera để cấp quyền.');
    this.nextSegment();
    this.onChange();
  }

  stop(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    const s = this.stream;
    this.stream = null;
    this.stopRecorder();
    s?.getTracks().forEach((t) => t.stop());
    if (this.preview) this.preview.srcObject = null;
    if (this.motionOn) {
      window.removeEventListener('devicemotion', this.onMotion);
      this.motionOn = false;
    }
    this.onChange();
  }

  private stopRecorder(): void {
    const r = this.rec;
    this.rec = null;
    if (r && r.state !== 'inactive') {
      try {
        r.stop(); // onstop lưu đoạn
      } catch {
        /* đã chết */
      }
    }
  }

  private onStreamLost(): void {
    if (!this.stream) return;
    this.stop();
    this.onWarn('Camera bị ngắt (cuộc gọi, app khác dùng camera hoặc app bị đưa xuống nền). Đã dừng quay.', true);
  }

  /** Trang bị ẩn/đóng: chốt đoạn đang quay xuống đĩa ngay để không mất. */
  private flush = (): void => {
    if (!this.stream) return;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.stopRecorder();
    if (this.stream.getVideoTracks().some((t) => t.readyState === 'live')) this.nextSegment();
  };
  private onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.flush();
  };

  private nextSegment(): void {
    if (!this.stream) return;
    try {
      const mime = pickMime();
      const rec = new MediaRecorder(this.stream, { ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_500_000 });
      const chunks: Blob[] = [];
      const clip: ClipMeta = { id: `v${Date.now().toString(36)}`, bytes: 0, startedAt: Date.now(), locked: false, mime: rec.mimeType || mime };
      if (this.lockPending && this.lockPending.to >= clip.startedAt) clip.locked = true;
      this.current = clip;
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => void this.finish(clip, chunks);
      rec.onerror = () => this.onStreamLost();
      rec.start(1000);
      this.rec = rec;
      this.timer = window.setTimeout(() => {
        this.stopRecorder();
        this.nextSegment();
      }, SEGMENT_MS);
    } catch {
      this.onStreamLost();
    }
  }

  private async finish(clip: ClipMeta, chunks: Blob[]): Promise<void> {
    clip.endedAt = Date.now();
    const blob = new Blob(chunks, { type: clip.mime || 'video/webm' });
    chunks.length = 0;
    clip.bytes = blob.size;
    if (this.current === clip) this.current = null;
    if (!blob.size) return;
    if (this.lockPending && clipsToLock([clip], this.lockPending).length) clip.locked = true;
    try {
      await this.applyRetention(blob.size);
      await tx([STORE, META_STORE], 'readwrite', (t) => {
        t.objectStore(STORE).put(blob, clip.id);
        this.meta = [...this.meta, clip];
        t.objectStore(META_STORE).put(this.meta, 'list');
      });
    } catch (e) {
      this.meta = this.meta.filter((m) => m.id !== clip.id);
      const quota = (e as Error).name === 'QuotaExceededError' || /quota/i.test(String(e));
      this.onWarn(quota ? 'Điện thoại hết chỗ lưu video — đang xoá đoạn cũ không khoá.' : 'Không lưu được đoạn video.', true);
      if (quota) await this.applyRetention(blob.size, true).catch(() => {});
    }
    this.onChange();
  }

  /** Xoá đoạn thường cũ nhất để còn chỗ cho đoạn sắp ghi; kiểm tra lại cờ khoá ngay trước khi xoá. */
  private async applyRetention(incomingBytes: number, tight = false): Promise<void> {
    const limit = tight ? Math.max(1, this.usedBytes() * 0.7) : Math.max(1, this.limitBytes - incomingBytes);
    const plan = planRetention(this.meta, limit);
    const ids = plan.deleteIds.filter((id) => !this.meta.find((m) => m.id === id)?.locked);
    if (ids.length) {
      await tx([STORE, META_STORE], 'readwrite', (t) => {
        ids.forEach((id) => t.objectStore(STORE).delete(id));
        this.meta = this.meta.filter((m) => !ids.includes(m.id));
        t.objectStore(META_STORE).put(this.meta, 'list');
      });
    }
    if (plan.warning && !this.fullWarned) {
      this.fullWarned = true;
      this.onWarn('Video đã khoá chiếm hết dung lượng đặt — không quay thêm được. Hãy tải về hoặc bỏ khoá bớt.', true);
    }
  }

  /** Khoá các đoạn quanh thời điểm hiện tại (±15 giây). Đoạn đang quay được chốt xuống đĩa sau 15 giây. */
  lockNow(at = Date.now(), auto = false): number {
    if (auto && this.meta.filter((m) => m.auto).length >= MAX_AUTO_LOCKS) {
      this.onWarn('Đã có 10 đoạn tự khoá do va chạm — hãy xem và bỏ khoá bớt.');
      return 0;
    }
    const w = lockWindow(at);
    this.lockPending = w;
    const ids = clipsToLock(this.meta, w);
    this.meta = this.meta.map((m) => (ids.includes(m.id) ? { ...m, locked: true, auto: m.auto || auto } : m));
    if (this.current) {
      this.current.locked = true;
      if (auto) this.current.auto = true;
    }
    void this.saveMeta();
    if (this.stream) {
      if (this.timer !== null) window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        this.stopRecorder();
        this.nextSegment();
      }, 15_000);
    }
    return ids.length + (this.current ? 1 : 0);
  }

  private onMotion = (e: DeviceMotionEvent): void => {
    const a = e.accelerationIncludingGravity;
    if (!this.autoLock || !this.stream || !a || a.x === null || a.y === null || a.z === null) return;
    if (this.impact.push({ x: a.x, y: a.y, z: a.z }, Date.now())) {
      if (this.lockNow(Date.now(), true) > 0) this.onWarn('Phát hiện va chạm mạnh — đã khoá video quanh thời điểm này.', true);
      this.onImpact();
    }
  };

  async blob(id: string): Promise<Blob | undefined> {
    return tx<Blob | undefined>([STORE], 'readonly', (t) => t.objectStore(STORE).get(id) as IDBRequest<Blob | undefined>);
  }

  setLocked(id: string, locked: boolean): void {
    this.meta = this.meta.map((m) => (m.id === id ? { ...m, locked, auto: locked ? m.auto : false } : m));
    void this.saveMeta();
  }

  async remove(id: string): Promise<void> {
    await tx([STORE, META_STORE], 'readwrite', (t) => {
      t.objectStore(STORE).delete(id);
      this.meta = this.meta.filter((m) => m.id !== id);
      t.objectStore(META_STORE).put(this.meta, 'list');
    }).catch(() => {});
    this.onChange();
  }

  async removeUnlocked(): Promise<void> {
    const ids = this.meta.filter((x) => !x.locked).map((x) => x.id);
    await tx([STORE, META_STORE], 'readwrite', (t) => {
      ids.forEach((id) => t.objectStore(STORE).delete(id));
      this.meta = this.meta.filter((m) => m.locked);
      t.objectStore(META_STORE).put(this.meta, 'list');
    }).catch(() => {});
    this.onChange();
  }

  usedBytes(): number {
    return this.meta.reduce((a, m) => a + m.bytes, 0);
  }
}
