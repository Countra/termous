import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopFileBridge, RemoteResult, SystemFileClipboardContext, SystemFileClipboardState } from '#common/contracts'
import type { TransferTask } from '#entities/file'
import type { DesktopFilesGateway } from '../../../api/DesktopFilesClient.ts'
import { systemClipboardStore } from '../../../model/systemClipboardStore.ts'
import { createRdpSystemFiles } from './systemFiles.ts'

const provider = vi.hoisted(() => ({ bridge: undefined as DesktopFileBridge | undefined, independent: false }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => provider.independent ? undefined : ({ desktopFiles: provider.bridge }), getDesktopWindowBridge: () => provider.independent ? ({ desktopFiles: provider.bridge }) : undefined }))
const context: SystemFileClipboardContext = { sessionId: 'session', generation: 1, subscriptionId: 'viewer', controlGeneration: 2 }
const completed = { id: 'task', status: 'completed' } as TransferTask
const state = (enabled: boolean): RemoteResult<SystemFileClipboardState> => ({ ok: true, value: { supported: true, enabled, files: [] } })
const disposers: (() => void)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0)) dispose(); await Promise.resolve(); provider.bridge = undefined; provider.independent = false; vi.useRealTimers(); vi.restoreAllMocks() })
function fixture() {
  let savedEnabled = false
  const bridge: DesktopFileBridge = {
    configure: vi.fn(async () => state(savedEnabled)),
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
  return { runtime, bridge, api, paste, setEnabled: async (value: boolean) => { savedEnabled = value; await runtime.changed() }, blur: () => { focused = false; epoch++ }, loseControl: () => { current = undefined; epoch++ } }
}

describe('本机 RDP 文件快捷键与异步发布', () => {
  it('耗时超过心跳间隔的有效响应仍可启用，不被轮询持续淘汰', async () => {
    vi.useFakeTimers()
    const f = fixture()
    vi.mocked(f.bridge.configure).mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(state(true)), 1500)))
    void f.runtime.changed()
    await vi.advanceTimersByTimeAsync(1600)
    expect(f.runtime.interceptPaste()).toBe(true)
    f.runtime.dispose()
    await vi.advanceTimersByTimeAsync(5000)
  })

  it('关闭全局开关清除旧自动启用错误，但心跳不清除显式发送失败', async () => {
    const f = fixture()
    vi.mocked(f.bridge.configure).mockResolvedValueOnce({ ok: false, code: 'desktop_files_unsupported' })
    await f.runtime.changed()
    await f.setEnabled(false)
    expect(systemClipboardStore.get('test-session').error_code).toBeFalsy()
    await f.setEnabled(true)
    vi.mocked(f.api.transferClipboard).mockRejectedValueOnce(new Error('desktop_file_clipboard_failed'))
    await f.runtime.prepare(false)
    await f.runtime.changed()
    expect(systemClipboardStore.get('test-session').error_code).toBe('desktop_file_clipboard_failed')
  })

  it.each([false, true])('协商未就绪时不误报失败，就绪后自动启用（独立窗口=%s）', async independent => {
    provider.independent = independent
    const f = fixture()
    vi.mocked(f.bridge.configure).mockResolvedValueOnce({ ok: false, code: 'desktop_not_ready' })
    await f.runtime.changed()
    expect(systemClipboardStore.get('test-session').error_code).toBeFalsy()
    expect(systemClipboardStore.get('test-session').supported).toBe(true)
    expect(f.runtime.interceptPaste()).toBe(false)
    await f.setEnabled(true)
    expect(f.runtime.interceptPaste()).toBe(true)
    expect(systemClipboardStore.get('test-session').error_code).toBeFalsy()
  })

  it.each(['desktop_files_unsupported', 'desktop_file_clipboard_failed'])('真实能力失败仍然显示错误：%s', async code => {
    const f = fixture()
    vi.mocked(f.bridge.configure).mockResolvedValueOnce({ ok: false, code })
    await f.runtime.changed()
    expect(f.runtime.interceptPaste()).toBe(false)
    expect(systemClipboardStore.get('test-session').error_code).toBe(code)
    await f.setEnabled(true)
    expect(systemClipboardStore.get('test-session').error_code).toBeFalsy()
    expect(f.runtime.interceptPaste()).toBe(true)
  })

  it.each([false, true])('主窗口与独立窗口都按 Core 设置自动启用（独立窗口=%s）', async independent => {
    provider.independent = independent
    const f = fixture()
    vi.mocked(f.bridge.configure).mockResolvedValue(state(true))
    await f.runtime.changed()
    expect(f.runtime.interceptPaste()).toBe(true)
    expect(f.bridge.configure).toHaveBeenCalledWith(context, true)
    await f.runtime.prepare(false)
    expect(f.paste).toHaveBeenCalledTimes(1)
  })

  it('旧发布撤销后清除清单归属，窗口释放后不残留上一轮任务', async () => {
    const f = fixture()
    vi.mocked(f.bridge.configure).mockResolvedValueOnce({ ok: true, value: { supported: true, enabled: true, publication_id: 'publication', task_id: 'receive', content_generation: 7, files: [] } })
    await f.setEnabled(true)
    expect(systemClipboardStore.get('test-session').task_id).toBe('receive')
    await f.setEnabled(false)
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
    await f.setEnabled(true)
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
    await f.setEnabled(true)
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
    await f.setEnabled(true)
    const pending = f.runtime.prepare(false)
    await Promise.resolve()
    await f.setEnabled(false)
    finish(completed); await pending
    expect(f.paste).not.toHaveBeenCalled()
    expect(systemClipboardStore.get('test-session').notice).toBe('prepared')
  })

  it('失去控制后停止拦截粘贴，解绑不能改写全局设置', async () => {
    const f = fixture()
    await f.setEnabled(true)
    f.loseControl(); f.runtime.changed()
    await Promise.resolve(); await Promise.resolve()
    await f.setEnabled(false)
    expect(f.bridge.configure).toHaveBeenCalledWith(context, false, 'detach')
    expect(vi.mocked(f.bridge.configure).mock.calls.every(call => call[2] === undefined || call[2] === 'detach')).toBe(true)
    expect(systemClipboardStore.get('test-session').enabled).toBe(false)
  })

  it('迟到开启结果不会覆盖新的设置快照，旧窗口清理最后执行解绑', async () => {
    const f = fixture()
    let finish!: (value: RemoteResult<SystemFileClipboardState>) => void
    vi.mocked(f.bridge.configure).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const enabling = f.setEnabled(true)
    const disabling = f.setEnabled(false)
    finish(state(true)); await Promise.all([enabling, disabling])
    expect(f.bridge.configure).toHaveBeenLastCalledWith(context, true)
    expect(systemClipboardStore.get('test-session').enabled).toBe(false)
    f.runtime.dispose(); await Promise.resolve(); await Promise.resolve()
    expect(f.bridge.configure).toHaveBeenLastCalledWith(context, false, 'detach')
  })

  it.each(['desktop_file_clipboard_failed', 'desktop_not_ready'])('普通文本正常转发；显式文件失败就地显示并释放选择：%s', async code => {
    const f = fixture()
    await f.setEnabled(true)
    vi.mocked(f.bridge.importClipboard).mockResolvedValueOnce({ ok: true, value: { kind: 'text' } })
    await f.runtime.prepare(false); expect(f.paste).toHaveBeenCalledTimes(1)
    vi.mocked(f.api.transferClipboard).mockRejectedValueOnce(new Error(code))
    await f.runtime.prepare(false)
    expect(f.paste).toHaveBeenCalledTimes(1)
    expect(systemClipboardStore.get('test-session').error_code).toBe(code)
    expect(f.bridge.releaseSelection).toHaveBeenCalledWith('grant')
  })
})
