import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'

export default defineConfig({
  cacheDir: fileURLToPath(new URL('../TEMP/vite', import.meta.url)),
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // 每个 UI 进程独立加载 jsdom 与组件库；CI 降低并发，为共享 Runner 留出资源。
    maxWorkers: Math.min(process.env.CI ? 2 : 4, availableParallelism()),
    // 完整 UI 交互包含多次渲染与可访问性查询，统一给予有限的执行余量。
    testTimeout: 15_000,
    include: ['src/**/*.ui.test.tsx'],
    setupFiles: ['./src/test/setup.ts'],
  },
})
