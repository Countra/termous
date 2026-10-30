import { useEffect, useState } from 'react'
import type { FileReviewLoader, FileReviewPage, FileReviewQuery } from '#shared/file-review'

export function useFileReviewPage(id: string, query: FileReviewQuery, load: FileReviewLoader | undefined) {
  const [state, setState] = useState<{ request: string; load: FileReviewLoader | undefined; page?: FileReviewPage; failed: boolean }>()
  const [attempt, setAttempt] = useState(0)
  const { digest, mode, cursor, context } = query
  const request = JSON.stringify([id, digest, mode, cursor, context, attempt])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      if (!load) throw new Error('FILE_REVIEW_UNAVAILABLE')
      const next = await load({ digest, mode, cursor, context }, controller.signal)
      if (next.review.id !== id || next.review.digest !== digest || next.mode !== mode) throw new Error('FILE_REVIEW_CHANGED')
      if (!controller.signal.aborted) setState({ request, load, page: next, failed: false })
    })().catch(() => { if (!controller.signal.aborted) setState({ request, load, failed: true }) })
    return () => controller.abort()
  }, [id, digest, mode, cursor, context, load, request])
  // 切换页或版本的首帧就隐藏旧内容，不能等 Effect 清理后才纠正视图标签。
  const current = state?.request === request && state.load === load ? state : undefined
  return { page: current?.page, loading: !current, failed: current?.failed ?? false, retry: () => setAttempt(value => value + 1) }
}
