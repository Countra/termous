import { useCallback, useEffect, useRef, useState } from 'react'
import type { IntegrationPolicy, IntegrationSelection } from '#entities/agent-integrations'

export function useIntegrationSelection({ sessionKey, open, read, change, fallbackError }: {
  sessionKey: string
  open: boolean
  read?: () => Promise<IntegrationSelection>
  change?: (policy: IntegrationPolicy) => Promise<void>
  fallbackError: string
}) {
  const [data, setData] = useState<IntegrationSelection>()
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const epoch = useRef(0)
  const mutations = useRef(new Map<string, Promise<void>>())
  const mutationRevision = useRef(0)

  useEffect(() => {
    const currentEpoch = ++epoch.current
    setData(undefined)
    setError('')
    setLoading(Boolean(open && read))
    if (!open || !read) return
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const revision = mutationRevision.current
      try {
        // 弹层的观察生命周期不结束写入；重新打开时先等原保存收敛，再读取实际策略。
        const pending = mutations.current.get(sessionKey)
        if (pending) await pending
        if (!active) return
        const value = await read()
        // 保存期间或保存前发起的轮询不能覆盖刚提交的会话策略。
        if (active && !mutations.current.has(sessionKey) && revision === mutationRevision.current) {
          setData(value)
          setError('')
        }
      } catch (cause) {
        if (active && !mutations.current.has(sessionKey) && revision === mutationRevision.current) {
          setError(cause instanceof Error ? cause.message : fallbackError)
        }
      } finally {
        if (active) {
          setLoading(false)
          timer = setTimeout(() => void refresh(), 2000)
        }
      }
    }
    void refresh()
    return () => {
      active = false
      clearTimeout(timer)
      epoch.current = currentEpoch + 1
    }
  }, [open, sessionKey, read, fallbackError, retry])

  const update = async (policy: IntegrationPolicy) => {
    if (!open || !change || loading || mutations.current.has(sessionKey)) return
    const currentEpoch = epoch.current
    let finish!: () => void
    mutations.current.set(sessionKey, new Promise<void>(resolve => { finish = resolve }))
    mutationRevision.current++
    setPending(current => ({ ...current, [sessionKey]: policy.source_id }))
    setError('')
    try {
      await change(policy)
      if (epoch.current === currentEpoch) {
        setData(current => current && { ...current, policies: [
          ...current.policies.filter(value => value.source_id !== policy.source_id), policy,
        ] })
      }
    } catch (cause) {
      if (epoch.current === currentEpoch) setError(cause instanceof Error ? cause.message : fallbackError)
    } finally {
      mutations.current.delete(sessionKey)
      setPending(current => { const next = { ...current }; delete next[sessionKey]; return next })
      finish()
    }
  }

  return { data, loading, pending: pending[sessionKey] ?? '', error, update,
    retry: useCallback(() => setRetry(value => value + 1), []),
  }
}
