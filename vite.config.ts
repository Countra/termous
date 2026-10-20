import { defineConfig } from 'vite'
import path from 'node:path'
import electron, { type ElectronOptions } from 'vite-plugin-electron'
import electronRenderer from 'vite-plugin-electron-renderer'
import react from '@vitejs/plugin-react'
import { prepareDevelopmentShell } from './scripts/desktop-development/prepare.mjs'
import { createDevelopmentStarter } from './scripts/desktop-development/start.mjs'
import { developmentBranding } from './scripts/desktop-development/branding.mjs'
import type { ChildProcess } from 'node:child_process'

const electronMainEntry = process.env.TERMOUS_BUILD_UPDATE_SIMULATION === '1'
  ? 'electron/updateSimulationMain.ts'
  : {
      main: 'electron/main.ts',
      'agent-worker': 'electron/agent/worker/worker.ts',
      'terminal-completion-worker': 'electron/terminalCompletion/worker.ts',
    }

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const development = createDevelopmentStarter({
    prepare: prepareDevelopmentShell,
    child: () => (process as NodeJS.Process & { electronApp?: ChildProcess }).electronApp,
    cwd: __dirname,
    report: error => console.error('Termous Dev 启动或重载失败：', error),
  })
  return {
  cacheDir: path.resolve(__dirname, '../TEMP/vite'),
  plugins: [
    react(),
    developmentBranding(),
    {
      name: 'termous-development-lifecycle',
      apply: 'serve',
      configureServer(server) {
        server.httpServer?.once('close', () => {
          void development.close().catch(error => console.error('Termous Dev 退出失败：', error))
        })
      },
    },
    electron([
      {
        entry: electronMainEntry,
        vite: { define: { __TERMOUS_DESKTOP_CHANNEL__: JSON.stringify(command === 'serve' ? 'development' : 'production') } },
        onstart: context => development.run(context, true),
      },
      {
        onstart: context => development.run(context),
        vite: {
          build: {
            rolldownOptions: {
              platform: 'node',
              input: {
                preload: path.join(__dirname, 'electron/preload.ts'),
                'update-preload': path.join(__dirname, 'electron/update-preload.ts'),
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
      ...['detached-preload', 'remote-preload'].map<ElectronOptions>((entry) => ({
        onstart: context => development.run(context),
        vite: {
          build: {
            // 沙箱 preload 不能 require 本地共享 chunk，使用单独构建确保入口自包含。
            rolldownOptions: {
              input: { [entry]: path.join(__dirname, `electron/${entry}.ts`) },
              platform: 'node',
              output: { format: 'cjs', codeSplitting: false, entryFileNames: '[name].cjs' },
            },
          },
        },
      })),
    ]),
    // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
    ...(process.env.NODE_ENV === 'test' ? [] : [electronRenderer()]),
  ],
  }
})
