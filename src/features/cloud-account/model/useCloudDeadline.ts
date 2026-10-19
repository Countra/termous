import { useEffect, useState } from 'react'
import { cloudDeadlineRemaining } from '#entities/cloud'

export function useCloudDeadline(value?: { server_time: string }, deadline?: string) {
  const [now, setNow] = useState(performance.now())
  useEffect(() => {
    if (!deadline) return
    const update = () => setNow(performance.now())
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [value, deadline])
  const remaining = cloudDeadlineRemaining(value, deadline, now)
  return { expired: Boolean(deadline && remaining <= 0), remaining: Math.ceil(remaining / 1000) }
}
