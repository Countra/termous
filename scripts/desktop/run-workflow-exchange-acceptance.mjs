import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { build } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = path.resolve(root, '../TEMP/workflow-exchange/electron')
await mkdir(output, { recursive: true })
await build({ configFile: false, root, logLevel: 'warn', ssr: { noExternal: true, external: ['electron'] },
  build: { ssr: path.join(root, 'scripts/desktop/workflow-exchange-acceptance.ts'), outDir: output, emptyOutDir: false,
    target: 'node24', minify: false, rolldownOptions: { external: ['electron'], output: { format: 'es', entryFileNames: 'acceptance.mjs', codeSplitting: false } } } })
const require = createRequire(import.meta.url)
const child = spawn(require('electron'), [path.join(output, 'acceptance.mjs'), output], { cwd: root, stdio: 'inherit', windowsHide: true })
const timer = setTimeout(() => { console.error('工作流文件交换原生验收超时'); child.kill() }, 60000)
child.on('error', error => { clearTimeout(timer); console.error(error); process.exitCode = 1 })
child.on('exit', code => { clearTimeout(timer); process.exitCode = code ?? 1 })
