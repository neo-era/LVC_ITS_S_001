import { DigitTemplates, findRedCircles, readLimit, SignVoter } from '../../src/features/signocr';

function makeDigit(d: string, font: string): ImageData {
  const c = document.createElement('canvas');
  c.width = 40;
  c.height = 56;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, 40, 56);
  g.fillStyle = '#000';
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(d, 20, 28);
  return g.getImageData(0, 0, 40, 56);
}

/** Vẽ cảnh đường có biển tròn viền đỏ ghi số, hơi nghiêng/nhoè như ảnh camera. */
function scene(num: string, cx: number, cy: number, r: number, font: string, noise = 0): HTMLCanvasElement {
  const c = document.getElementById('c') as HTMLCanvasElement;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#9fb3c8';
  g.fillRect(0, 0, 320, 240);
  g.fillStyle = '#6b7280';
  g.fillRect(0, 150, 320, 90);
  g.fillStyle = '#fff';
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = r * 0.22;
  g.strokeStyle = '#d32f2f';
  g.beginPath();
  g.arc(cx, cy, r * 0.89, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#111';
  g.font = font.replace('44px', `${Math.round(r * (num.length > 2 ? 0.72 : 0.95))}px`);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(num, cx, cy + r * 0.04);
  if (noise) {
    const im = g.getImageData(0, 0, 320, 240);
    for (let i = 0; i < im.data.length; i += 4) {
      const n = (Math.random() - 0.5) * noise;
      im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n;
    }
    g.putImageData(im, 0, 0);
  }
  return c;
}

async function main() {
  await (document as Document & { fonts: FontFaceSet }).fonts.ready;
  const tpl = new DigitTemplates(makeDigit);
  const out: Record<string, unknown> = {};
  const cases: [string, number, string, number][] = [
    ['60', 40, 'bold 44px "Be Vietnam Pro", Arial, sans-serif', 0],
    ['50', 30, 'bold 44px Arial, sans-serif', 20],
    ['80', 24, '900 44px sans-serif', 30],
    ['40', 36, 'bold 44px "Be Vietnam Pro", Arial, sans-serif', 40],
    ['100', 40, 'bold 44px Arial, sans-serif', 10],
  ];
  for (const [num, r, font, noise] of cases) {
    const c = scene(num, 200, 90, r, font, noise);
    const g = c.getContext('2d', { willReadFrequently: true })!;
    const frame = g.getImageData(0, 0, 320, 240);
    const circles = findRedCircles(frame);
    let got: { value: number; conf: number } | null = null;
    for (const b of circles) {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rr = (Math.min(b.w, b.h) / 2) * 0.62;
      const S = 96;
      const c2 = document.createElement('canvas');
      c2.width = S; c2.height = S;
      const g2 = c2.getContext('2d')!;
      g2.drawImage(c, cx - rr, cy - rr, 2 * rr, 2 * rr, 0, 0, S, S);
      got = readLimit(g2.getImageData(8, 8, S - 16, S - 16), tpl);
      if (got) break;
    }
    out[`${num}@r${r}n${noise}`] = { circles: circles.length, got };
  }
  // ảnh không có biển (xe đỏ): không được nhận
  const c = document.getElementById('c') as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.fillStyle = '#9fb3c8'; g.fillRect(0, 0, 320, 240);
  g.fillStyle = '#d32f2f'; g.fillRect(100, 100, 80, 50);
  out.redCar = findRedCircles(g.getImageData(0, 0, 320, 240)).length;
  const v = new SignVoter();
  out.voter = [v.push(60), v.push(60)];
  (document.getElementById('out') as HTMLElement).textContent = JSON.stringify(out);
  (window as unknown as { __ocr: unknown }).__ocr = out;
}
void main();
