import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app } from 'electron'
import { UtilityWorkerFactory } from './factory.mjs'

// 入口与验收资源位于同一目录，避免 Electron 平台参数改变 argv 的位置。
const output = path.dirname(fileURLToPath(import.meta.url))
const profile = path.join(output, 'profile')
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app.setPath('sessionData', profile)
app.setPath('crashDumps', path.join(output, 'crashes'))
app.setAppLogsPath(path.join(output, 'logs'))
const archive = path.join(output, 'fixture.asar')
const requests = JSON.parse(readFileSync(path.join(output, 'requests.json'), 'utf8'))
const paths = []
const server = createServer((request, response) => {
  paths.push(request.url)
  request.resume()
  // 只验证真实 Worker 加载、IPC 与失败回收，不调用真实 Core 或模型供应商。
  response.writeHead(401, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ error: { code: 'unauthorized', message: '隔离验收拒绝凭据' } }))
})

async function exercise(modulePath, cwd, start) {
  const worker = new UtilityWorkerFactory({ modulePath, cwd }).create()
  const messages = []
  let spawned = false
  let timer
  const disposers = []
  try {
    const exitCode = await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Worker 未完成启动或退出：${path.basename(modulePath)}`)), 25_000)
      disposers.push(worker.onMessage(message => {
        messages.push(message)
        // 探针等到宿主确认后退出，避免固定延迟在繁忙 CI 上丢失消息。
        if (start?.type === 'probe') {
          try { worker.postMessage({ type: 'done' }) } catch (error) { reject(error) }
        }
      }))
      disposers.push(worker.onExit(resolve))
      disposers.push(worker.onSpawn(() => {
        spawned = true
        try { if (start) worker.postMessage(start) } catch (error) { reject(error) }
      }))
    })
    assert.equal(spawned, true)
    assert.equal(exitCode, 0)
    return messages
  } finally {
    clearTimeout(timer)
    worker.kill()
    for (const dispose of disposers) dispose()
  }
}

async function main() {
  await app.whenReady()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseURL = `http://127.0.0.1:${server.address().port}`
  const probe = path.join(archive, 'probe.cjs')
  for (const cwd of [archive, path.join(archive, 'dist-electron'), path.join(output, 'missing'), '.']) {
    assert.throws(() => new UtilityWorkerFactory({ modulePath: probe, cwd }).create(), /AGENT_RUNTIME_WORKING_DIRECTORY_INVALID/u)
  }
  assert.deepEqual(await exercise(probe, output, { type: 'probe' }), [{ cwd: output }])
  assert.deepEqual(await exercise(path.join(output, 'source', 'probe.cjs'), output, { type: 'probe' }), [{ cwd: output }])
  const agentMessages = await exercise(path.join(archive, 'dist-electron', 'agent-worker.js'), output, {
    ...requests.agent, core_base_url: baseURL,
  })
  assert.ok(agentMessages.some(message => message.type === 'fatal' && message.category === 'bootstrap_failed'))
  assert.ok(paths.includes('/api/v1/agent/runtime/bootstrap'))
  requests.terminal.bootstrap.model.snapshot.base_url = `${baseURL}/v1`
  const terminalMessages = await exercise(path.join(archive, 'dist-electron', 'terminal-completion-worker.js'), output, requests.terminal)
  assert.ok(terminalMessages.some(message => message.status === 'failed' && message.requestId === requests.terminal.request.requestId))
  assert.ok(paths.includes('/v1/responses'))
  console.log('ASAR Worker 验收通过：非法工作目录拒绝、开发入口、归档入口、AI 与终端 IPC 及失败退出。')
}

function finish(code) {
  server.closeAllConnections()
  server.close()
  app.exit(code)
}

void main().then(() => finish(0), error => { console.error(error); finish(1) })
