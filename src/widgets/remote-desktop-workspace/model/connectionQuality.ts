const queuedThreshold = 64 * 1024
const congestedThreshold = 1024 * 1024
export const sshRttStaleAfterMs = 45_000

export type TransportHealth = 'normal' | 'queued' | 'congested'

export function transportHealth(bufferedAmount: number): TransportHealth {
  if (bufferedAmount >= congestedThreshold) {
    return 'congested'
  }
  if (bufferedAmount >= queuedThreshold) {
    return 'queued'
  }
  return 'normal'
}

export function formatBytes(bytes: number) {
  const value = Math.max(0, bytes)
  if (value < 1024) {
    return `${Math.round(value)} B`
  }
  const units = ['KiB', 'MiB', 'GiB', 'TiB']
  let scaled = value / 1024
  let unitIndex = 0
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024
    unitIndex += 1
  }
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[unitIndex]}`
}

export function formatRate(bytesPerSecond: number) {
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatDuration(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

export function formatSshRtt(
  sshRttMs: number | null,
  sampledAt: number,
  now = Date.now(),
) {
  if (
    sshRttMs === null
    || sampledAt <= 0
    || now - sampledAt > sshRttStaleAfterMs
  ) {
    return '--'
  }
  if (sshRttMs < 1) {
    return '<1 ms'
  }
  return `${Math.round(sshRttMs)} ms`
}
