/** Giọng đọc tiếng Việt qua speechSynthesis. Phải "mở khóa" bằng một thao tác chạm của người dùng. */
export class Voice {
  enabled = true;
  private voice: SpeechSynthesisVoice | null = null;

  private pick(): void {
    if (!('speechSynthesis' in window)) return;
    const list = speechSynthesis.getVoices();
    this.voice = list.find((v) => v.lang.toLowerCase().startsWith('vi')) ?? null;
  }

  /** Gọi trong sự kiện chạm: mở khóa phát âm trên iOS/Android. */
  unlock(): void {
    if (!('speechSynthesis' in window)) return;
    this.pick();
    speechSynthesis.onvoiceschanged = () => this.pick();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  speak(text: string): void {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    if (!this.voice) this.pick();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'vi-VN';
    if (this.voice) u.voice = this.voice;
    u.rate = 1;
    if (speechSynthesis.pending) speechSynthesis.cancel(); // hàng đợi đã đầy: bỏ câu cũ, giữ câu mới
    speechSynthesis.speak(u);
  }
}
