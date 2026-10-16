import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import react from '@vitejs/plugin-react'

const electronMainEntry = process.env.TERMOUS_BUILD_UPDATE_SIMULATION === '1'
  ? 'electron/updateSimulationMain.ts'
  : {
      main: 'electron/main.ts',
      'agent-worker': 'electron/agent/worker/worker.ts',
      'terminal-completion-worker': 'electron/terminalCompletion/worker.ts',
    }

// https://vite.dev/config/
export default defineConfig({
  cacheDir: path.resolve(__dirname, '../TEMP/vite'),
  plugins: [
    react(),
    electron([
      {
        entry: electronMainEntry,
      },
      {
        onstart({ reload }) { reload() },
        vite: {
          build: {
            rolldownOptions: {
              platform: 'node',
              input: {
                preload: path.join(__dirname, 'electron/preload.ts'),
                'update-preload': path.join(__dirname, 'electron/update-preload.ts'),
                'remote-preload': path.join(__dirname, 'electron/remote-preload.ts'),
                'desktop-automation-preload': path.join(__dirname, 'electron/desktop-automation-preload.ts'),
                'startup-preload': path.join(__dirname, 'electron/startup-preload.ts'),
              },
              output: {
                format: 'cjs',
                codeSplitting: true,
                entryFileNames: '[name].cjs',
                chunkFileNames: '[name].cjs',
              },
            },
          },
        },
      },
      {
        onstart({ reload }) { reload() },
        vite: {
          build: {
            // 沙箱 preload 不能 require 本地共享 chunk，使用单独构建确保入口自包含。
            rolldownOptions: {
              input: { 'detached-preload': path.join(__dirname, 'electron/detached-preload.ts') },
              platform: 'node',
              output: { format: 'cjs', codeSplitting: false, entryFileNames: '[name].cjs' },
            },
          },
        },
      },
    ]),
    // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
    ...(process.env.NODE_ENV === 'test' ? [] : [electronRenderer()]),
  ],
})
