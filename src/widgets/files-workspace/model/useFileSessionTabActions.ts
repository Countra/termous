import { useCallback, useMemo, useRef, useState } from 'react'
import type { FileSession, FileSessionConnectInput } from '#entities/file'
import { useSessionTabPreferences } from '#features/session-tabs'

export const fileSessionTabPreferencesKey = 'termous.ui.files.sessionTabPreferences.v1'

export type FileSessionConnectionAction = 'duplicate' | 'restart'

interface Options {
  initialPath: string
  onConnect: (input: FileSessionConnectInput) => Promise<FileSession>
  onRestart: (session: FileSession, initialPath: string) => Promise<FileSession | null>
}

export function useFileSessionTabActions(sessions?: readonly FileSession[]) {
  const { preferences, update } = useSessionTabPreferences(fileSessionTabPreferencesKey, sessions)
  const pendingRef = useRef(new Set<string>())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set())

  const run = useCallback(async (action: FileSessionConnectionAction, session: FileSession, {
    initialPath, onConnect, onRestart,
  }: Options) => {
    if (!session.file_access_profile_id || pendingRef.current.has(session.id)
      || (action === 'restart' && (session.status === 'connecting' || session.status === 'waiting_trust'))) {
      return null
    }
    // 运行时跨页面存活；在关闭前保存外观，切页或旧会话移除后仍能完成继承。
    const preference = preferences[session.id]
    pendingRef.current.add(session.id)
    setPendingIds(new Set(pendingRef.current))
    try {
      if (action === 'restart') {
        const result = await onRestart(session, initialPath)
        if (result && preference) update(result.id, () => preference)
        return result
      }
      // 复制必须创建独立文件连接，不携带会让服务端复用连接的 SSH 来源 ID。
      return await onConnect({
        fileAccessProfileId: session.file_access_profile_id,
        initialPath,
      })
    } finally {
      pendingRef.current.delete(session.id)
      setPendingIds(new Set(pendingRef.current))
    }
  }, [preferences, update])

  return useMemo(() => ({ preferences, update, pendingIds, run }), [preferences, update, pendingIds, run])
}
