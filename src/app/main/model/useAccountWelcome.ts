import { useCallback, useEffect, useState } from 'react'

export const ACCOUNT_WELCOME_KEY = 'termous.ui.accountWelcomeCompleted.v1'

export function useAccountWelcome(authenticated: boolean) {
  const [completed, setCompleted] = useState(() => {
    try { return window.localStorage.getItem(ACCOUNT_WELCOME_KEY) === 'true' }
    catch { return false }
  })
  const complete = useCallback(() => {
    setCompleted(true)
    try { window.localStorage.setItem(ACCOUNT_WELCOME_KEY, 'true') }
    catch { /* 本机偏好不可写时，当前运行仍记住用户选择，不阻断离线使用。 */ }
  }, [])
  useEffect(() => { if (authenticated) complete() }, [authenticated, complete])
  return { pending: !completed && !authenticated, complete }
}
