import { Button, Tooltip } from 'antd'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'

interface SessionTabStripProps {
  ariaLabel: string
  activeId?: string | null
  contentKey: string | number
  scrollLeftLabel: string
  scrollRightLabel: string
  className?: string
  tabsClassName?: string
  trailing?: ReactNode
  children: ReactNode
}

interface TabScrollState {
  hasOverflow: boolean
  canScrollLeft: boolean
  canScrollRight: boolean
}

const emptyScrollState: TabScrollState = {
  hasOverflow: false,
  canScrollLeft: false,
  canScrollRight: false,
}

const sessionTabTooltipClassNames = { root: 'termous-tooltip session-tab-tooltip' }

export function SessionTabStrip({
  ariaLabel,
  activeId,
  contentKey,
  scrollLeftLabel,
  scrollRightLabel,
  className,
  tabsClassName,
  trailing,
  children,
}: SessionTabStripProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const scrollStateRef = useRef<TabScrollState>(emptyScrollState)
  const closingButtonWithFocusRef = useRef<HTMLElement | null>(null)
  const navigationButtonWithFocusRef = useRef<HTMLElement | null>(null)
  const shellHorizontalPaddingRef = useRef(0)
  const [scrollState, setScrollState] = useState<TabScrollState>(emptyScrollState)

  const commitScrollState = useCallback((next: TabScrollState) => {
    const focusedElement = document.activeElement
    const focusedScrollDirection = focusedElement instanceof HTMLElement
      ? focusedElement.dataset.sessionTabScrollDirection
      : undefined
    if (
      focusedElement instanceof HTMLElement
      && shellRef.current?.contains(focusedElement)
      && (focusedScrollDirection === 'left' || focusedScrollDirection === 'right')
    ) {
      const isLeftButton = focusedScrollDirection === 'left'
      const buttonWillBecomeUnavailable = !next.hasOverflow
        || (isLeftButton ? !next.canScrollLeft : !next.canScrollRight)
      if (buttonWillBecomeUnavailable) {
        navigationButtonWithFocusRef.current = focusedElement
      }
    }
    scrollStateRef.current = next
    setScrollState((current) => (
      current.hasOverflow === next.hasOverflow
      && current.canScrollLeft === next.canScrollLeft
      && current.canScrollRight === next.canScrollRight
        ? current
        : next
    ))
  }, [])

  const updateScrollState = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      commitScrollState(emptyScrollState)
      return
    }

    const current = scrollStateRef.current
    const shellContentWidth = Math.max(
      0,
      (shellRef.current?.clientWidth ?? 0) - shellHorizontalPaddingRef.current,
    )
    const navigationFootprint = current.hasOverflow
      ? Math.max(0, shellContentWidth - (stageRef.current?.offsetWidth ?? 0))
      : 0
    const fullViewportWidth = viewport.clientWidth + navigationFootprint
    const hasOverflow = viewport.scrollWidth > fullViewportWidth + 1
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    commitScrollState({
      hasOverflow,
      canScrollLeft: hasOverflow && viewport.scrollLeft > 1,
      canScrollRight: hasOverflow && viewport.scrollLeft < maxScrollLeft - 1,
    })
  }, [commitScrollState])

  const scrollTabs = useCallback((direction: 'left' | 'right') => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }
    const distance = Math.max(180, Math.round(viewport.clientWidth * 0.68))
    viewport.scrollBy({ left: direction === 'left' ? -distance : distance, behavior: 'smooth' })
  }, [])

  const handleWheel = useCallback((event: globalThis.WheelEvent) => {
    const viewport = viewportRef.current
    if (!viewport || !scrollStateRef.current.hasOverflow) {
      return
    }

    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
    if (rawDelta === 0) {
      return
    }
    const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1
    const maxScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    const nextScrollLeft = Math.min(maxScrollLeft, Math.max(0, viewport.scrollLeft + rawDelta * deltaScale))
    if (Math.abs(nextScrollLeft - viewport.scrollLeft) < 1) {
      return
    }

    event.preventDefault()
    viewport.scrollLeft = nextScrollLeft
    updateScrollState()
  }, [updateScrollState])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return
    }
    const viewport = viewportRef.current
    const eventTarget = event.target
    if (!viewport || !(eventTarget instanceof Element)) {
      return
    }
    const currentTab = eventTarget.closest<HTMLElement>('[role="tab"]')
    if (!currentTab) {
      return
    }
    const tabs = Array.from(viewport.querySelectorAll<HTMLElement>('[role="tab"]'))
    const currentIndex = tabs.indexOf(currentTab)
    if (currentIndex < 0 || tabs.length === 0) {
      return
    }

    const isAvailable = (tab: HTMLElement) => (
      tab.getAttribute('aria-disabled') !== 'true' && !tab.hasAttribute('disabled')
    )
    let nextTab: HTMLElement | undefined
    if (event.key === 'Home') {
      nextTab = tabs.find(isAvailable)
    } else if (event.key === 'End') {
      for (let index = tabs.length - 1; index >= 0; index -= 1) {
        const candidate = tabs[index]
        if (candidate && isAvailable(candidate)) {
          nextTab = candidate
          break
        }
      }
    } else {
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      for (let offset = 1; offset <= tabs.length; offset += 1) {
        const candidate = tabs[(currentIndex + direction * offset + tabs.length) % tabs.length]
        if (candidate && isAvailable(candidate)) {
          nextTab = candidate
          break
        }
      }
    }
    if (!nextTab) {
      return
    }

    event.preventDefault()
    nextTab.focus()
    nextTab.click()
  }, [])

  const handleClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target
    if (!(target instanceof Element)) {
      return
    }
    const closeButton = target.closest<HTMLElement>('[data-session-tab-close]')
    closingButtonWithFocusRef.current = closeButton && document.activeElement === closeButton ? closeButton : null
  }, [])

  const findActiveTab = useCallback(() => {
    const track = trackRef.current
    if (!track || !activeId) {
      return null
    }
    return Array.from(track.querySelectorAll<HTMLElement>('[data-session-tab-id]'))
      .find((tab) => tab.dataset.sessionTabId === activeId) ?? null
  }, [activeId])

  const revealActiveTab = useCallback(() => {
    const viewport = viewportRef.current
    const activeTab = findActiveTab()
    if (!viewport || !activeTab) {
      return
    }

    const viewportRect = viewport.getBoundingClientRect()
    const tabElement = activeTab.closest<HTMLElement>('[data-session-tab-root]') ?? activeTab
    const tabRect = tabElement.getBoundingClientRect()
    const edgePadding = 8
    let nextScrollLeft = viewport.scrollLeft
    if (tabRect.left < viewportRect.left + edgePadding) {
      nextScrollLeft -= viewportRect.left + edgePadding - tabRect.left
    } else if (tabRect.right > viewportRect.right - edgePadding) {
      nextScrollLeft += tabRect.right - (viewportRect.right - edgePadding)
    } else {
      return
    }
    viewport.scrollTo({ left: Math.max(0, nextScrollLeft), behavior: 'smooth' })
  }, [findActiveTab])

  useEffect(() => {
    const viewport = viewportRef.current
    const track = trackRef.current
    if (!viewport || !track) {
      return undefined
    }

    let resizeFrame = 0
    const syncLayout = () => {
      const shell = shellRef.current
      if (shell) {
        const shellStyle = window.getComputedStyle(shell)
        shellHorizontalPaddingRef.current = (Number.parseFloat(shellStyle.paddingLeft) || 0)
          + (Number.parseFloat(shellStyle.paddingRight) || 0)
      }
      updateScrollState()
      window.cancelAnimationFrame(resizeFrame)
      resizeFrame = window.requestAnimationFrame(() => {
        updateScrollState()
        revealActiveTab()
      })
    }
    const observer = new ResizeObserver(syncLayout)
    observer.observe(viewport)
    observer.observe(track)
    viewport.addEventListener('scroll', updateScrollState, { passive: true })
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    syncLayout()
    return () => {
      window.cancelAnimationFrame(resizeFrame)
      observer.disconnect()
      viewport.removeEventListener('scroll', updateScrollState)
      viewport.removeEventListener('wheel', handleWheel)
    }
  }, [handleWheel, revealActiveTab, updateScrollState])

  useEffect(() => {
    updateScrollState()
    const frame = window.requestAnimationFrame(updateScrollState)
    return () => window.cancelAnimationFrame(frame)
  }, [contentKey, updateScrollState])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeTab = findActiveTab()
      const closingButton = closingButtonWithFocusRef.current
      const currentFocus = document.activeElement
      const shouldRestoreFocus = Boolean(
        closingButton
        && !closingButton.isConnected
        && (!currentFocus || currentFocus === document.body),
      )
      if (shouldRestoreFocus && activeTab) {
        activeTab.focus()
      }
      if (!closingButton?.isConnected || (currentFocus && currentFocus !== closingButton)) {
        closingButtonWithFocusRef.current = null
      }
      revealActiveTab()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [contentKey, findActiveTab, revealActiveTab])

  useEffect(() => {
    const navigationButton = navigationButtonWithFocusRef.current
    if (!navigationButton) {
      return undefined
    }

    const frame = window.requestAnimationFrame(() => {
      const currentFocus = document.activeElement
      const focusStillBelongsToNavigation = currentFocus === navigationButton
      const focusWasDropped = !currentFocus || currentFocus === document.body
      const tabs = Array.from(trackRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])
        .filter((tab) => tab.getAttribute('aria-disabled') !== 'true' && !tab.hasAttribute('disabled'))
      const boundaryTab = scrollState.hasOverflow
        ? navigationButton.dataset.sessionTabScrollDirection === 'left'
          ? tabs[0]
          : tabs[tabs.length - 1]
        : null
      const focusTarget = boundaryTab ?? findActiveTab()
      if ((focusStillBelongsToNavigation || focusWasDropped) && focusTarget) {
        focusTarget.focus({ preventScroll: true })
      }
      navigationButtonWithFocusRef.current = null
    })
    return () => window.cancelAnimationFrame(frame)
  }, [findActiveTab, scrollState])

  const classes = [
    'session-tabs-shell',
    trailing ? 'has-trailing' : '',
    scrollState.hasOverflow ? 'has-overflow' : '',
    className,
  ].filter(Boolean).join(' ')
  const tabsClasses = [
    'session-tabs',
    scrollState.canScrollLeft ? 'has-left-overflow' : '',
    scrollState.canScrollRight ? 'has-right-overflow' : '',
    tabsClassName,
  ].filter(Boolean).join(' ')

  return (
    <div ref={shellRef} className={classes}>
      {scrollState.hasOverflow ? (
        <Tooltip
          title={scrollState.canScrollLeft ? scrollLeftLabel : undefined}
          placement="bottom"
          arrow={false}
          mouseEnterDelay={0.35}
          mouseLeaveDelay={0}
          classNames={sessionTabTooltipClassNames}
          destroyOnHidden
        >
          <Button
            type="text"
            className="session-scroll-button is-left"
            data-session-tab-scroll-direction="left"
            aria-label={scrollLeftLabel}
            disabled={!scrollState.canScrollLeft}
            tabIndex={scrollState.canScrollLeft ? 0 : -1}
            icon={<ChevronLeft size={15} strokeWidth={2.2} />}
            onClick={() => scrollTabs('left')}
          />
        </Tooltip>
      ) : null}
      <div ref={stageRef} className="session-tabs-stage">
        <div
          ref={viewportRef}
          className={tabsClasses}
          onKeyDown={handleKeyDown}
          onClickCapture={handleClickCapture}
        >
          <div ref={trackRef} className="session-tabs-track" role="tablist" aria-label={ariaLabel}>
            {children}
          </div>
        </div>
        {trailing ? <div className="session-tabs-trailing">{trailing}</div> : null}
      </div>
      {scrollState.hasOverflow ? (
        <Tooltip
          title={scrollState.canScrollRight ? scrollRightLabel : undefined}
          placement="bottom"
          arrow={false}
          mouseEnterDelay={0.35}
          mouseLeaveDelay={0}
          classNames={sessionTabTooltipClassNames}
          destroyOnHidden
        >
          <Button
            type="text"
            className="session-scroll-button is-right"
            data-session-tab-scroll-direction="right"
            aria-label={scrollRightLabel}
            disabled={!scrollState.canScrollRight}
            tabIndex={scrollState.canScrollRight ? 0 : -1}
            icon={<ChevronRight size={15} strokeWidth={2.2} />}
            onClick={() => scrollTabs('right')}
          />
        </Tooltip>
      ) : null}
    </div>
  )
}
