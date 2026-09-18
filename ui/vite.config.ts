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
  server: { fs: { allow: ['..'] } },
  // Сборка кладётся туда, откуда её открывает `vnl app`.
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'jsdom', globals: true },
})
