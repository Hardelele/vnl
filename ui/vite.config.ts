import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Дизайн-система живёт в одном месте на весь репозиторий: UI читает
      // те же токены, что и генератор статических страниц.
      '@design': fileURLToPath(new URL('../design/reckue', import.meta.url)),
    },
  },
  server: {
    fs: { allow: ['..'] },
    // Библиотека живёт в Python, а интерфейс в разработке -- на своём порту.
    // Прокси вместо CORS: разрешать чужой источник ради собственного сервера
    // значило бы держать открытой дверь, которая нужна только в разработке.
    proxy: { '/api': { target: 'http://127.0.0.1:8765', changeOrigin: false } },
  },
  // Сборка кладётся туда, откуда её отдаёт `vnl serve --ui ui/dist`.
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom', globals: true },
})
