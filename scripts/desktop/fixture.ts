import RFB from '@novnc/novnc'
import { VncDesktopExecution } from '../../src/features/remote-desktop/runtime/protocols/vnc/desktopExecution.ts'

const result = document.querySelector('#result')!
const rfb = new RFB(document.querySelector('#desktop') as HTMLElement, 'ws://127.0.0.1:5192', { shared: true })
rfb.scaleViewport = true
const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message) }
const frame = new Promise<void>((resolve) => rfb.addEventListener('desktopframe', () => resolve(), { once: true }))
void (async () => {
  await frame
  const execution = new VncDesktopExecution(rfb, 1, () => {})
  const state = execution.describe()
  assert(state.width === 800 && state.height === 600, '桌面尺寸错误')
  const control = { id: 'fixture', owner: 'fixture', generation: 1, expires_at: new Date(Date.now() + 30000).toISOString() }
  execution.setControl(control)
  const request = { expected_connection_generation: 1, display_epoch: state.display_epoch, after_sequence: 0, max_width: 0, max_height: 0 }
  const shot = await execution.capture(request, AbortSignal.timeout(10000))
  const image = await createImageBitmap(shot.png), canvas = document.createElement('canvas')
  canvas.width = 800; canvas.height = 600
  const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
  const pixel = (x: number, y: number) => [...ctx.getImageData(x, y, 1, 1).data].join(',')
  assert(pixel(0, 0) === '30,20,10,255', 'Raw 像素或颜色转换错误')
  assert(pixel(45, 45) === '30,20,10,255', 'CopyRect 更新错误')
  assert(pixel(101, 101) === '0,255,0,255', '异步 Tight PNG 未完成便截图')
  const base = { expected_connection_generation: 1, lease_id: control.id, control_generation: 1, display_epoch: state.display_epoch }
  execution.execute({ ...base, sequence: 1, operation: { kind: 'click', x: 400, y: 300, button: 'left' } })
  execution.execute({ ...base, sequence: 2, operation: { kind: 'shortcut', codes: ['ControlLeft', 'KeyA'] } })
  execution.execute({ ...base, sequence: 3, operation: { kind: 'text', text: '中A' } })
  let stale = false
  try { execution.execute({ ...base, sequence: 3, operation: { kind: 'click', x: 1, y: 1, button: 'left' } }) } catch { stale = true }
  assert(stale, '重复输入没有被拒绝')
  const crop = await execution.capture({ ...request, region: { x: 0, y: 0, width: 200, height: 100 }, max_width: 100 }, AbortSignal.timeout(10000))
  assert(crop.metadata.width === 100 && crop.metadata.height === 50, '裁剪缩放错误')
  await new Promise((resolve) => setTimeout(resolve, 100))
  const events = await fetch('/__fixture/events').then((r) => r.json()) as Array<{ kind: string; buttons: number; x: number; y: number; keysym: number }>
  assert(events.some((e) => e.kind === 'pointer' && e.buttons === 1 && e.x === 400 && e.y === 300), '远端没有收到准确的绝对坐标点击')
  assert(events.some((e) => e.kind === 'key' && e.keysym === (0x01000000 | 0x4e2d)), 'Unicode 输入没有进入 RFB')
  const beforeResize = rfb.desktopState
  const nextFrame = execution.capture({ ...request, display_epoch: 0, after_sequence: beforeResize.sequence }, AbortSignal.timeout(3000))
  execution.execute({ ...base, sequence: 4, operation: { kind: 'shortcut', codes: ['F8'] } })
  const resized = await nextFrame
  assert(resized.metadata.desktop_width === 400 && resized.metadata.desktop_height === 300 && resized.metadata.display_epoch > beforeResize.displayEpoch, '截图未跟随尺寸变化')
  assert(resized.metadata.frame_sequence > beforeResize.sequence, '尺寸变化重置了画面序号')
  execution.dispose()
  document.querySelector<HTMLImageElement>('#snapshot')!.src = URL.createObjectURL(crop.png)
  result.textContent = JSON.stringify({ passed: true, checks: ['Raw', 'CopyRect', 'Tight PNG', '截图与缩放', '绝对坐标点击', '组合键', 'Unicode', '拒绝重复输入', '尺寸变化后等待新画面'], events: events.length }, null, 2)
})().catch((error) => { result.textContent = `FAILED: ${String(error)}` })
