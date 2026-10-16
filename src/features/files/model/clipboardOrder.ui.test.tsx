import { clipboardCapabilitiesFixture } from '../../../test/systemClipboard'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureFileClipboard, isFileClipboardCurrent } from './clipboardOrder'

const fixture = vi.hoisted(() => ({ platform: 'win32', status: vi.fn() }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => ({ platform: fixture.platform, fileSystemClipboard: fixture }) }))

beforeEach(() => { fixture.platform = 'win32'; fixture.status.mockReset() })

describe('粘贴来源顺序', () => {
  it('系统内容未变化时保留明确选择的软件内复制，后来系统复制使旧记录失效', async () => {
    fixture.status.mockResolvedValue({ ok: true, value: { sequence: 10 } })
    const stamp = captureFileClipboard()
    expect(await isFileClipboardCurrent(stamp)).toBe(true)
    fixture.status.mockResolvedValue({ ok: true, value: { sequence: 11 } })
    expect(await isFileClipboardCurrent(stamp)).toBe(false)
    const latest = captureFileClipboard()
    expect(await isFileClipboardCurrent(latest)).toBe(true)
  })

  it('无法确认系统内容时不执行旧的复制或剪切', async () => {
    fixture.status.mockResolvedValue({ ok: false, code: 'FILE_CLIPBOARD_FAILED' })
    await expect(isFileClipboardCurrent(captureFileClipboard())).rejects.toMatchObject({ code: 'FILE_CLIPBOARD_FAILED' })
  })

  it('等待内部复制的状态时断线，丢弃旧异常并保留内部粘贴', async () => {
    let fail!: (error: Error) => void
    fixture.status.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const stamp = captureFileClipboard()
    const pending = isFileClipboardCurrent(stamp)
    capabilities.update({ status: 'disconnected' })
    fail(new Error('连接断开'))
    expect(await pending).toBe(true)
    expect(fixture.status).toHaveBeenCalledOnce()
  })

  it.each([false, true])('粘贴查询期间能力换代时保留内部选择，恢复=%s', async recovered => {
    fixture.status.mockResolvedValueOnce({ ok: true, value: { sequence: 10 } })
    const stamp = captureFileClipboard()
    await stamp
    let finish!: (value: unknown) => void
    fixture.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = isFileClipboardCurrent(stamp)
    await Promise.resolve()
    capabilities.update({ status: 'disconnected' })
    if (recovered) capabilities.update({ status: 'connected' })
    finish({ ok: true, value: { sequence: 11 } })
    expect(await pending).toBe(true)
    expect(fixture.status).toHaveBeenCalledTimes(2)
  })

  it('未接入平台保留原有应用内粘贴', async () => {
    fixture.platform = 'linux'
    capabilities.disconnect()
    capabilities = clipboardCapabilitiesFixture('unsupported', 'unsupported')
    expect(await isFileClipboardCurrent(captureFileClipboard())).toBe(true)
    expect(fixture.status).not.toHaveBeenCalled()
  })
})

let capabilities: ReturnType<typeof clipboardCapabilitiesFixture>
beforeEach(() => { capabilities = clipboardCapabilitiesFixture() })
afterEach(() => capabilities.disconnect())
