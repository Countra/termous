import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const electronMainEntry = process.env.TERMOUS_BUILD_UPDATE_SIMULATION === '1'
  ? 'electron/updateSimulationMain.ts'
  : 'electron/main.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: electronMainEntry,
      },
      preload: {
        input: {
          preload: path.join(__dirname, 'electron/preload.ts'),
          'update-preload': path.join(__dirname, 'electron/update-preload.ts'),
        },
        vite: {
          build: {
            rolldownOptions: {
              output: {
                codeSplitting: true,
                entryFileNames: '[name].cjs',
                chunkFileNames: '[name].cjs',
              },
            },
          },
        },
      },
      renderer: process.env.NODE_ENV === 'test'
        // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
        ? undefined
        : {},
    }),
  ],
})
