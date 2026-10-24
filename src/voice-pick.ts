export interface VoiceLike {
  name: string;
  lang: string;
  localService: boolean;
  voiceURI: string;
}

const QUALITY = /(enhanced|premium|natural|neural|online|nâng cao|cao cấp)/i;

const isVi = (lang: string) => lang.toLowerCase().replace('_', '-').startsWith('vi');

/** Các giọng tiếng Việt có trên máy, giọng chất lượng cao lên trước. */
export function viVoices<T extends VoiceLike>(list: readonly T[]): T[] {
  return list
    .filter((x) => isVi(x.lang))
    .map((x, i) => ({ x, i, q: QUALITY.test(x.name) ? 0 : 1 }))
    .sort((a, b) => a.q - b.q || a.i - b.i)
    .map((o) => o.x);
}

export function pickVoice<T extends VoiceLike>(list: readonly T[], preferred: string): T | null {
  const vi = viVoices(list);
  return vi.find((x) => x.name === preferred) ?? vi[0] ?? null;
}

export interface VoiceStyle {
  label: string;
  pitch: number;
  rate: number;
}

export const STYLES: Record<'cute' | 'normal' | 'warm', VoiceStyle> = {
  cute: { label: 'Dễ thương (cao, vui)', pitch: 1.35, rate: 1.05 },
  normal: { label: 'Bình thường', pitch: 1, rate: 1 },
  warm: { label: 'Trầm ấm', pitch: 0.85, rate: 0.95 },
};

export type StyleKey = keyof typeof STYLES;

export const styleOf = (k: string): VoiceStyle => (k in STYLES ? STYLES[k as StyleKey] : STYLES.normal);
