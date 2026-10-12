import { beforeEach, describe, expect, it, vi } from 'vitest'
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

  it('未接入平台保留原有应用内粘贴', async () => {
    fixture.platform = 'linux'
    expect(await isFileClipboardCurrent(captureFileClipboard())).toBe(true)
    expect(fixture.status).not.toHaveBeenCalled()
  })
})
