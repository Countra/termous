import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { readClipboardText } from '#shared/clipboard'
import { createRdpTextClipboard } from './textClipboard'

vi.mock('#shared/clipboard', () => ({ readClipboardText: vi.fn() }))
beforeEach(() => { vi.useFakeTimers(); vi.mocked(readClipboardText).mockReset().mockResolvedValue('中文\ntext 😀') })
afterEach(() => { vi.useRealTimers() })
function fixture() {
  let context: string | undefined = '1', focused = true, epoch = 0
  let sequence = 2n
  const send = vi.fn(() => ({ sequence: ++sequence, controlGeneration: 1n })), paste = vi.fn(), onError = vi.fn()
  const clipboard = createRdpTextClipboard({ context: () => context, focused: () => focused, inputEpoch: () => epoch, send, paste, onError })
  return { clipboard, send, paste, onError, blur: () => { focused = false }, nextInput: () => { epoch++ }, loseControl: () => { context = undefined } }
}

test('只读取一次本机文本，匹配输入回执后才粘贴，不按延迟抢跑', async () => {
  const f = fixture()
  expect(readClipboardText).not.toHaveBeenCalled()
  const pending = f.clipboard.pasteLocal()
  await Promise.resolve()
  expect(f.send).toHaveBeenCalledExactlyOnceWith('中文\ntext 😀')
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.paste).not.toHaveBeenCalled()
  f.clipboard.acknowledge({ sequence: 2n, controlGeneration: 1n })
  f.clipboard.acknowledge({ sequence: 3n, controlGeneration: 2n })
  expect(f.paste).not.toHaveBeenCalled()
  f.clipboard.acknowledge({ sequence: 3n, controlGeneration: 1n })
  await pending
  expect(f.paste).toHaveBeenCalledOnce()
  expect(readClipboardText).toHaveBeenCalledOnce()
  f.clipboard.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

test.each(['blur', 'nextInput', 'loseControl', 'dispose'] as const)('等待确认期间 %s 后不再粘贴', async action => {
  const f = fixture()
  const pending = f.clipboard.pasteLocal()
  await Promise.resolve()
  if (action === 'dispose') f.clipboard.dispose()
  else f[action]()
  f.clipboard.acknowledge({ sequence: 3n, controlGeneration: 1n })
  await pending
  expect(f.paste).not.toHaveBeenCalled()
  f.clipboard.dispose()
})

test('超时不重试，迟到确认不会补发粘贴', async () => {
  const f = fixture()
  const pending = f.clipboard.pasteLocal()
  await vi.advanceTimersByTimeAsync(5000)
  await pending
  f.clipboard.acknowledge({ sequence: 3n, controlGeneration: 1n })
  expect(f.paste).not.toHaveBeenCalled()
  expect(f.send).toHaveBeenCalledOnce()
  expect(f.onError).toHaveBeenLastCalledWith('clipboard_timeout')
  f.clipboard.dispose()
})

test.each(['invalidate', 'timeout'] as const)('%s 后允许用户重新发布，旧成功和失败均不影响新请求', async reason => {
  const f = fixture()
  const first = f.clipboard.pasteLocal()
  await Promise.resolve()
  if (reason === 'invalidate') f.clipboard.invalidate()
  else await vi.advanceTimersByTimeAsync(5000)
  await first
  const settled = vi.fn()
  const next = f.clipboard.publish('new')
  void next.then(settled)
  f.clipboard.acknowledge({ sequence: 3n, controlGeneration: 1n })
  f.clipboard.fail({ sequence: 3n, controlGeneration: 1n })
  f.clipboard.fail({ sequence: 4n, controlGeneration: 2n })
  f.clipboard.fail(undefined)
  await Promise.resolve()
  expect(settled).not.toHaveBeenCalled()
  f.clipboard.acknowledge({ sequence: 4n, controlGeneration: 1n })
  await next
  expect(f.send).toHaveBeenCalledTimes(2)
  expect(f.paste).not.toHaveBeenCalled()
  f.clipboard.dispose()
})

test('读取本机文本期间失效，即使焦点和控制身份不变也不能发布或粘贴', async () => {
  const f = fixture()
  let resolve!: (text: string) => void
  vi.mocked(readClipboardText).mockReturnValueOnce(new Promise<string>(done => { resolve = done }))
  const first = f.clipboard.pasteLocal()
  f.clipboard.invalidate()
  resolve('旧文本')
  await first
  expect(f.send).not.toHaveBeenCalled()
  expect(f.paste).not.toHaveBeenCalled()
  const next = f.clipboard.pasteLocal()
  await Promise.resolve()
  f.clipboard.acknowledge({ sequence: 3n, controlGeneration: 1n })
  await next
  expect(f.paste).toHaveBeenCalledOnce()
  f.clipboard.dispose()
})

test('读取失败和超限均不误粘贴远端旧内容', async () => {
  const f = fixture()
  vi.mocked(readClipboardText).mockRejectedValueOnce(new Error('fixture denied')).mockResolvedValueOnce('中'.repeat(100000))
  await f.clipboard.pasteLocal(); await f.clipboard.pasteLocal()
  expect(f.send).not.toHaveBeenCalled()
  expect(f.paste).not.toHaveBeenCalled()
  expect(f.onError).toHaveBeenLastCalledWith('clipboard_too_large')
  f.clipboard.dispose()
})

test('本机没有文本时保留远端自身粘贴，不用空内容覆盖远端剪贴板', async () => {
  const f = fixture()
  vi.mocked(readClipboardText).mockResolvedValueOnce('')
  await f.clipboard.pasteLocal()
  expect(f.send).not.toHaveBeenCalled()
  expect(f.paste).toHaveBeenCalledOnce()
  f.clipboard.dispose()
})

test('重复快捷键不并行发布，手动发送也等待确认并传播失败', async () => {
  const f = fixture()
  const first = f.clipboard.pasteLocal()
  await f.clipboard.pasteLocal()
  f.clipboard.acknowledge({ sequence: 3n, controlGeneration: 1n })
  await first
  expect(f.send).toHaveBeenCalledOnce()
  const result = expect(f.clipboard.publish('manual')).rejects.toThrow('clipboard_failed')
  f.clipboard.fail({ sequence: 4n, controlGeneration: 1n })
  await result
  f.clipboard.dispose()
})
