import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { build } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.resolve(root, '../TEMP/desktop-indicator')
await mkdir(output, { recursive: true })
await rm(path.join(output, 'result.json'), { force: true })
await build({ configFile: false, root, cacheDir: path.resolve(root, '../TEMP/vite'), logLevel: 'warn', ssr: { noExternal: true, external: ['electron'] },
  build: { ssr: path.join(root, 'scripts/desktop/indicator-acceptance.ts'), outDir: output, emptyOutDir: false, target: 'node24', minify: false,
    rolldownOptions: { external: ['electron'], output: { format: 'es', entryFileNames: 'acceptance.mjs', codeSplitting: false } } } })
const require = createRequire(import.meta.url)
const child = spawn(require('electron'), [path.join(output, 'acceptance.mjs'), root, output], { cwd: root, stdio: 'inherit', windowsHide: true })
const timeout = setTimeout(() => { console.error('桌面浮层验收超时'); child.kill() }, 90000)
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
child.on('exit', async code => {
  clearTimeout(timeout)
  process.exitCode = code ?? 1
  if (code === 0) {
    try { if (JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8')).passed !== true) throw new Error('验收未完成') }
    catch (error) { console.error(error); process.exitCode = 1 }
  }
})
