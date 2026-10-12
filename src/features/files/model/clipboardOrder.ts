import { TermousApiError } from '#shared/api'
import { getTermousBridge } from '#shared/bridge'

export type FileClipboardStamp = Promise<{ sequence?: number; error?: string }>

// 内部复制不改写系统剪贴板，仅记录其变化序号；后台读取失败延迟到粘贴时明确提示。
export async function captureFileClipboard(): FileClipboardStamp {
  const bridge = getTermousBridge()
  if (bridge?.platform !== 'win32') return {}
  const client = bridge.fileSystemClipboard
  if (!client) return {}
  try {
    const result = await client.status()
    if (!result.ok) return { error: result.code }
    if (!result.value.supported && result.value.sequence === undefined) return {}
    return result.value.sequence === undefined ? { error: 'FILE_CLIPBOARD_UNSUPPORTED' } : { sequence: result.value.sequence }
  } catch { return { error: 'FILE_CLIPBOARD_FAILED' } }
}

export async function isFileClipboardCurrent(stamp: FileClipboardStamp): Promise<boolean> {
  const previous = await stamp
  if (previous.error) throw new TermousApiError('无法确认剪贴板来源', previous.error, 400)
  if (previous.sequence === undefined) return true
  const current = await captureFileClipboard()
  if (current.error) throw new TermousApiError('无法确认剪贴板来源', current.error, 400)
  return current.sequence === previous.sequence
}
