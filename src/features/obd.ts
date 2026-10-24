/** OBD-II qua đầu đọc ELM327 Bluetooth LE (Chrome Android). */
export type ObdValue = { pid: 'speed' | 'rpm' | 'coolant'; value: number } | null;

export function parseObd(raw: string): ObdValue {
  const s = raw.toUpperCase().replace(/[^0-9A-F]/g, '');
  const m = /41(0D|0C|05)([0-9A-F]{2})([0-9A-F]{2})?/.exec(s);
  if (!m) return null;
  const A = parseInt(m[2], 16);
  const B = m[3] ? parseInt(m[3], 16) : 0;
  if (m[1] === '0D') return { pid: 'speed', value: A };
  if (m[1] === '0C') return m[3] ? { pid: 'rpm', value: Math.round((A * 256 + B) / 4) } : null;
  return { pid: 'coolant', value: A - 40 };
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
  private buf = '';
  private wait: ((s: string) => void) | null = null;
  private timer: number | null = null;
  private device: { gatt?: { disconnect: () => void }; addEventListener: (t: string, f: () => void) => void } | null = null;

  static supported(): boolean {
    return 'bluetooth' in navigator;
  }

  async connect(): Promise<void> {
    const bt = (navigator as unknown as { bluetooth: { requestDevice: (o: unknown) => Promise<never> } }).bluetooth;
    const device = (await bt.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES })) as unknown as {
      gatt: { connect: () => Promise<{ getPrimaryServices: () => Promise<{ getCharacteristics: () => Promise<Char[]> }[]> }>; disconnect: () => void };
      addEventListener: (t: string, f: () => void) => void;
    };
    this.device = device;
    device.addEventListener('gattserverdisconnected', () => this.close());
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
      this.buf += new TextDecoder().decode(v);
      if (this.buf.includes('>')) {
        const out = this.buf;
        this.buf = '';
        this.wait?.(out);
        this.wait = null;
      }
    });
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATSP0']) await this.cmd(c, 3000);
    this.poll();
  }

  private cmd(c: string, ms = 1500): Promise<string> {
    return new Promise((res) => {
      const t = setTimeout(() => (this.wait = null, res('')), ms);
      this.wait = (s) => (clearTimeout(t), res(s));
      const bytes = new TextEncoder().encode(`${c}\r`);
      const w = this.writer!;
      void (w.properties.writeWithoutResponse && w.writeValueWithoutResponse ? w.writeValueWithoutResponse(bytes) : w.writeValue(bytes)).catch(() => res(''));
    });
  }

  private poll(): void {
    let i = 0;
    const pids = ['010D', '010D', '010C', '010D', '0105'];
    const step = async () => {
      if (!this.writer) return;
      const v = parseObd(await this.cmd(pids[i++ % pids.length]));
      if (v) this.onValue(v);
      this.timer = window.setTimeout(() => void step(), 250);
    };
    void step();
  }

  close(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.writer = null;
    try {
      this.device?.gatt?.disconnect();
    } catch {
      /* bỏ qua */
    }
    this.device = null;
    this.onClose();
  }
}
