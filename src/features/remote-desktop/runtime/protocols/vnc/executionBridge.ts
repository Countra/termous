import type { DesktopControl, DesktopInput, DesktopScreenshotRequest } from '#entities/remote-desktop'
import type { VncDesktopExecution } from './desktopExecution.ts'
import type { DesktopExecutionConnection } from '../../core/viewerContracts.ts'

interface ExecutionRequest {
  id: string
  action: 'describe' | 'control' | 'renew' | 'input' | 'capture' | 'cancel'
  control?: DesktopControl
  input?: DesktopInput
  screenshot?: DesktopScreenshotRequest
}
export type VncExecutionConnection = DesktopExecutionConnection

export async function connectVncExecution(connection: VncExecutionConnection, execution: VncDesktopExecution, signal: AbortSignal, failed: () => void, readOnly: boolean): Promise<() => void> {
  const ticket = await connection.connect(readOnly)
  signal.throwIfAborted()
  const ws = new WebSocket(ticket.url, ['binary'])
  const tasks = new Map<string, AbortController>()
  let captureBusy = false
  let closed = false
  let failureReported = false
  const reportFailure = () => { if (!failureReported) { failureReported = true; failed() } }
  let unwatch = () => {}
  const stop = () => {
    if (closed) return
    closed = true
    unwatch()
    for (const task of tasks.values()) task.abort()
    tasks.clear()
    try { execution.dispose() } catch {
      // 按键清理失败也要关闭 RFB，不能留下失去管理的人工输入连接。
      reportFailure()
    } finally {
      ws.close()
      signal.removeEventListener('abort', stop)
    }
  }
  const fail = () => { if (!closed) { stop(); reportFailure() } }
  signal.addEventListener('abort', stop, { once: true })
  const send = (value: unknown) => {
    if (closed || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 512 * 1024) throw new Error('desktop_executor_unavailable')
    ws.send(JSON.stringify(value))
  }
  ws.onopen = () => { try {
    send({ ticket: ticket.ticket })
    unwatch = execution.watchState((state) => { try { send({ id: '0', state }) } catch { fail() } })
  } catch { fail() } }
  ws.onclose = fail
  ws.onerror = fail
  ws.onmessage = (event) => {
    if (typeof event.data !== 'string' || event.data.length > 64 * 1024) { fail(); return }
    let request: ExecutionRequest
    try { request = JSON.parse(event.data) as ExecutionRequest } catch { fail(); return }
    if (!/^[1-9][0-9]{0,9}$/.test(request.id)) { fail(); return }
    if (request.action === 'cancel') { tasks.get(request.id)?.abort(); return }
    if (tasks.has(request.id) || tasks.size >= 8) { fail(); return }
    const task = new AbortController()
    tasks.set(request.id, task)
    void (async () => {
      try {
        switch (request.action) {
          case 'describe': send({ id: request.id, state: execution.describe() }); break
          case 'control': case 'renew': execution.setControl(request.control ?? null, request.action === 'renew'); send({ id: request.id }); break
          case 'input':
            if (!request.input) throw new Error('desktop_invalid_request')
            execution.execute(request.input); send({ id: request.id }); break
          case 'capture': {
            if (!request.screenshot) throw new Error('desktop_invalid_request')
            if (captureBusy) throw new Error('desktop_busy')
            captureBusy = true
            try {
              const result = await execution.capture(request.screenshot, task.signal)
              const bytes = new Uint8Array(await result.png.arrayBuffer())
              task.signal.throwIfAborted()
              send({ id: request.id, metadata: result.metadata, bytes: bytes.byteLength })
              for (let offset = 0; offset < bytes.length;) {
                task.signal.throwIfAborted()
                if (closed || ws.readyState !== WebSocket.OPEN) throw new Error('desktop_executor_unavailable')
                if (ws.bufferedAmount > 256 * 1024) { await new Promise((resolve) => setTimeout(resolve, 5)); continue }
                const count = Math.min(64 * 1024, bytes.length - offset)
                const chunk = new Uint8Array(8 + count), header = new DataView(chunk.buffer)
                header.setUint32(0, Number(request.id)); header.setUint32(4, offset)
                chunk.set(bytes.subarray(offset, offset + count), 8); ws.send(chunk); offset += count
              }
            } finally { captureBusy = false }
            break
          }
          default: throw new Error('desktop_invalid_request')
        }
      } catch (error) {
        if (!closed && !task.signal.aborted) {
          try { send({ id: request.id, error: error instanceof Error && error.message.startsWith('desktop_') ? error.message : request.action === 'input' ? 'desktop_input_uncertain' : 'desktop_executor_unavailable' }) } catch { fail() }
        }
      } finally { tasks.delete(request.id) }
    })()
  }
  return stop
}
