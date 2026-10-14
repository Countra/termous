import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'

export default defineConfig({
  cacheDir: fileURLToPath(new URL('../TEMP/vite', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // 每个 UI 进程独立加载 jsdom 与组件库；限制并发，避免多核机器资源争抢造成假超时。
    maxWorkers: Math.min(4, availableParallelism()),
    include: ['src/**/*.ui.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
