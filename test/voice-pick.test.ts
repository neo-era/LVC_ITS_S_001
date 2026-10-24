import { describe, expect, it } from 'vitest';
import { pickVoice, STYLES, styleOf, viVoices, type VoiceLike } from '../src/voice-pick';

const v = (name: string, lang: string, localService = true): VoiceLike => ({ name, lang, localService, voiceURI: name });

describe('viVoices', () => {
  it('chỉ giữ giọng tiếng Việt, ưu tiên bản chất lượng cao (Enhanced/Premium/Natural/Neural/Online)', () => {
    const list = [v('Samantha', 'en-US'), v('Linh', 'vi-VN'), v('Linh (Enhanced)', 'vi-VN'), v('Google tiếng Việt', 'vi_VN', false), v('Microsoft HoaiMy Online (Natural)', 'vi-VN', false)];
    const names = viVoices(list).map((x) => x.name);
    expect(names).not.toContain('Samantha');
    expect(names.slice(0, 2).sort()).toEqual(['Linh (Enhanced)', 'Microsoft HoaiMy Online (Natural)'].sort());
    expect(names).toHaveLength(4);
  });
});

describe('pickVoice', () => {
  const list = [v('Linh', 'vi-VN'), v('Linh (Enhanced)', 'vi-VN'), v('Daniel', 'en-GB')];
  it('đúng tên đã chọn thì dùng tên đó', () => {
    expect(pickVoice(list, 'Linh')?.name).toBe('Linh');
  });
  it('không có tên đã chọn → giọng tiếng Việt tốt nhất', () => {
    expect(pickVoice(list, 'Không có')?.name).toBe('Linh (Enhanced)');
    expect(pickVoice(list, '')?.name).toBe('Linh (Enhanced)');
  });
  it('không có giọng tiếng Việt → null (để máy tự dùng giọng mặc định theo lang vi-VN)', () => {
    expect(pickVoice([v('Daniel', 'en-GB')], '')).toBeNull();
  });
});

describe('kiểu giọng', () => {
  it('có kiểu "Dễ thương" cao giọng hơn bình thường; tên lạ → bình thường', () => {
    expect(styleOf('cute').pitch).toBeGreaterThan(styleOf('normal').pitch);
    expect(styleOf('xyz')).toEqual(STYLES.normal);
    for (const s of Object.values(STYLES)) {
      expect(s.pitch).toBeGreaterThanOrEqual(0.5);
      expect(s.pitch).toBeLessThanOrEqual(2);
      expect(s.rate).toBeGreaterThanOrEqual(0.7);
      expect(s.rate).toBeLessThanOrEqual(1.4);
    }
  });
});
