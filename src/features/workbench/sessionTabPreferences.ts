import type { Session } from '../../types/domain'

export interface SessionTabPreference {
  title?: string
  pinned?: boolean
  pinnedAt?: number
  color?: string
}

export type SessionTabPreferenceMap = Record<string, SessionTabPreference>

export const sessionTabColorPresets = [
  '#e11d48',
  '#f97316',
  '#f59e0b',
  '#84cc16',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#d946ef',
  '#64748b',
]

export function parseSessionTabPreferences(value: unknown): SessionTabPreferenceMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const next: SessionTabPreferenceMap = {}
  for (const [sessionId, preference] of Object.entries(value)) {
    if (!sessionId || !preference || typeof preference !== 'object' || Array.isArray(preference)) {
      continue
    }
    const normalized = normalizeSessionTabPreference(preference as Record<string, unknown>)
    if (normalized) {
      next[sessionId] = normalized
    }
  }
  return next
}

export function normalizeSessionTabTitle(value: string) {
  return value.trim().slice(0, 80)
}

export function normalizeSessionTabColor(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }
  const color = value.trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : undefined
}

export function pruneSessionTabPreferences(preferences: SessionTabPreferenceMap, sessionIds: string[]) {
  const allowed = new Set(sessionIds)
  const next: SessionTabPreferenceMap = {}
  for (const [sessionId, preference] of Object.entries(preferences)) {
    if (allowed.has(sessionId)) {
      next[sessionId] = preference
    }
  }
  return next
}

export function compactSessionTabPreference(preference: SessionTabPreference) {
  const next: SessionTabPreference = {}
  const title = typeof preference.title === 'string' ? normalizeSessionTabTitle(preference.title) : ''
  if (title) {
    next.title = title
  }
  const color = normalizeSessionTabColor(preference.color)
  if (color) {
    next.color = color
  }
  if (preference.pinned) {
    next.pinned = true
    next.pinnedAt = typeof preference.pinnedAt === 'number' && Number.isFinite(preference.pinnedAt)
      ? preference.pinnedAt
      : Date.now()
  }
  return Object.keys(next).length > 0 ? next : null
}

export function areSessionTabPreferenceMapsEqual(left: SessionTabPreferenceMap, right: SessionTabPreferenceMap) {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  if (leftKeys.length !== rightKeys.length) {
    return false
  }
  return leftKeys.every((key) => {
    const leftValue = left[key]
    const rightValue = right[key]
    return Boolean(rightValue) &&
      leftValue.title === rightValue.title &&
      leftValue.color === rightValue.color &&
      leftValue.pinned === rightValue.pinned &&
      leftValue.pinnedAt === rightValue.pinnedAt
  })
}

export function sortSessionsForTabs(sessions: Session[], preferences: SessionTabPreferenceMap) {
  const sessionOrder = new Map(sessions.map((session, index) => [session.id, index]))
  return [...sessions].sort((left, right) => {
    const leftPreference = preferences[left.id]
    const rightPreference = preferences[right.id]
    const leftPinned = Boolean(leftPreference?.pinned)
    const rightPinned = Boolean(rightPreference?.pinned)
    if (leftPinned !== rightPinned) {
      return leftPinned ? -1 : 1
    }
    if (leftPinned && rightPinned) {
      return (rightPreference?.pinnedAt ?? 0) - (leftPreference?.pinnedAt ?? 0)
    }
    return (sessionOrder.get(left.id) ?? 0) - (sessionOrder.get(right.id) ?? 0)
  })
}

function normalizeSessionTabPreference(value: Record<string, unknown>) {
  const preference: SessionTabPreference = {}
  if (typeof value.title === 'string') {
    const title = normalizeSessionTabTitle(value.title)
    if (title) {
      preference.title = title
    }
  }
  const color = normalizeSessionTabColor(value.color)
  if (color) {
    preference.color = color
  }
  if (value.pinned === true) {
    preference.pinned = true
    preference.pinnedAt = typeof value.pinnedAt === 'number' && Number.isFinite(value.pinnedAt)
      ? value.pinnedAt
      : 0
  }
  return Object.keys(preference).length > 0 ? preference : null
}
