import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { buildOutputPaths } from '../build/output-paths.mjs'
import { workerAcceptanceLaunchOptions } from '../agent/worker-acceptance-launch.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const outputs = buildOutputPaths(root)
const fixture = process.env.TERMOUS_MCP_FIXTURE
const supervisor = process.env.TERMOUS_INTEGRATION_SUPERVISOR_FIXTURE
if (!fixture || !supervisor) throw new Error('请先构建 MCP 与进程监督验收服务并设置对应环境变量')
await mkdir(outputs.verification, { recursive: true })
const output = await mkdtemp(path.join(outputs.verification, 'integrations-'))
const source = path.join(output, 'source')
await mkdir(source)
await cp(outputs.electron, path.join(source, 'dist-electron'), { recursive: true })
await writeFile(path.join(source, 'package.json'), JSON.stringify({ type: 'module' }))
const builderRequire = createRequire(require.resolve('electron-builder'))
const asarRequire = createRequire(builderRequire.resolve('app-builder-lib'))
await asarRequire('@electron/asar').createPackage(source, path.join(output, 'fixture.asar'))
await writeFile(path.join(output, 'config.json'), JSON.stringify({ fixture, supervisor }))
await cp(path.join(root, 'scripts/integrations/electron-acceptance.mjs'), path.join(output, 'acceptance.mjs'))
const { args, environment } = workerAcceptanceLaunchOptions(output)
await mkdir(environment.XDG_CACHE_HOME)
const child = spawn(require('electron'), [...args, path.join(output, 'acceptance.mjs')], {
  cwd: output, stdio: 'inherit', windowsHide: true, env: environment,
})
let timedOut = false
const timeout = setTimeout(() => { timedOut = true; child.kill() }, 90_000)
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
child.on('exit', code => { clearTimeout(timeout); process.exitCode = timedOut ? 1 : code ?? 1 })
