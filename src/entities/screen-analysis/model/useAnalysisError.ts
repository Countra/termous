import { useEffect, useRef } from 'react'

export type AnalysisErrorReporter = (error: unknown, retry?: () => void) => void

// 轮询连续失败时只提示一次；恢复后再次失败才形成新的提示。
export function useAnalysisError(error: unknown, report: AnalysisErrorReporter, retry?: () => void) {
  const previous = useRef<{ fingerprint: string } | undefined>(undefined)
  const alive = useRef(true)
  const latest = useRef({ report, retry }); latest.current = { report, retry }
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; previous.current = undefined }
  }, [])
  useEffect(() => {
    if (error == null) { previous.current = undefined; return }
    const value = error as { code?: unknown; status?: unknown; message?: unknown }
    const fingerprint = JSON.stringify([String(value.code ?? ''), String(value.status ?? ''), String(value.message ?? error)])
    if (previous.current?.fingerprint === fingerprint) return
    // 每轮故障独立标识，恢复后再次出现同码错误也不能激活旧重试。
    const failure = { fingerprint }; previous.current = failure
    latest.current.report(error, latest.current.retry ? () => {
      if (alive.current && previous.current === failure) latest.current.retry?.()
    } : undefined)
  }, [error])
}
