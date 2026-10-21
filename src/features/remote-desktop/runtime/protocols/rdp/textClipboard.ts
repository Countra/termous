import { readClipboardText } from '#shared/clipboard'
import type { DesktopClipboardError } from '../../core/viewerContracts.ts'

type Receipt = { sequence: bigint; controlGeneration: bigint }

function clipboardError(error: unknown): DesktopClipboardError {
  const code = error instanceof Error ? error.message : ''
  return ['clipboard_too_large', 'clipboard_unavailable', 'clipboard_timeout'].includes(code) ? code as DesktopClipboardError : 'clipboard_failed'
}

export function createRdpTextClipboard(options: {
  context: () => string | undefined; focused: () => boolean; inputEpoch: () => number
  send: (text: string) => Receipt | undefined; paste: () => void
  onError: (code: DesktopClipboardError | '') => void
}) {
  let disposed = false, pasting = false
  let revision = 0
  let pending: (Receipt & { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }) | undefined
  const matches = (receipt: Receipt | undefined) => receipt !== undefined && pending?.sequence === receipt.sequence && pending.controlGeneration === receipt.controlGeneration
  function finish(error?: Error) {
    if (!pending) return
    const current = pending
    pending = undefined
    clearTimeout(current.timer)
    if (error) current.reject(error)
    else current.resolve()
  }
  function publish(text: string): Promise<void> {
    if (disposed || !options.context()) return Promise.reject(new Error('clipboard_unavailable'))
    if (pending) return Promise.reject(new Error('clipboard_failed'))
    if (new TextEncoder().encode(text).length > 256 * 1024) return Promise.reject(new Error('clipboard_too_large'))
    options.onError('')
    const receipt = options.send(text)
    if (!receipt) return Promise.reject(new Error('clipboard_unavailable'))
    return new Promise<void>((resolve, reject) => {
      // 成功与失败均按输入标识关联；超时后允许用户重新操作，迟到结果不能结束新请求。
      pending = { ...receipt, resolve, reject, timer: setTimeout(() => finish(new Error('clipboard_timeout')), 5000) }
    })
  }
  async function pasteLocal(stillCurrent: () => boolean = () => true) {
    if (disposed || pasting || pending) return
    const context = options.context(), epoch = options.inputEpoch(), current = revision
    const valid = () => !disposed && current === revision && context !== undefined && context === options.context() && options.focused() && epoch === options.inputEpoch() && stillCurrent()
    if (!valid()) {
      if (!disposed && options.focused()) options.onError('clipboard_unavailable')
      return
    }
    pasting = true
    options.onError('')
    try {
      // 仅响应用户的粘贴动作读取一次，不监听或轮询本机文本剪贴板。
      const text = await readClipboardText()
      if (!valid()) return
      // 本机没有文本时保留远端自身复制、粘贴的按键语义，不清空远端剪贴板。
      if (!text) { options.paste(); return }
      await publish(text)
      if (valid()) options.paste()
    } catch (error) {
      if (valid()) options.onError(clipboardError(error))
    } finally { pasting = false }
  }
  return {
    publish, pasteLocal,
    acknowledge(receipt: Receipt) {
      if (matches(receipt)) finish()
    },
    invalidate() { revision++; finish(new Error('clipboard_unavailable')) },
    fail(receipt: Receipt | undefined, code: DesktopClipboardError = 'clipboard_failed') { if (matches(receipt)) finish(new Error(code)) },
    dispose() { disposed = true; finish(new Error('clipboard_unavailable')) },
  }
}
