import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { build } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.resolve(root, '../TEMP/detached-windows')
const production = process.argv.includes('--production')
const workflow = process.argv.includes('--workflow')
const acceptance = workflow ? 'workflow-acceptance.mjs' : 'acceptance.mjs'
const preview = workflow ? 'scripts/desktop/workflow-window-preview.html' : 'scripts/agent/detached-preview.html'
await mkdir(output, { recursive: true })
for (const [entry, filename, format] of [
  [workflow ? 'scripts/desktop/workflow-window-acceptance.ts' : 'scripts/agent/detached-acceptance.ts', acceptance, 'es'],
  ['electron/detached-preload.ts', 'detached-preload.cjs', 'cjs'],
  ['scripts/agent/detached-host-preload.ts', 'host-preload.cjs', 'cjs'],
]) {
  await build({ configFile: false, root, cacheDir: path.resolve(root, '../TEMP/vite'), logLevel: 'warn', ssr: { noExternal: true, external: ['electron'] },
    build: { ssr: path.join(root, entry), outDir: output, emptyOutDir: false, target: 'node24', minify: false,
      rolldownOptions: { external: ['electron'], output: { format, entryFileNames: filename, codeSplitting: false } } } })
}
if (production) {
  await build({ configFile: false, root, base: './', plugins: [react()], cacheDir: path.resolve(root, '../TEMP/vite'), logLevel: 'warn',
    build: { outDir: path.join(output, workflow ? 'workflow-fixture' : 'fixture'), emptyOutDir: true,
      rolldownOptions: { input: path.join(root, preview) } } })
}
const require = createRequire(import.meta.url)
const child = spawn(require('electron'), [path.join(output, acceptance), output, ...(production ? ['--production'] : [])], { cwd: root, stdio: 'inherit', windowsHide: true })
const timeout = setTimeout(() => { console.error('独立窗口验收超时'); child.kill() }, 180000)
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1 })
