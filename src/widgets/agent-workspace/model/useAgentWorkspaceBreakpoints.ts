import { useEffect, useState } from 'react'

const inspectorQuery = '(max-width: 1280px)'
const sessionsQuery = '(max-width: 960px)'

export function useAgentWorkspaceBreakpoints() {
  const [state, setState] = useState(readBreakpoints)

  useEffect(() => {
    const inspector = window.matchMedia(inspectorQuery)
    const sessions = window.matchMedia(sessionsQuery)
    const update = () => setState({
      inspectorOverlay: inspector.matches,
      sessionsOverlay: sessions.matches,
    })
    inspector.addEventListener('change', update)
    sessions.addEventListener('change', update)
    update()
    return () => {
      inspector.removeEventListener('change', update)
      sessions.removeEventListener('change', update)
    }
  }, [])

  return state
}

function readBreakpoints() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return { inspectorOverlay: false, sessionsOverlay: false }
  }
  return {
    inspectorOverlay: window.matchMedia(inspectorQuery).matches,
    sessionsOverlay: window.matchMedia(sessionsQuery).matches,
  }
}
