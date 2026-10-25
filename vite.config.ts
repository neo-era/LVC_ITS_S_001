import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import { stampSw } from './src/update';

const BUILD = Date.now().toString(36);

/** Mỗi lần build, service worker có mã phiên bản mới → điện thoại nhận ra bản mới và tự cập nhật. */
const stampServiceWorker = () => ({
  name: 'stamp-sw',
  apply: 'build' as const,
  closeBundle() {
    const f = join(__dirname, 'dist', 'sw.js');
    writeFileSync(f, stampSw(readFileSync(f, 'utf8'), BUILD));
  },
});

export default defineConfig({
  base: './',
  define: { __APP_BUILD__: JSON.stringify(BUILD) },
  plugins: [stampServiceWorker()],
  build: {
    rollupOptions: {
      input: {
        main: join(__dirname, 'index.html'),
        fleet: join(__dirname, 'fleet.html'),
        ...(process.env.OCR_TEST ? { ocrtest: join(__dirname, 'tools/ocr/ocr-test.html') } : {}),
      },
    },
  },
});
