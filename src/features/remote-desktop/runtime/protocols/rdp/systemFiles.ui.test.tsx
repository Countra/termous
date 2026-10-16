import { clipboardCapabilitiesFixture } from '../../../../../test/systemClipboard'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopFileBridge, RemoteResult, SystemFileClipboardContext, SystemFileClipboardState } from '#common/contracts'
import type { TransferTask } from '#entities/file'
import type { DesktopFilesGateway } from '../../../api/DesktopFilesClient.ts'
import { systemClipboardStore } from '../../../model/systemClipboardStore.ts'
import { createRdpSystemFiles } from './systemFiles.ts'

const provider = vi.hoisted(() => ({ bridge: undefined as DesktopFileBridge | undefined }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ desktopFiles: provider.bridge }) }))
const context: SystemFileClipboardContext = { sessionId: 'session', generation: 1, subscriptionId: 'viewer', controlGeneration: 2 }
const completed = { id: 'task', status: 'completed' } as TransferTask
const state = (enabled: boolean): RemoteResult<SystemFileClipboardState> => ({ ok: true, value: { supported: true, enabled, import_enabled: enabled, publish_enabled: enabled, files: [] } })
const disposers: (() => void)[] = []
afterEach(async () => { for (const dispose of disposers.splice(0)) dispose(); await Promise.resolve(); provider.bridge = undefined; vi.useRealTimers(); vi.restoreAllMocks() })
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
  it.each(['import_files', 'publish_files'] as const)('只支持 %s 时不被另一方向阻断', async direction => {
    capabilities.disconnect()
    capabilities = clipboardCapabilitiesFixture(direction === 'import_files' ? 'ready' : 'unsupported', direction === 'publish_files' ? 'ready' : 'unsupported')
    const f = fixture()
    await f.setEnabled(true)
    expect(f.runtime.interceptPaste()).toBe(direction === 'import_files')
    expect(systemClipboardStore.get('test-session').publish_enabled).toBe(direction === 'publish_files')
    await f.runtime.prepare(false)
    expect(f.bridge.importClipboard).toHaveBeenCalledTimes(direction === 'import_files' ? 1 : 0)
  })

  it('未适配平台停止系统轮询与导入，拖放仍可准备文件', async () => {
    vi.useFakeTimers()
    capabilities.disconnect()
    capabilities = clipboardCapabilitiesFixture('unsupported', 'unsupported')
    const f = fixture()
    await f.runtime.changed()
    await vi.advanceTimersByTimeAsync(3000)
    await f.runtime.prepare(false)
    expect(f.bridge.configure).not.toHaveBeenCalled()
    expect(f.bridge.importClipboard).not.toHaveBeenCalled()
    await f.runtime.prepare(true)
    expect(f.bridge.consumeDrop).toHaveBeenCalledOnce()
  })

  it('已知支持断线后立即停止拦截与轮询，恢复后重新同步', async () => {
    vi.useFakeTimers()
    const f = fixture()
    await f.setEnabled(true)
    capabilities.update({ status: 'disconnected', reason: 'service_unavailable' })
    expect(f.runtime.interceptPaste()).toBe(false)
    await Promise.resolve(); await Promise.resolve()
    const calls = vi.mocked(f.bridge.configure).mock.calls.length
    await vi.advanceTimersByTimeAsync(3000)
    expect(f.bridge.configure).toHaveBeenCalledTimes(calls)
    capabilities.update({ status: 'connected', reason: undefined })
    await f.runtime.changed()
    expect(f.runtime.interceptPaste()).toBe(true)
  })
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

  it('能力断线立即禁用，迟到的配置异常不能重新写入错误状态', async () => {
    const f = fixture()
    await f.setEnabled(true)
    let reject!: (error: Error) => void
    vi.mocked(f.bridge.configure).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
    const pending = f.runtime.changed()
    capabilities.update({ status: 'disconnected' })
    expect(systemClipboardStore.get('test-session').enabled).toBe(false)
    reject(new Error('旧配置请求失败'))
    await pending
    expect(systemClipboardStore.get('test-session').error_code).toBeFalsy()
    expect(f.runtime.interceptPaste()).toBe(false)
    capabilities.update({ status: 'connected' })
    await f.runtime.changed()
    expect(f.runtime.interceptPaste()).toBe(true)
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

  it('协商未就绪时不误报失败，就绪后自动启用', async () => {
    const f = fixture()
    vi.mocked(f.bridge.configure).mockResolvedValueOnce({ ok: false, code: 'desktop_not_ready' })
    await f.runtime.changed()
    expect(systemClipboardStore.get('test-session').error_code).toBeFalsy()
    expect(systemClipboardStore.get('test-session').enabled).toBe(false)
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

  it('主窗口按 Core 设置自动启用', async () => {
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
    await f.runtime.changed()
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

let capabilities: ReturnType<typeof clipboardCapabilitiesFixture>
beforeEach(() => { capabilities = clipboardCapabilitiesFixture() })
afterEach(() => capabilities.disconnect())
