/**
 * Nhận dạng biển giới hạn tốc độ từ khung hình camera (thử nghiệm, chạy hoàn toàn trên máy, không tải mô hình).
 * 1) tìm vùng đỏ gần tròn (vòng biển); 2) cắt lòng biển, nhị phân; 3) tách chữ số theo cột;
 * 4) so khớp từng chữ số với mẫu vẽ bằng font của máy (nearest neighbour). Chỉ nhận số hợp lệ (20…120)
 * và phải thấy lặp lại trong vài khung hình liên tiếp mới báo.
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const VALID = new Set([20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
const TW = 12;
const TH = 18;

const isRed = (r: number, g: number, b: number) => r > 110 && r > g * 1.7 && r > b * 1.7 && g < 120 && b < 120;

/** Vùng đỏ gần tròn trong ảnh (quét lưới nhỏ, gom thành phần liên thông). */
export function findRedCircles(img: { width: number; height: number; data: Uint8ClampedArray }, minSize = 18, maxSize = 220): Box[] {
  const { width: W, height: H, data } = img;
  const step = 2;
  const gw = Math.ceil(W / step);
  const gh = Math.ceil(H / step);
  const mask = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const i = ((gy * step) * W + gx * step) * 4;
      if (isRed(data[i], data[i + 1], data[i + 2])) mask[gy * gw + gx] = 1;
    }
  }
  const seen = new Uint8Array(gw * gh);
  const out: Box[] = [];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let minx = gw, maxx = 0, miny = gh, maxy = 0, n = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % gw;
      const y = (c / gw) | 0;
      n++;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const k = ny * gw + nx;
        if (mask[k] && !seen[k]) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
    const w = (maxx - minx + 1) * step;
    const h = (maxy - miny + 1) * step;
    if (w < minSize || h < minSize || w > maxSize || h > maxSize) continue;
    const ratio = w / h;
    if (ratio < 0.7 || ratio > 1.4) continue;
    // vòng tròn: số điểm đỏ ≈ viền, không đầy cả hộp (loại biển cấm đầy đỏ, xe đỏ)
    const fill = (n * step * step) / (w * h);
    if (fill > 0.75 || fill < 0.12) continue;
    out.push({ x: minx * step, y: miny * step, w, h });
  }
  return out.sort((a, b) => b.w - a.w).slice(0, 3);
}

type Gray = { w: number; h: number; g: Float32Array };

function toGray(img: ImageData): Gray {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, j = 0; i < img.data.length; i += 4, j++) g[j] = (img.data[i] * 0.299 + img.data[i + 1] * 0.587 + img.data[i + 2] * 0.114) / 255;
  return { w: img.width, h: img.height, g };
}

/** Ngưỡng Otsu đơn giản → 1 = nét tối. */
function binarize(gr: Gray): Uint8Array {
  const hist = new Float64Array(256);
  for (const v of gr.g) hist[Math.min(255, (v * 255) | 0)]++;
  const total = gr.g.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) (best = v), (thr = i);
  }
  const out = new Uint8Array(gr.g.length);
  for (let i = 0; i < out.length; i++) out[i] = gr.g[i] * 255 < thr ? 1 : 0;
  return out;
}

/** Tách các cột liên tục có nét → từng chữ số; cắt bớt dòng trống trên/dưới. */
export function segmentDigits(bin: Uint8Array, w: number, h: number): Box[] {
  const col = new Int32Array(w);
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) col[x] += bin[y * w + x];
  const boxes: Box[] = [];
  let start = -1;
  const minCol = Math.max(1, Math.round(h * 0.04));
  for (let x = 0; x <= w; x++) {
    const on = x < w && col[x] >= minCol;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      if (x - start >= 3) {
        let top = h, bot = -1;
        for (let y = 0; y < h; y++) for (let xx = start; xx < x; xx++) if (bin[y * w + xx]) { if (y < top) top = y; if (y > bot) bot = y; }
        if (bot - top >= h * 0.3) boxes.push({ x: start, y: top, w: x - start, h: bot - top + 1 });
      }
      start = -1;
    }
  }
  return boxes;
}

function normalize(bin: Uint8Array, w: number, b: Box): Float32Array {
  const out = new Float32Array(TW * TH);
  for (let ty = 0; ty < TH; ty++) {
    for (let tx = 0; tx < TW; tx++) {
      const x0 = b.x + Math.floor((tx * b.w) / TW), x1 = Math.max(x0 + 1, b.x + Math.floor(((tx + 1) * b.w) / TW));
      const y0 = b.y + Math.floor((ty * b.h) / TH), y1 = Math.max(y0 + 1, b.y + Math.floor(((ty + 1) * b.h) / TH));
      let s = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) (s += bin[y * w + x]), n++;
      out[ty * TW + tx] = s / n;
    }
  }
  return out;
}

export class DigitTemplates {
  private readonly t: Float32Array[][] = [];
  /** Vẽ 0–9 bằng vài font đậm có trên máy → mẫu chuẩn hoá. */
  constructor(make: (digit: string, font: string) => ImageData) {
    const fonts = ['bold 44px "Be Vietnam Pro", Arial, sans-serif', 'bold 44px Arial, Helvetica, sans-serif', '900 44px sans-serif'];
    for (let d = 0; d < 10; d++) {
      this.t[d] = [];
      for (const f of fonts) {
        const img = make(String(d), f);
        const bin = binarize(toGray(img));
        const seg = segmentDigits(bin, img.width, img.height);
        if (seg.length) this.t[d].push(normalize(bin, img.width, seg[0]));
      }
    }
  }
  /** Trả chữ số và độ lệch (nhỏ = giống). */
  match(v: Float32Array): { digit: number; dist: number; second: number } {
    // khoảng cách nhỏ nhất của từng chữ số, rồi so chữ số tốt nhất với chữ số tốt nhì (để đo độ chắc)
    const per: number[] = [];
    for (let d = 0; d < 10; d++) {
      let m = 9e9;
      for (const tpl of this.t[d]) {
        let s = 0;
        for (let i = 0; i < v.length; i++) s += (v[i] - tpl[i]) ** 2;
        if (s < m) m = s;
      }
      per[d] = m;
    }
    let bd = 0;
    for (let d = 1; d < 10; d++) if (per[d] < per[bd]) bd = d;
    let second = 9e9;
    for (let d = 0; d < 10; d++) if (d !== bd && per[d] < second) second = per[d];
    return { digit: bd, dist: per[bd], second };
  }
}

/** Đọc số trong lòng biển (ảnh đã cắt, nền trắng chữ đen). null nếu không chắc. */
export function readLimit(inner: ImageData, tpl: DigitTemplates): { value: number; conf: number } | null {
  const gr = toGray(inner);
  const bin = binarize(gr);
  const boxes = segmentDigits(bin, inner.width, inner.height).filter((b) => b.h >= inner.height * 0.35);
  if (boxes.length < 2 || boxes.length > 3) return null;
  let digits = '';
  let worst = 1;
  for (const b of boxes) {
    const m = tpl.match(normalize(bin, inner.width, b));
    const conf = m.second > 0 ? Math.min(1, (m.second - m.dist) / m.second) : 0;
    if (m.dist > 60) return null;
    worst = Math.min(worst, conf);
    digits += m.digit;
  }
  const v = Number(digits);
  if (!VALID.has(v)) return null;
  return { value: v, conf: worst };
}

/** Phải thấy cùng một số ≥ 3 lần trong 5 khung gần nhất mới công nhận. */
export class SignVoter {
  private recent: number[] = [];
  push(v: number | null): number | null {
    this.recent.push(v ?? -1);
    if (this.recent.length > 5) this.recent.shift();
    if (v === null) return null;
    return this.recent.filter((x) => x === v).length >= 3 ? v : null;
  }
}
