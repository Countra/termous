import { useEffect, useReducer } from 'react'

// 到期只关闭当前动作；重新读取权威状态由用户明确触发。
export function useDeadlineExpired(deadline?: string) {
  const [, refresh] = useReducer((value: number) => value + 1, 0)
  useEffect(() => {
    if (!deadline) return
    const remaining = Date.parse(deadline) - Date.now()
    if (remaining <= 0) return
    const timer = setTimeout(refresh, remaining + 1)
    return () => clearTimeout(timer)
  }, [deadline])
  return Boolean(deadline && Date.parse(deadline) <= Date.now())
}
