import { IntegrationHostRuntime } from './runtime.ts'
import { isRecord } from '../../contracts/validation.ts'
import type { IntegrationCoreConfig } from '../coreClient.ts'

const port = process.parentPort
if (!port) throw new Error('INTEGRATION_PARENT_UNAVAILABLE')
const runtime = new IntegrationHostRuntime(message => port.postMessage(message))
let initialized = false
let closing = false
const close = async () => {
  if (closing) return
  closing = true
  try { await runtime.close() } finally { process.exit(0) }
}
port.on('message', event => {
  const data: unknown = event.data
  if (!isRecord(data)) return
  if (data.type === 'close') { void close(); return }
  if (data.type === 'initialize' && !initialized) {
    initialized = true
    void runtime.initialize(data.config as IntegrationCoreConfig).catch(() => { port.postMessage({ type: 'failed' }); void close() })
    return
  }
  runtime.handle(data)
})
// pi-mcp 在正常退出时清理 POSIX 进程组；父进程消失也走相同关闭路径。
const parentPID = process.ppid
const parentWatch = setInterval(() => {
  try { process.kill(parentPID, 0) } catch { void close() }
}, 1000)
parentWatch.unref()
process.on('SIGTERM', () => { void close() })
process.on('SIGINT', () => { void close() })
