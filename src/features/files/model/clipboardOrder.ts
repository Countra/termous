import { TermousApiError } from '#shared/api'
import { getTermousBridge } from '#shared/bridge'
import { getSystemClipboardOperation, systemClipboardCapabilities } from '#entities/system-clipboard'

export type FileClipboardStamp = Promise<{ sequence?: number; error?: string }>

// 内部复制不改写系统剪贴板，仅记录其变化序号；后台读取失败延迟到粘贴时明确提示。
export async function captureFileClipboard(): FileClipboardStamp {
  const bridge = getTermousBridge()
  if (!getSystemClipboardOperation('import_files').available) return {}
  const client = bridge?.fileSystemClipboard
  if (!client) return {}
  const connection = systemClipboardCapabilities.get()
  try {
    const result = await client.status()
    // 能力或连接已换代时丢弃旧查询；内部复制仍可独立粘贴。
    if (connection !== systemClipboardCapabilities.get()) return {}
    if (!result.ok) return { error: result.code }
    return result.value.sequence === undefined ? { error: 'FILE_CLIPBOARD_UNSUPPORTED' } : { sequence: result.value.sequence }
  } catch {
    return connection === systemClipboardCapabilities.get() ? { error: 'FILE_CLIPBOARD_FAILED' } : {}
  }
}

export async function isFileClipboardCurrent(stamp: FileClipboardStamp): Promise<boolean> {
  if (!getSystemClipboardOperation('import_files').available) return true
  const previous = await stamp
  if (!getSystemClipboardOperation('import_files').available) return true
  if (previous.error) throw new TermousApiError('无法确认剪贴板来源', previous.error, 400)
  if (previous.sequence === undefined) return true
  const current = await captureFileClipboard()
  if (current.error) throw new TermousApiError('无法确认剪贴板来源', current.error, 400)
  return current.sequence === undefined || current.sequence === previous.sequence
}
