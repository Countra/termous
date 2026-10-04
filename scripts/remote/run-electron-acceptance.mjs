import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { build } from 'vite'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.resolve(root, '../TEMP/mobile/electron-remote')
await mkdir(output, { recursive: true })
for (const [entry, filename, format] of [['scripts/remote/electron-acceptance.ts', 'acceptance.mjs', 'es'], ['electron/remote-preload.ts', 'remote-preload.cjs', 'cjs'], ['scripts/remote/launcher.ts', 'launcher.cjs', 'cjs']]) {
  await build({ configFile: false, root, logLevel: 'warn', ssr: { noExternal: true, external: ['electron'] }, build: {
    ssr: path.join(root, entry), outDir: output, emptyOutDir: false, target: 'node24', minify: false,
    rolldownOptions: { external: ['electron'], output: { format, entryFileNames: filename, codeSplitting: false } },
  } })
}
const child = spawn(require('electron'), [path.join(output, 'acceptance.mjs'), output], { cwd: root, stdio: 'inherit', windowsHide: true })
const timeout = setTimeout(() => { console.error('Electron 验收超时'); child.kill() }, 60000)
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
child.on('exit', code => { clearTimeout(timeout); process.exitCode = code ?? 1 })
