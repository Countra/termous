import { useCallback, useEffect, useRef, useState } from 'react'

const toolbarHideDelayMs = 1800

export function useRemoteDesktopFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [toolbarPinned, setToolbarPinned] = useState(false)
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const requestedRef = useRef(false)
  const fullscreenRef = useRef(false)
  const transitioningRef = useRef(false)
  const pinnedRef = useRef(false)
  const hideTimerRef = useRef<number | undefined>(undefined)

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current !== undefined) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = undefined
    }
  }, [])

  const scheduleHide = useCallback(() => {
    clearHideTimer()
    if (!fullscreenRef.current || pinnedRef.current) {
      return
    }
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = undefined
      if (fullscreenRef.current && !pinnedRef.current) {
        setToolbarVisible(false)
      }
    }, toolbarHideDelayMs)
  }, [clearHideTimer])

  const revealToolbar = useCallback(() => {
    clearHideTimer()
    setToolbarVisible(true)
  }, [clearHideTimer])

  const releaseToolbar = useCallback(() => {
    scheduleHide()
  }, [scheduleHide])

  const toggleToolbarPinned = useCallback(() => {
    setToolbarPinned((current) => {
      const next = !current
      pinnedRef.current = next
      setToolbarVisible(true)
      if (next) {
        clearHideTimer()
      } else {
        scheduleHide()
      }
      return next
    })
  }, [clearHideTimer, scheduleHide])

  const toggleFullscreen = useCallback(async () => {
    if (transitioningRef.current) {
      return
    }
    transitioningRef.current = true
    try {
      if (fullscreenRef.current) {
        await document.exitFullscreen()
        return
      }
      if (document.fullscreenElement) {
        throw new Error('FULLSCREEN_ALREADY_ACTIVE')
      }
      requestedRef.current = true
      await document.documentElement.requestFullscreen()
    } catch (error) {
      if (!fullscreenRef.current) {
        requestedRef.current = false
      }
      throw error
    } finally {
      transitioningRef.current = false
    }
  }, [])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = requestedRef.current && document.fullscreenElement === document.documentElement
      fullscreenRef.current = active
      setIsFullscreen(active)
      if (active) {
        setToolbarVisible(true)
        scheduleHide()
        return
      }
      requestedRef.current = false
      pinnedRef.current = false
      setToolbarPinned(false)
      setToolbarVisible(true)
      clearHideTimer()
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      clearHideTimer()
      if (requestedRef.current && document.fullscreenElement === document.documentElement) {
        void document.exitFullscreen().catch(() => undefined)
      }
      requestedRef.current = false
      fullscreenRef.current = false
      transitioningRef.current = false
    }
  }, [clearHideTimer, scheduleHide])

  return {
    isFullscreen,
    toolbarPinned,
    toolbarVisible,
    toggleFullscreen,
    toggleToolbarPinned,
    revealToolbar,
    releaseToolbar,
  }
}
