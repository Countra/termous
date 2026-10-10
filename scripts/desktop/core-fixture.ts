import RFB from '@novnc/novnc'
import { VncDesktopExecution } from '../../src/features/remote-desktop/runtime/protocols/vnc/desktopExecution.ts'
import { connectVncExecution } from '../../src/features/remote-desktop/runtime/protocols/vnc/executionBridge.ts'
import { DesktopOperationsClient } from '../../src/features/remote-desktop/api/DesktopOperationsClient.ts'
import type { DesktopInput } from '../../src/entities/remote-desktop/model/desktop.ts'

const result = document.querySelector('#result')!
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const api = async <T>(path: string, body?: unknown): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-Termous-Token': 'fixture-token' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 50))
void (async () => {
  const created = await api<{ id: string }>('/remote-desktop-sessions', { profile_id: 'fixture' })
  const path = `/remote-desktop-sessions/${created.id}`
  let session: { status: string; connection_generation: number }
  for (let i = 0; ; i++) { session = await api(path); if (session.status === 'ready') break; if (i > 100) throw new Error('会话未就绪'); await wait() }
  const generation = session.connection_generation
  const ticket = await api<{ ticket: string }>(`${path}/attach-tickets`, { expected_connection_generation: generation })
  const rfb = new RFB(document.querySelector('#desktop') as HTMLElement, `ws://127.0.0.1:5191/api/v1/remote-desktop-stream?ticket=${encodeURIComponent(ticket.ticket)}`, { shared: true, wsProtocols: ['binary'] })
  await new Promise<void>((resolve) => rfb.addEventListener('desktopframe', () => resolve(), { once: true }))
  const execution = new VncDesktopExecution(rfb, generation, () => {})
  const abort = new AbortController()
  await connectVncExecution({ connect: async (readOnly) => {
    const t = await api<{ ticket: string }>(`${path}/executor-ticket`, { expected_connection_generation: generation, read_only: readOnly })
    return { url: 'ws://127.0.0.1:5191/api/v1/remote-desktop-executor', ticket: t.ticket }
  }, reclaim: (readOnly) => api(`${path}/reclaim`, { expected_connection_generation: generation, read_only: readOnly }) }, execution, abort.signal, () => {}, false)
  const client = new DesktopOperationsClient({ apiBaseUrl: location.origin, apiToken: 'fixture-token' })
  let state = await client.describe(created.id, generation)
  for (let i = 0; !state.control; i++) { if (i > 100) throw new Error('执行端未就绪'); await wait(); state = await client.describe(created.id, generation) }
  let conflict = false
  try { await client.acquire(created.id, generation) } catch { conflict = true }
  assert(conflict, '普通申请抢占了本机')
  const lease = await client.acquire(created.id, generation, true)
  const request = { expected_connection_generation: generation, display_epoch: state.display_epoch, after_sequence: 0, max_width: 0, max_height: 0 }
  const captureStarted = performance.now()
  const first = await client.capture(created.id, request)
  const captureMs = performance.now() - captureStarted
  const inputTimings: number[] = []
  let sequence = 0
  const input = async (operation: DesktopInput['operation']) => { const started = performance.now(); await client.input(created.id, { expected_connection_generation: generation, lease_id: lease.id, control_generation: lease.generation, sequence: ++sequence, display_epoch: state.display_epoch, operation }); inputTimings.push(performance.now() - started) }
  await input({ kind: 'click', x: 400, y: 300, button: 'left' })
  await input({ kind: 'text', text: 'Termous 中文' })
  await input({ kind: 'button', x: 10, y: 10, button: 'left', down: true })
  await input({ kind: 'move', x: 20, y: 20 })
  await input({ kind: 'button', x: 20, y: 20, button: 'left', down: false })
  await input({ kind: 'wheel', x: 20, y: 20, delta: 120 })
  await input({ kind: 'shortcut', codes: ['ControlLeft', 'KeyA'] })
  const second = await client.capture(created.id, { ...request, after_sequence: first.metadata.frame_sequence })
  assert(second.metadata.frame_sequence > first.metadata.frame_sequence, '操作后的截图未更新')
  const image = await createImageBitmap(second.png), canvas = document.createElement('canvas')
  canvas.width = 800; canvas.height = 600; const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
  assert(ctx.getImageData(0, 0, 1, 1).data[0] === 255, 'Core 返回了旧截图')
  const held = { expected_connection_generation: generation, lease_id: lease.id, control_generation: lease.generation }
  await client.renew(created.id, held)
  await client.release(created.id, held)
  assert((await client.describe(created.id, generation)).control?.owner === 'local-viewer', '未归还本机控制')
  abort.abort(); rfb.disconnect()
  result.textContent = JSON.stringify({ passed: true, capture_ms: Math.round(captureMs * 10) / 10, input_mean_ms: Math.round(inputTimings.reduce((a, b) => a + b, 0) / inputTimings.length * 10) / 10, checks: ['Core HTTP PNG', 'WS 执行桥接', '冲突与显式接管', '点击与拖动', '滚轮与组合键', '文本输入', '后续画面版本', '续租与归还'] }, null, 2)
  await api('/fixture-result', { passed: true })
})().catch(async (error) => { result.textContent = `FAILED: ${String(error)}`; await api('/fixture-result', { passed: false }).catch(() => {}) })
