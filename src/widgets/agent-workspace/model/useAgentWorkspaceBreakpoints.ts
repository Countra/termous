import { useLayoutEffect, useState, type RefObject } from 'react'

const inspectorWidth = 1_040
const sessionsWidth = 720
const inspectorViewportFallback = '(max-width: 1280px)'
const sessionsViewportFallback = '(max-width: 960px)'

export function useAgentWorkspaceBreakpoints(containerRef: RefObject<HTMLElement | null>) {
  const [state, setState] = useState(readViewportBreakpoints)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = (measuredWidth = container.getBoundingClientRect().width || container.clientWidth) => {
      const next = measuredWidth > 0 ? breakpointsForWidth(measuredWidth) : readViewportBreakpoints()
      setState((current) => (
        current.inspectorOverlay === next.inspectorOverlay
        && current.sessionsOverlay === next.sessionsOverlay
          ? current
          : next
      ))
    }
    update()
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0]
        update(entry?.contentRect.width)
      })
      observer.observe(container)
      return () => observer.disconnect()
    }
    const updateFromWindow = () => update()
    window.addEventListener('resize', updateFromWindow)
    return () => window.removeEventListener('resize', updateFromWindow)
  }, [containerRef])

  return state
}

function readViewportBreakpoints() {
  if (typeof window === 'undefined') {
    return { inspectorOverlay: false, sessionsOverlay: false }
  }
  if (typeof window.matchMedia === 'function') {
    return {
      inspectorOverlay: window.matchMedia(inspectorViewportFallback).matches,
      sessionsOverlay: window.matchMedia(sessionsViewportFallback).matches,
    }
  }
  return breakpointsForWidth(Math.max(0, window.innerWidth - 280))
}

function breakpointsForWidth(width: number) {
  return {
    inspectorOverlay: width <= inspectorWidth,
    sessionsOverlay: width <= sessionsWidth,
  }
}
