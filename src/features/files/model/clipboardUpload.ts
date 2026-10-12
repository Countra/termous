import type { LocalFileGrant } from '#entities/file'
import { TermousApiError } from '#shared/api'
import { getTermousBridge } from '#shared/bridge'

// 首次导入固定剪贴板序号；冲突确认后重新授权时不能悄悄换成用户后来复制的文件。
export async function readClipboardUpload(session: { id: string; connection_generation?: number }) {
  const bridge = getTermousBridge()
  if (bridge?.platform !== 'win32') {
    const paths = await bridge?.files?.readClipboardFilePaths() ?? []
    return paths.length ? { paths, createGrant: undefined } : null
  }
  const client = bridge.fileSystemClipboard
  if (!client) throw new TermousApiError('系统文件粘贴不可用', 'FILE_CLIPBOARD_UNSUPPORTED', 400)
  const request = { file_session_id: session.id, connection_generation: session.connection_generation ?? 0 }
  const result = await client.importClipboard(request)
  if (!result.ok) throw new TermousApiError('无法读取系统文件选择', result.code, 400)
  if (!result.value.grant) return null
  let first: LocalFileGrant | undefined = result.value.grant
  return {
    paths: [] as string[],
    createGrant: async (): Promise<LocalFileGrant> => {
      if (first) { const grant = first; first = undefined; return grant }
      const refreshed = await client.importClipboard({ ...request, sequence: result.value.sequence })
      if (!refreshed.ok) throw new TermousApiError('系统文件选择已失效', refreshed.code, 400)
      if (!refreshed.value.grant) throw new TermousApiError('系统文件选择已变化', 'FILE_CLIPBOARD_CHANGED', 400)
      return refreshed.value.grant
    },
  }
}
