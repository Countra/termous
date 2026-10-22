import { cp, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { build } from 'vite'
import { testAgentSkillBundle } from '../../electron/agent/test-support/skillBundleTestFixture.ts'
import { completionTestBootstrap, completionTestRequest } from '../../electron/terminalCompletion/testFixture.ts'
import { agentRuntimeProtocolVersion } from '../../common/contracts/index.ts'
import { sanitizedWorkerEnvironment } from '../../electron/agent/host/workerEnvironment.ts'
import { buildOutputPaths } from '../build/output-paths.mjs'

const require = createRequire(import.meta.url)
// 使用打包工具链自身的 ASAR 实现，与正式包格式一致。
const builderRequire = createRequire(require.resolve('electron-builder'))
const asarRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const { createPackage } = asarRequire('@electron/asar')
const root = fileURLToPath(new URL('../../', import.meta.url))
const outputs = buildOutputPaths(root)
const temporary = outputs.verification
await mkdir(temporary, { recursive: true })
const output = await mkdtemp(path.join(temporary, 'agent workers '))
const source = path.join(output, 'source')
await mkdir(source)
await cp(outputs.electron, path.join(source, 'dist-electron'), { recursive: true })
await writeFile(path.join(source, 'package.json'), JSON.stringify({ type: 'module' }))
await writeFile(path.join(source, 'probe.cjs'), `process.parentPort.on('message', ({ data }) => {
  if (data.type === 'probe') process.parentPort.postMessage({ cwd: process.cwd() })
  if (data.type === 'done') process.exit(0)
})\n`)
await writeFile(path.join(output, 'requests.json'), JSON.stringify({
  agent: {
    type: 'start', protocol_version: agentRuntimeProtocolVersion,
    run_id: 'agr_packaged_test', generation: 1, ticket: 't'.repeat(48), skills: testAgentSkillBundle(),
  },
  terminal: { type: 'start', request: completionTestRequest(), bootstrap: completionTestBootstrap() },
}))
await createPackage(source, path.join(output, 'fixture.asar'))
await build({
  configFile: false, root, logLevel: 'warn',
  ssr: { noExternal: true, external: ['electron', 'original-fs'] },
  build: {
    ssr: path.join(root, 'electron/agent/host/utilityWorkerFactory.ts'), outDir: output,
    emptyOutDir: false, target: 'node24', minify: false,
    rolldownOptions: { external: ['electron', 'original-fs'], output: { format: 'es', entryFileNames: 'factory.mjs', codeSplitting: false } },
  },
})
await cp(path.join(root, 'scripts/agent/worker-acceptance.mjs'), path.join(output, 'acceptance.mjs'))
const environment = sanitizedWorkerEnvironment(process.env)
for (const name of ['DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) {
  if (process.env[name]) environment[name] = process.env[name]
}
const child = spawn(require('electron'), [path.join(output, 'acceptance.mjs'), output], {
  cwd: output, stdio: 'inherit', windowsHide: true, env: environment,
})
let timedOut = false
const timeout = setTimeout(() => {
  timedOut = true
  console.error('ASAR Worker 验收超时')
  child.kill()
}, 120_000)
child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
child.on('exit', code => { clearTimeout(timeout); process.exitCode = timedOut ? 1 : code ?? 1 })
