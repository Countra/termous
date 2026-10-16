import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.resolve(root, '../TEMP/system-clipboard-electron')
await mkdir(output, { recursive: true })
for (const [entry, filename, format] of [['scripts/system-clipboard/electron-acceptance.ts', 'acceptance.mjs', 'es'], ['scripts/system-clipboard/preload.ts', 'preload.cjs', 'cjs']]) {
  await build({ configFile: false, root, cacheDir: path.resolve(root, '../TEMP/vite'), logLevel: 'warn', ssr: { noExternal: true, external: ['electron'] }, build: {
    ssr: path.join(root, entry), outDir: output, emptyOutDir: false, target: 'node24', minify: false,
    rolldownOptions: { external: ['electron'], output: { format, entryFileNames: filename, codeSplitting: false } },
  } })
}
const child = spawn(require('electron'), [path.join(output, 'acceptance.mjs'), output], { cwd: root, stdio: 'inherit', windowsHide: true })
const timeout = setTimeout(() => { console.error('Electron 验收超时'); child.kill() }, 60_000)
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1 })
