import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  cacheDir: fileURLToPath(new URL('../TEMP/vite', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.ui.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
