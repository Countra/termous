import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopFileBridge, RemoteResult, SystemFileClipboardContext, SystemFileClipboardState } from '#common/contracts'
import type { TransferTask } from '#entities/file'
import type { DesktopFilesGateway } from '../../../api/DesktopFilesClient.ts'
import { systemClipboardStore } from '../../../model/systemClipboardStore.ts'
import { createRdpSystemFiles } from './systemFiles.ts'

const provider = vi.hoisted(() => ({ bridge: undefined as DesktopFileBridge | undefined }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ desktopFiles: provider.bridge }), getDesktopWindowBridge: () => undefined }))
const context: SystemFileClipboardContext = { sessionId: 'session', generation: 1, subscriptionId: 'viewer', controlGeneration: 2 }
const completed = { id: 'task', status: 'completed' } as TransferTask
const state = (enabled: boolean): RemoteResult<SystemFileClipboardState> => ({ ok: true, value: { supported: true, enabled, files: [] } })
const disposers: (() => void)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0)) dispose(); await Promise.resolve(); provider.bridge = undefined; vi.restoreAllMocks() })
function fixture() {
  const bridge: DesktopFileBridge = {
    configure: vi.fn(async (_context, enabled) => state(enabled)),
    importClipboard: vi.fn(async () => ({ ok: true as const, value: { kind: 'files' as const, sequence: 10, grant: { id: 'grant', items: [] } } })),
    consumeDrop: vi.fn(async () => ({ ok: true as const, value: { kind: 'files' as const, grant: { id: 'grant', items: [] } } })),
    releaseSelection: vi.fn(async () => ({ ok: true as const, value: undefined })),
  }
  provider.bridge = bridge
  const api = { transferClipboard: vi.fn(async () => completed), clipboard: vi.fn(async () => ({ published: true, content_generation: 3 })), tasks: vi.fn(async () => [completed]), cancelTask: vi.fn(async () => undefined) } as unknown as DesktopFilesGateway
  let focused = true, epoch = 0, current: SystemFileClipboardContext | undefined = context
  const paste = vi.fn()
  const runtime = createRdpSystemFiles({ id: 'test-session', api, context: () => current, focused: () => focused, inputEpoch: () => epoch, paste })
  disposers.push(runtime.dispose)
  return { runtime, bridge, api, paste, blur: () => { focused = false; epoch++ }, loseControl: () => { current = undefined; epoch++ } }
}

describe('本机 RDP 文件快捷键与异步发布', () => {
  it('旧发布撤销后清除清单归属，窗口释放后不残留上一轮任务', async () => {
    const f = fixture()
    vi.mocked(f.bridge.configure).mockResolvedValueOnce({ ok: true, value: { supported: true, enabled: true, publication_id: 'publication', task_id: 'receive', content_generation: 7, files: [] } })
    await systemClipboardStore.toggle('test-session', true)
    expect(systemClipboardStore.get('test-session').task_id).toBe('receive')
    await systemClipboardStore.toggle('test-session', false)
    expect(systemClipboardStore.get('test-session').publication_id).toBeUndefined()
    expect(systemClipboardStore.get('test-session').task_id).toBeUndefined()
    const unsubscribe = systemClipboardStore.subscribe('test-session', vi.fn())
    systemClipboardStore.update('test-session', { task_id: 'old-task', publication_id: 'old-publication' })
    f.runtime.dispose()
    expect(systemClipboardStore.get('test-session').task_id).toBeUndefined()
    expect(systemClipboardStore.get('test-session').publication_id).toBeUndefined()
    unsubscribe()
  })

  it('默认关闭；同一系统选择反复粘贴只准备一次，拖入不自动粘贴', async () => {
    const f = fixture()
    expect(f.runtime.interceptPaste()).toBe(false)
    await systemClipboardStore.toggle('test-session', true)
    await f.runtime.prepare(false); await f.runtime.prepare(false)
    expect(f.api.transferClipboard).toHaveBeenCalledTimes(1)
    expect(f.paste).toHaveBeenCalledTimes(2)
    await f.runtime.prepare(true)
    expect(f.paste).toHaveBeenCalledTimes(2)
    expect(systemClipboardStore.get('test-session').notice).toBe('prepared')
    expect(f.bridge.releaseSelection).toHaveBeenCalledTimes(3)
  })

  it('准备期间焦点改变时不延迟粘贴，重复请求不额外准备', async () => {
    const f = fixture()
    let finish!: (task: TransferTask) => void
    vi.mocked(f.api.transferClipboard).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await systemClipboardStore.toggle('test-session', true)
    const pending = f.runtime.prepare(false)
    await Promise.resolve(); await f.runtime.prepare(false)
    f.blur(); finish(completed); await pending
    expect(f.api.transferClipboard).toHaveBeenCalledTimes(1)
    expect(f.paste).not.toHaveBeenCalled()
    expect(systemClipboardStore.get('test-session').notice).toBe('prepared')
  })

  it('准备期间关闭系统功能后不补发粘贴', async () => {
    const f = fixture()
    let finish!: (task: TransferTask) => void
    vi.mocked(f.api.transferClipboard).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await systemClipboardStore.toggle('test-session', true)
    const pending = f.runtime.prepare(false)
    await Promise.resolve()
    await systemClipboardStore.toggle('test-session', false)
    finish(completed); await pending
    expect(f.paste).not.toHaveBeenCalled()
    expect(systemClipboardStore.get('test-session').notice).toBe('prepared')
  })

  it('失去控制后的窗口仍可关闭会话开关，释放注册不改变会话偏好', async () => {
    const f = fixture()
    await systemClipboardStore.toggle('test-session', true)
    f.loseControl(); f.runtime.changed()
    await Promise.resolve(); await Promise.resolve()
    await systemClipboardStore.toggle('test-session', false)
    expect(f.bridge.configure).toHaveBeenCalledWith(context, false, false, 'detach')
    expect(f.bridge.configure).toHaveBeenCalledWith(context, false, false, 'set')
    expect(systemClipboardStore.get('test-session').enabled).toBe(false)
  })

  it('迟到开启结果不会覆盖关闭，旧窗口清理最后执行禁用', async () => {
    const f = fixture()
    let finish!: (value: RemoteResult<SystemFileClipboardState>) => void
    vi.mocked(f.bridge.configure).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const enabling = systemClipboardStore.toggle('test-session', true)
    const disabling = systemClipboardStore.toggle('test-session', false)
    finish(state(true)); await Promise.all([enabling, disabling])
    expect(f.bridge.configure).toHaveBeenLastCalledWith(context, false, true, 'set')
    expect(systemClipboardStore.get('test-session').enabled).toBe(false)
    f.runtime.dispose(); await Promise.resolve(); await Promise.resolve()
    expect(f.bridge.configure).toHaveBeenLastCalledWith(context, false, false, 'detach')
  })

  it('普通文本正常转发；文件失败就地显示并释放选择', async () => {
    const f = fixture()
    await systemClipboardStore.toggle('test-session', true)
    vi.mocked(f.bridge.importClipboard).mockResolvedValueOnce({ ok: true, value: { kind: 'text' } })
    await f.runtime.prepare(false); expect(f.paste).toHaveBeenCalledTimes(1)
    vi.mocked(f.api.transferClipboard).mockRejectedValueOnce(new Error('desktop_file_clipboard_failed'))
    await f.runtime.prepare(false)
    expect(f.paste).toHaveBeenCalledTimes(1)
    expect(systemClipboardStore.get('test-session').error_code).toBe('desktop_file_clipboard_failed')
    expect(f.bridge.releaseSelection).toHaveBeenCalledWith('grant')
  })
})
