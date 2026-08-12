export type CrontabScheduleMode = 'common' | 'custom'

export type CrontabSchedulePreset =
  | 'every_minute'
  | 'hourly'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'reboot'

export interface CrontabScheduleDraft {
  mode: CrontabScheduleMode
  preset: CrontabSchedulePreset
  customExpression: string
  minute: number
  hour: number
  weekday: number
  monthDay: number
}

export const crontabWeekdayOrder = [1, 2, 3, 4, 5, 6, 0] as const

const supportedMacros = new Set([
  '@reboot',
  '@yearly',
  '@annually',
  '@monthly',
  '@weekly',
  '@daily',
  '@midnight',
  '@hourly',
])

export function createCrontabScheduleDraft(expression = '* * * * *'): CrontabScheduleDraft {
  const normalized = expression.trim().replace(/\s+/gu, ' ')
  if (normalized === '@reboot') {
    return commonDraft('reboot')
  }
  if (normalized === '* * * * *') {
    return commonDraft('every_minute')
  }
  const fields = normalized.split(' ')
  if (fields.length === 5) {
    const [minute, hour, monthDay, month, weekday] = fields
    if (isNumberInRange(minute, 0, 59) && hour === '*' && monthDay === '*' && month === '*' && weekday === '*') {
      return { ...commonDraft('hourly'), minute: Number(minute) }
    }
    if (isNumberInRange(minute, 0, 59) && isNumberInRange(hour, 0, 23) && monthDay === '*' && month === '*' && weekday === '*') {
      return { ...commonDraft('daily'), minute: Number(minute), hour: Number(hour) }
    }
    if (isNumberInRange(minute, 0, 59) && isNumberInRange(hour, 0, 23) && monthDay === '*' && month === '*' && isNumberInRange(weekday, 0, 6)) {
      return {
        ...commonDraft('weekly'),
        minute: Number(minute),
        hour: Number(hour),
        weekday: Number(weekday),
      }
    }
    if (isNumberInRange(minute, 0, 59) && isNumberInRange(hour, 0, 23) && isNumberInRange(monthDay, 1, 31) && month === '*' && weekday === '*') {
      return {
        ...commonDraft('monthly'),
        minute: Number(minute),
        hour: Number(hour),
        monthDay: Number(monthDay),
      }
    }
  }
  return {
    ...commonDraft('daily'),
    mode: 'custom',
    customExpression: normalized,
  }
}

export function buildCrontabExpression(draft: CrontabScheduleDraft): string {
  if (draft.mode === 'custom') {
    return draft.customExpression.trim().replace(/\s+/gu, ' ')
  }
  const minute = clampInteger(draft.minute, 0, 59)
  const hour = clampInteger(draft.hour, 0, 23)
  if (draft.preset === 'every_minute') {
    return '* * * * *'
  }
  if (draft.preset === 'hourly') {
    return `${minute} * * * *`
  }
  if (draft.preset === 'daily') {
    return `${minute} ${hour} * * *`
  }
  if (draft.preset === 'weekly') {
    return `${minute} ${hour} * * ${clampInteger(draft.weekday, 0, 6)}`
  }
  if (draft.preset === 'monthly') {
    return `${minute} ${hour} ${clampInteger(draft.monthDay, 1, 31)} * *`
  }
  return '@reboot'
}

export function hasPlausibleCrontabExpression(expression: string) {
  const normalized = expression.trim().replace(/\s+/gu, ' ')
  return normalized.startsWith('@')
    ? supportedMacros.has(normalized.toLocaleLowerCase())
    : normalized.split(' ').length === 5
}

function commonDraft(preset: CrontabSchedulePreset): CrontabScheduleDraft {
  return {
    mode: 'common',
    preset,
    customExpression: '',
    minute: 0,
    hour: 0,
    weekday: 1,
    monthDay: 1,
  }
}

function isNumberInRange(value: string, min: number, max: number) {
  return /^\d+$/u.test(value) && Number(value) >= min && Number(value) <= max
}

function clampInteger(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(max, Math.max(min, Math.trunc(value)))
}
