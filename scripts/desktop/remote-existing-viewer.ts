import RFB from '@novnc/novnc'
import { VncDesktopExecution } from '@termous/remote-protocol/vnc'
import { connectVncExecution } from '../../src/features/remote-desktop/runtime/protocols/vnc/executionBridge.ts'
import type { DesktopState } from '@termous/remote-protocol/vnc/contracts'

// 仅连接内存夹具；本机和远控使用同一个协议会话，禁止预填执行代次或观看就绪。
export async function openExistingViewer(id: string, generation: bigint) {
  const base = `/fixture/local/sessions/${encodeURIComponent(id)}`
  const api = async <T>(path: string, value?: unknown): Promise<T> => {
    const response = await fetch(base + path, { method: value === undefined ? 'GET' : 'POST', headers: { 'X-Termous-Fixture': 'desktop', 'Content-Type': 'application/json' }, body: value === undefined ? undefined : JSON.stringify(value) })
    if (!response.ok) throw new Error(`local viewer ${response.status}`)
    return response.json() as Promise<T>
  }
  const until = async (check: () => boolean | Promise<boolean>) => {
    const deadline = performance.now() + 10_000
    while (!await check()) {
      if (performance.now() > deadline) throw new Error('local viewer timeout')
      await new Promise(resolve => setTimeout(resolve, 25))
    }
  }
  await until(async () => ['ready', 'reattach_wait'].includes((await api<{ status: string }>('')).status))
  const ticket = await api<{ ticket: string }>('/attach', { expected_connection_generation: Number(generation) })
  const target = document.createElement('div')
  target.style.cssText = 'width:400px;height:300px'
  document.body.append(target)
  const rfb = new RFB(target, `ws://${location.host}/fixture/local/stream?ticket=${encodeURIComponent(ticket.ticket)}`, { shared: true, wsProtocols: ['binary'] })
  const abort = new AbortController()
  let disconnected = false
  let closed = false
  rfb.addEventListener('disconnect', () => { disconnected = true; abort.abort() })
  const close = () => { if (closed) return; closed = true; abort.abort(); if (!disconnected) rfb.disconnect(); target.remove() }
  try {
    await until(() => rfb.desktopState.sequence > 0)
    const execution = new VncDesktopExecution(rfb, Number(generation), () => {})
    await connectVncExecution({ connect: async readOnly => {
      const executor = await api<{ ticket: string }>('/executor', { expected_connection_generation: Number(generation), read_only: readOnly })
      return { url: `ws://${location.host}/fixture/local/executor`, ticket: executor.ticket }
    }, reclaim: async () => {} }, execution, abort.signal, () => {}, false)
    await until(async () => (await api<DesktopState>(`/desktop?generation=${generation}`)).control?.owner === 'local-viewer')
    const canvas = target.querySelector('canvas')!
    const pixel = canvas.getContext('2d')!.getImageData(300, 200, 1, 1).data
    if (pixel[0] !== 30 || pixel[1] !== 20 || pixel[2] !== 10) throw new Error('local viewer pixels invalid')
    return { close, disconnected: () => disconnected }
  } catch (error) { close(); throw error }
}
