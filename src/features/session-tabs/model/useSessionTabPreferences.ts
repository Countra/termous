import { useCallback, useEffect } from 'react'
import { usePersistentJsonState } from '#shared/hooks'
import {
  areSessionTabPreferenceMapsEqual,
  compactSessionTabPreference,
  parseSessionTabPreferences,
  pruneSessionTabPreferences,
  type SessionTabPreference,
  type SessionTabPreferenceMap,
} from './sessionTabPreferences'

export function useSessionTabPreferences(key: string, sessions?: readonly { id: string }[]) {
  const [preferences, setPreferences] = usePersistentJsonState<SessionTabPreferenceMap>(key, {}, parseSessionTabPreferences)
  useEffect(() => {
    if (!sessions) return
    setPreferences((current) => {
      const pruned = pruneSessionTabPreferences(current, sessions.map((session) => session.id))
      return areSessionTabPreferenceMapsEqual(current, pruned) ? current : pruned
    })
  }, [sessions, setPreferences])

  const update = useCallback((id: string, updater: (value: SessionTabPreference) => SessionTabPreference) => {
    setPreferences((current) => {
      const next = { ...current }
      const preference = compactSessionTabPreference(updater(current[id] ?? {}))
      if (preference) next[id] = preference
      else delete next[id]
      return areSessionTabPreferenceMapsEqual(current, next) ? current : next
    })
  }, [setPreferences])

  return { preferences, setPreferences, update }
}
