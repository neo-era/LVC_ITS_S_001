/** Ranh giới tỉnh/thành (OSM boundary=administrative, admin_level=4) → danh sách tỉnh để cắt bản đồ offline. */
export type BBox = [number, number, number, number]; // [tây, nam, đông, bắc]

export interface Province {
  name: string;
  slug: string;
  bbox: BBox;
  feature: { type: 'Feature'; properties: Record<string, unknown>; geometry: unknown };
}

export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function featureBBox(geom: { type: string; coordinates: unknown } | null | undefined): BBox | null {
  if (!geom) return null;
  let polys: unknown[] = [];
  if (geom.type === 'Polygon') polys = [geom.coordinates];
  else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) polys = geom.coordinates;
  else return null;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const p of polys) {
    if (!Array.isArray(p)) continue;
    for (const ring of p) {
      if (!Array.isArray(ring)) continue;
      for (const c of ring) {
        if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') continue;
        w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
      }
    }
  }
  return Number.isFinite(w) ? [w, s, e, n] : null;
}

export function pickProvinces(features: unknown[]): Province[] {
  const out = new Map<string, Province>();
  for (const f of features) {
    const ft = f as { properties?: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } };
    const p = ft.properties ?? {};
    if (p.boundary !== 'administrative' || String(p.admin_level) !== '4') continue;
    const iso = p['ISO3166-2'];
    if (typeof iso === 'string' && !iso.startsWith('VN-')) continue; // tỉnh nước láng giềng
    const name = typeof p['name:vi'] === 'string' ? (p['name:vi'] as string) : typeof p.name === 'string' ? p.name : '';
    if (!name) continue;
    const bbox = featureBBox(ft.geometry);
    if (!bbox) continue;
    const slug = slugify(name);
    const prev = out.get(slug);
    // Trùng tên: giữ bản có khung bao lớn hơn (đa giác chính).
    const area = (b: BBox) => (b[2] - b[0]) * (b[3] - b[1]);
    if (prev && area(prev.bbox) >= area(bbox)) continue;
    out.set(slug, { name, slug, bbox, feature: { type: 'Feature', properties: { name }, geometry: ft.geometry } });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}
