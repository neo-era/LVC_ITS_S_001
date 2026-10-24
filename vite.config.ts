import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import { stampSw } from './src/update';

/** Mỗi lần build, service worker có mã phiên bản mới → điện thoại nhận ra bản mới và tự cập nhật. */
const stampServiceWorker = () => ({
  name: 'stamp-sw',
  apply: 'build' as const,
  closeBundle() {
    const f = join(__dirname, 'dist', 'sw.js');
    writeFileSync(f, stampSw(readFileSync(f, 'utf8'), Date.now().toString(36)));
  },
});

export default defineConfig({ base: './', plugins: [stampServiceWorker()] });
