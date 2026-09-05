export function formatAgentMessageTime(value: string, language?: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  return {
    short: new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date),
    full: new Intl.DateTimeFormat(language, { dateStyle: 'full', timeStyle: 'long', hourCycle: 'h23' }).format(date),
  }
}

export function formatAgentMessageDuration(value: number | undefined, language?: string) {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) return undefined
  const unit = (amount: number, name: string) => new Intl.NumberFormat(language, {
    style: 'unit', unit: name, unitDisplay: 'short', maximumFractionDigits: 1,
  }).format(amount)
  if (value < 1000) return unit(value, 'millisecond')
  if (value < 60_000) return unit(value / 1000, 'second')
  const seconds = Math.floor(value / 1000)
  return [
    Math.floor(seconds / 3600) > 0 ? unit(Math.floor(seconds / 3600), 'hour') : undefined,
    Math.floor(seconds / 60) % 60 > 0 ? unit(Math.floor(seconds / 60) % 60, 'minute') : undefined,
    seconds % 60 > 0 ? unit(seconds % 60, 'second') : undefined,
  ].filter(Boolean).join(' ')
}
