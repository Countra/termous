import { useCallback, useEffect, useRef, useState } from 'react'

// 页面不可见时停止网络读取；恢复可见后补读。取消读取不会取消后台分析。
export function useVisibleQuery<T>(key: string, load: (signal: AbortSignal) => Promise<T>, active = true, poll?: (value: T) => boolean) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState<unknown>()
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const latest = useRef({ load, poll }); latest.current = { load, poll }
  const reload = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    // 同一查询刷新时保留已确认内容，避免布局塌缩和明细展开状态丢失；切换目标或停用时才清空。
    setData(undefined)
  }, [key, active])
  useEffect(() => {
    setError(undefined); setLoading(false)
    if (!active) return
    let stopped = false
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      if (stopped || document.visibilityState === 'hidden') return
      controller?.abort()
      const current = new AbortController(); controller = current
      setLoading(true)
      try {
        const value = await latest.current.load(current.signal)
        if (current.signal.aborted || stopped) return
        setData(value); setError(undefined)
        if (latest.current.poll?.(value)) timer = setTimeout(() => void read(), 1000)
      } catch (reason) {
        if (!stopped && !current.signal.aborted) {
          setError(reason)
          // 活跃任务的短暂网络故障不终止观察；历史明细仍由用户显式重试。
          if (latest.current.poll) timer = setTimeout(() => void read(), 1000)
        }
      }
      finally { if (!stopped && !current.signal.aborted) setLoading(false) }
    }
    const visibility = () => { clearTimeout(timer); controller?.abort(); setLoading(false); if (document.visibilityState !== 'hidden') void read() }
    document.addEventListener('visibilitychange', visibility)
    void read()
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); document.removeEventListener('visibilitychange', visibility) }
  }, [key, active, revision])
  return { data, error, loading, reload }
}

export const analysisTerminal = (state: string) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(state)
export function saveAnalysisDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
    document.body.append(anchor); anchor.click(); anchor.remove()
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
