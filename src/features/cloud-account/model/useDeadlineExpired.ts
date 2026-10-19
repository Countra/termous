import { useEffect, useReducer } from 'react'
import { cloudDeadlineRemaining } from '#entities/cloud'

// 到期只关闭当前动作；重新读取权威状态由用户明确触发。
export function useDeadlineExpired(value?: { server_time: string }, deadline?: string) {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    if (!deadline) return
    const remaining = cloudDeadlineRemaining(value, deadline)
    if (remaining <= 0) return
    const timer = setTimeout(refresh, remaining + 1)
    return () => clearTimeout(timer)
  }, [value, deadline])
  return Boolean(deadline && cloudDeadlineRemaining(value, deadline) <= 0)
}
