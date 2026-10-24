import type { CellData } from './core/cells';
import type { GpsSample } from './core/gps';

const M = 111195;
export const SIM_START = { lat: 10.77, lng: 106.7 };
const at = (s: number) => SIM_START.lat + s / M;

/** Dữ liệu mô phỏng: đường thẳng hướng bắc, giới hạn 50 rồi 60, camera ở 1800 m, điểm đen ở 2600 m. */
export function simData(): CellData {
  const segments = [];
  for (let s = 0; s < 3200; s += 400) {
    segments.push({
      id: `SIM${s}`,
      a: { lat: at(s), lng: SIM_START.lng },
      b: { lat: at(s + 400), lng: SIM_START.lng },
      maxspeed: s < 1200 ? 50 : 60,
    });
  }
  return {
    segments,
    alerts: [
      { id: 'SIM-CAM', type: 'camera', lat: at(1800), lng: SIM_START.lng, dir: 0 },
      { id: 'SIM-BS', type: 'blackspot', lat: at(2600), lng: SIM_START.lng },
    ],
  };
}

/** Tốc độ mô phỏng (m/s) theo quãng đường đã đi: có đoạn chạy quá 50 để thử cảnh báo vượt tốc độ. */
function speedAt(s: number): number {
  if (s < 600) return 13;
  if (s < 1200) return 16;
  return 15;
}

export class Simulator {
  private s = 0;
  private t = Date.now();
  private timer: number | null = null;

  start(onSample: (g: GpsSample) => void): void {
    this.stop();
    this.s = 0;
    this.t = Date.now();
    this.timer = window.setInterval(() => {
      // mỗi 200 ms mô phỏng 1 giây xe chạy
      this.t += 1000;
      this.s += speedAt(this.s);
      if (this.s > 3100) this.s = 0;
      onSample({ t: this.t, lat: at(this.s), lng: SIM_START.lng, speed: speedAt(this.s), accuracy: 5 });
    }, 200);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }
}
