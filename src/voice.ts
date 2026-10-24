import { pickVoice, styleOf, viVoices } from './voice-pick';

/** Giọng đọc tiếng Việt qua speechSynthesis. Phải "mở khóa" bằng một thao tác chạm của người dùng. */
export class Voice {
  enabled = true;
  /** Tên giọng người dùng chọn ('' = tự chọn giọng tiếng Việt tốt nhất). */
  voiceName = '';
  style = 'normal';
  private voice: SpeechSynthesisVoice | null = null;

  private pick(): void {
    if (!('speechSynthesis' in window)) return;
    this.voice = pickVoice(speechSynthesis.getVoices(), this.voiceName);
  }

  /** Danh sách giọng tiếng Việt máy đang có. */
  list(): SpeechSynthesisVoice[] {
    return 'speechSynthesis' in window ? viVoices(speechSynthesis.getVoices()) : [];
  }

  setVoice(name: string): void {
    this.voiceName = name;
    this.pick();
  }

  onVoicesChanged(cb: () => void): void {
    if (!('speechSynthesis' in window)) return;
    speechSynthesis.addEventListener('voiceschanged', () => {
      this.pick();
      cb();
    });
  }

  /** Gọi trong sự kiện chạm: mở khóa phát âm trên iOS/Android. */
  unlock(): void {
    if (!('speechSynthesis' in window)) return;
    this.pick();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  speak(text: string, force = false): void {
    if ((!this.enabled && !force) || !('speechSynthesis' in window)) return;
    if (!this.voice) this.pick();
    const s = styleOf(this.style);
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    if (this.voice) u.voice = this.voice;
    u.pitch = s.pitch;
    u.rate = s.rate;
    if (speechSynthesis.pending) speechSynthesis.cancel(); // hàng đợi đã đầy: bỏ câu cũ, giữ câu mới
    speechSynthesis.speak(u);
  }
}
