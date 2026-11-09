import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentLocalDirectory } from '#entities/agent'

export function useLocalDirectory({ sessionKey, open, read, change, loadError, saveError }: {
  sessionKey: string
  open: boolean
  read?: () => Promise<AgentLocalDirectory>
  change?: (path: string, revision: number) => Promise<AgentLocalDirectory>
  loadError: string
  saveError: string
}) {
  const [directory, setDirectory] = useState<AgentLocalDirectory>()
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const epoch = useRef(0)
  const mutations = useRef(new Map<string, Promise<void>>())

  useEffect(() => {
    const currentEpoch = ++epoch.current
    setDirectory(undefined); setPath(''); setError('')
    setLoading(Boolean(open && read))
    if (!open || !read) return
    const refresh = async () => {
      try {
        // 保存归属会话，关闭弹层仅停止观察；重新打开后查询保存完成后的真实修订。
        const pending = mutations.current.get(sessionKey)
        if (pending) await pending
        if (epoch.current !== currentEpoch) return
        const value = await read()
        if (epoch.current === currentEpoch) { setDirectory(value); setPath(value.path) }
      } catch (cause) {
        if (epoch.current === currentEpoch) setError(cause instanceof Error ? cause.message : loadError)
      } finally {
        if (epoch.current === currentEpoch) setLoading(false)
      }
    }
    void refresh()
    return () => { epoch.current = currentEpoch + 1 }
  }, [open, sessionKey, read, loadError, revision])

  const save = async () => {
    if (!change || !open || !directory || loading || mutations.current.has(sessionKey) || !path.trim() || path.trim() === directory.path) return false
    const currentEpoch = epoch.current
    let finish!: () => void
    mutations.current.set(sessionKey, new Promise<void>(resolve => { finish = resolve }))
    setSaving(new Set(mutations.current.keys()))
    setError('')
    try {
      const value = await change(path.trim(), directory.revision)
      if (epoch.current === currentEpoch) {
        setDirectory(value); setPath(value.path)
        return true
      }
    } catch (cause) {
      if (epoch.current === currentEpoch) setError(cause instanceof Error ? cause.message : saveError)
    } finally {
      mutations.current.delete(sessionKey)
      setSaving(new Set(mutations.current.keys()))
      finish()
    }
    return false
  }

  return { directory, path, setPath, loading, busy: saving.has(sessionKey), error, setError, save,
    refresh: useCallback(() => setRevision(value => value + 1), []),
  }
}
