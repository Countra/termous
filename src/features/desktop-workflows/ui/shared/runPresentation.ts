export function runTone(state: string) {
  if (['completed', 'accepted', 'assertion_passed'].includes(state)) return 'success'
  if (['failed', 'timed_out', 'interrupted'].includes(state)) return 'error'
  if (['paused', 'uncertain'].includes(state)) return 'warning'
  if (['preparing', 'running', 'dispatching'].includes(state)) return 'active'
  return 'neutral'
}

export function runTime(value?: string) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : '—'
}

export function runDuration(start: string, finish?: string) {
  const milliseconds = finish ? Date.parse(finish) - Date.parse(start) : NaN
  if (!Number.isFinite(milliseconds)) return '—'
  const duration = Math.max(0, milliseconds)
  if (duration < 1000) return `${duration} ms`
  if (duration < 60000) return `${Number((duration / 1000).toFixed(1))} s`
  return `${Math.floor(duration / 60000)} m ${Math.floor(duration % 60000 / 1000)} s`
}
