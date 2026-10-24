/** Đội xe: chia sẻ vị trí theo mã đội (gọi hàm Supabase fleet_ping / fleet_list). */
export const isTeamCode = (s: string): boolean => /^[A-Za-z0-9_-]{8,40}$/.test(s);

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function fleetPingBody(team: string, device: string, name: string, p: { lat: number; lng: number; kmh: number | null; heading: number | null }) {
  return {
    p_team: team,
    p_device: device,
    p_name: name.slice(0, 40),
    p_lat: r6(p.lat),
    p_lng: r6(p.lng),
    p_speed: p.kmh === null ? null : Math.round(p.kmh),
    p_heading: p.heading === null ? null : Math.round(p.heading),
  };
}

export function fleetFresh(updatedAt: string, now: number): 'live' | 'stale' {
  return now - Date.parse(updatedAt) < 2 * 60_000 ? 'live' : 'stale';
}

/** Tên hiển thị khi chia sẻ hành trình: "Tên → Điểm đến ~HH:MM" (≤ 40 ký tự). */
export function shareName(name: string, dest: string, etaT: number): string {
  const d = new Date(etaT + 7 * 3_600_000);
  const eta = ` ~${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  let base = `${name} → ${dest}`;
  const max = 40 - eta.length;
  if (base.length > max) base = base.slice(0, max - 1) + '…';
  return base + eta;
}
