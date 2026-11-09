import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite-plugin-electron'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
await build({ entry: { 'memory-worker': 'scripts/agent/memory/worker.ts', 'memory-host': 'scripts/agent/memory/host.ts' },
  vite: { root, cacheDir: path.resolve(root, '../TEMP/vite'), build: { outDir: path.resolve(root, '../TEMP/agent-memory-research/harness'), emptyOutDir: false } } })
