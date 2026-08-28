import { useEffect, useState } from 'react'

export function useForwardDurationTick(enabled: boolean) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [enabled])

  return now
}

export function formatForwardDuration(startedAt: string, now: number) {
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) {
    return '--'
  }
  const totalSeconds = Math.max(0, Math.floor((now - start) / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) {
    return `${days}d ${padTime(hours)}:${padTime(minutes)}:${padTime(seconds)}`
  }
  if (hours > 0) {
    return `${hours}:${padTime(minutes)}:${padTime(seconds)}`
  }
  return `${minutes}:${padTime(seconds)}`
}

export function formatForwardDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return [
    `${date.getFullYear()}-${padTime(date.getMonth() + 1)}-${padTime(date.getDate())}`,
    `${padTime(date.getHours())}:${padTime(date.getMinutes())}:${padTime(date.getSeconds())}`,
  ].join(' ')
}

function padTime(value: number) {
  return String(value).padStart(2, '0')
}
