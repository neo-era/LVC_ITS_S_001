export type BBox = [number, number, number, number];

/** Khung bao [tây, nam, đông, bắc] của ô bản đồ z/x/y (Web Mercator). */
export function tileBBox(z: number, x: number, y: number): BBox {
  const n = 2 ** z;
  const lon = (xx: number) => (xx / n) * 360 - 180;
  const lat = (yy: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * yy) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

/** Hai khung có giao nhau không. */
export function bboxContains(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
}
