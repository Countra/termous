import { generateTerminalCommand } from './generate.ts'
import { isTerminalCompletionStart } from './protocol.ts'
import { isRecord } from '../agent/protocol.ts'

const parentPort = process.parentPort
if (!parentPort) throw new Error('TERMINAL_AI_PARENT_PORT_UNAVAILABLE')
let active: { requestId: string; controller: AbortController } | undefined

parentPort.on('message', (event: Electron.MessageEvent) => {
  const value: unknown = event.data
  if (isRecord(value) && value.type === 'abort' && value.requestId === active?.requestId) {
    active?.controller.abort()
    return
  }
  if (active || !isTerminalCompletionStart(value)) return
  const controller = new AbortController()
  active = { requestId: value.request.requestId, controller }
  void generateTerminalCommand(value.request, value.bootstrap, controller.signal, undefined,
    (usage) => parentPort.postMessage({ type: 'usage', requestId: value.request.requestId, usage })).then((result) => {
    parentPort.postMessage(result)
  }).catch(() => { process.exitCode = 1 }).finally(() => setImmediate(() => process.exit(process.exitCode ?? 0)))
})
