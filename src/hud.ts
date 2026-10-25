import { alertLabel, formatDistance } from './core/format';
import { shownSpeed } from './core/speedcal';
import type { ViewState } from './engine';

export interface MapHud {
  speed: string;
  limit: string | null;
  estimated: boolean;
  state: ViewState['state'];
  alert: { title: string; sub: string; dist: string; type: 'camera' | 'blackspot' } | null;
}

/** Dữ liệu hiển thị cho lớp tốc độ + cảnh báo nổi trên bản đồ toàn màn hình. */
export function mapHud(v: ViewState): MapHud {
  return {
    speed: v.status === 'lost' ? '--' : shownSpeed(v.kmh),
    limit: v.limit === null ? null : String(v.limit),
    estimated: v.limitEstimated,
    state: v.state,
    alert: v.alert
      ? {
          title: alertLabel(v.alert.type),
          sub: v.alert.type === 'camera' ? 'Chú ý tốc độ' : 'Chú ý quan sát',
          dist: formatDistance(v.alert.distM),
          type: v.alert.type,
        }
      : null,
  };
}
