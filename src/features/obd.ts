/** OBD-II qua đầu đọc ELM327 Bluetooth LE (Chrome Android). */
export type ObdValue = { pid: 'speed' | 'rpm' | 'coolant'; value: number } | null;

/**
 * Đọc phản hồi ELM327. Tách theo dòng (không ghép dòng này với dòng kia), lấy dòng cuối có dữ liệu.
 * expect = PID vừa hỏi ('0D' | '0C' | '05'): phản hồi của PID khác (đến trễ từ lệnh trước) bị bỏ.
 */
export function parseObd(raw: string, expect?: string): ObdValue {
  const want = expect?.toUpperCase();
  // khung phải nằm ở CUỐI dòng và đúng số byte của PID (0D, 05: 1 byte; 0C: 2 byte)
  const re = want ? new RegExp(`41(${want})([0-9A-F]{2})${want === '0C' ? '([0-9A-F]{2})' : '()'}$`) : /41(0D|0C|05)([0-9A-F]{2})([0-9A-F]{2})?$/;
  let m: RegExpExecArray | null = null;
  for (const line of raw.toUpperCase().split(/[\r\n>]+/)) {
    const x = re.exec(line.replace(/[^0-9A-F]/g, ''));
    if (x) m = x;
  }
  if (!m) return null;
  const A = parseInt(m[2], 16);
  const B = m[3] ? parseInt(m[3], 16) : 0;
  if (m[1] === '0D') return { pid: 'speed', value: A };
  if (m[1] === '0C') return m[3] ? { pid: 'rpm', value: Math.round((A * 256 + B) / 4) } : null;
  return { pid: 'coolant', value: A - 40 };
}

/** Bộ đệm phản hồi: trả nguyên khung khi gặp '>', giới hạn 512 ký tự (đầu đọc lỗi không gửi '>'). */
export class ObdBuffer {
  private buf = '';
  get size(): number {
    return this.buf.length;
  }
  reset(): void {
    this.buf = '';
  }
  feed(chunk: string): string | null {
    this.buf += chunk;
    if (this.buf.includes('>')) {
      const out = this.buf;
      this.buf = '';
      return out;
    }
    if (this.buf.length > 512) this.buf = this.buf.slice(-512);
    return null;
  }
}

/**
 * Đối chiếu tốc độ OBD với GPS: lệch > 20 km/h liên tục ≥ 5 s (khi có GPS tốt) → thôi tin OBD tới lần kết nối sau
 * (đầu đọc rởm kẹt 0 km/h sẽ làm tắt mọi cảnh báo vượt tốc độ).
 */
export class ObdSanity {
  private since: number | null = null;
  private bad = false;
  reset(): void {
    this.since = null;
    this.bad = false;
  }
  push(obdKmh: number, gpsKmh: number | null, t: number): boolean {
    if (this.bad) return false;
    if (gpsKmh === null || Math.abs(obdKmh - gpsKmh) <= 20) {
      this.since = null;
      return true;
    }
    this.since ??= t;
    if (t - this.since > 5000) this.bad = true;
    return !this.bad;
  }
}

const SERVICES = [0xfff0, 0xffe0, 0x18f0, 'e7810a71-73ae-499d-8c15-faa9aef0c3f2'];

type Char = {
  properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean };
  writeValue: (b: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (b: BufferSource) => Promise<void>;
  startNotifications: () => Promise<unknown>;
  addEventListener: (t: string, f: (e: Event) => void) => void;
  value?: DataView;
};

export class Obd {
  onValue: (v: NonNullable<ObdValue>) => void = () => {};
  onClose: () => void = () => {};
  private writer: Char | null = null;
  private readonly buf = new ObdBuffer();
  private wait: ((s: string) => void) | null = null;
  private timer: number | null = null;
  private session = 0;
  private device: { gatt?: { disconnect: () => void }; addEventListener: (t: string, f: () => void) => void } | null = null;

  static supported(): boolean {
    return 'bluetooth' in navigator;
  }

  async connect(): Promise<void> {
    this.close(false);
    const bt = (navigator as unknown as { bluetooth: { requestDevice: (o: unknown) => Promise<never> } }).bluetooth;
    const device = (await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES })) as unknown as {
      gatt: { connect: () => Promise<{ getPrimaryServices: () => Promise<{ getCharacteristics: () => Promise<Char[]> }[]> }>; disconnect: () => void };
      addEventListener: (t: string, f: () => void) => void;
    };
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => this.device === device && this.close());
    try {
      await this.setup(device);
    } catch (e) {
      this.close(false);
      throw e;
    }
    this.poll();
  }

  private async setup(device: { gatt: { connect: () => Promise<{ getPrimaryServices: () => Promise<{ getCharacteristics: () => Promise<Char[]> }[]> }> } }): Promise<void> {
    const server = await device.gatt.connect();
    let notify: Char | null = null;
    for (const svc of await server.getPrimaryServices()) {
      for (const ch of await svc.getCharacteristics()) {
        if (!notify && ch.properties.notify) notify = ch;
        if (!this.writer && (ch.properties.write || ch.properties.writeWithoutResponse)) this.writer = ch;
      }
    }
    if (!notify || !this.writer) throw new Error('Không nhận ra đầu đọc OBD (cần loại ELM327 Bluetooth LE).');
    await notify.startNotifications();
    notify.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as unknown as Char).value;
      if (!v) return;
      const out = this.buf.feed(new TextDecoder().decode(v));
      if (out !== null) {
        this.wait?.(out);
        this.wait = null;
      }
    });
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATSP0']) await this.cmd(c, 3000);
  }

  private cmd(c: string, ms = 1500): Promise<string> {
    this.buf.reset();
    return new Promise((res) => {
      const t = setTimeout(() => (this.wait = null, this.buf.reset(), res('')), ms);
      this.wait = (s) => (clearTimeout(t), res(s));
      const bytes = new TextEncoder().encode(`${c}\r`);
      const w = this.writer!;
      void (w.properties.writeWithoutResponse && w.writeValueWithoutResponse ? w.writeValueWithoutResponse(bytes) : w.writeValue(bytes)).catch(() => res(''));
    });
  }

  private poll(): void {
    let i = 0;
    const my = this.session;
    const pids = ['010D', '010D', '010C', '010D', '0105'];
    const step = async () => {
      if (!this.writer || my !== this.session) return;
      const pid = pids[i++ % pids.length];
      const v = parseObd(await this.cmd(pid), pid.slice(2));
      if (my !== this.session) return;
      if (v) this.onValue(v);
      this.timer = window.setTimeout(() => void step(), 250);
    };
    void step();
  }

  close(notify = true): void {
    this.session++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.writer = null;
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* bỏ qua */
    }
    const had = this.device !== null;
    this.device = null;
    this.wait = null;
    this.buf.reset();
    if (notify && had) this.onClose();
  }
}
