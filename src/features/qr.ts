import qrcode from 'qrcode-generator';

/** QR dán trên trụ: mở app với ?tru=<mã>. Camera điện thoại quét là mở được, không cần app riêng. */
export function poleUrl(base: string, code: string): string {
  return `${base}?tru=${encodeURIComponent(code)}`;
}

export function poleFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get('tru');
  return v && v.length <= 60 ? v : null;
}

export function qrSvg(text: string, cell = 4): string {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
