import { useEffect, useState } from 'react'

export function useCloudDeadline(deadline?: string) {
  const [now, setNow] = useState(Date.now)
  const timestamp = deadline ? Date.parse(deadline) : undefined
  useEffect(() => {
    if (timestamp === undefined) return
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [timestamp])
  return { expired: timestamp !== undefined && (!Number.isFinite(timestamp) || timestamp <= now), remaining: timestamp === undefined ? 0 : Math.max(0, Math.ceil((timestamp - now) / 1000)) }
}
