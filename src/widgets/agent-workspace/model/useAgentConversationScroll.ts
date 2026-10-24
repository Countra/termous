import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent, type KeyboardEvent, type WheelEvent, type TouchEvent, type PointerEvent } from 'react'
import type { AgentWorkspacePresentation } from './types.ts'

export function useAgentConversationScroll({ active, sessionKey, presentation, content }: {
  active: boolean; sessionKey: string; presentation?: AgentWorkspacePresentation; content: unknown
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const following = useRef(presentation?.conversations?.[sessionKey]?.follow ?? true)
  const frame = useRef<number | undefined>(undefined)
  const lastTop = useRef(0)
  const touchY = useRef<number | undefined>(undefined)
  const pendingAnchor = useRef<{ id: string; offset: number } | undefined>(undefined)
  const pendingRestore = useRef<{ top: number; anchor?: string; offset?: number } | undefined>(undefined)
  const [showJumpToLatest, setShowJumpToLatest] = useState(!following.current)

  const cancelFrame = useCallback(() => {
    if (frame.current !== undefined) window.cancelAnimationFrame(frame.current)
    frame.current = undefined
  }, [])
  const pause = useCallback(() => {
    pendingRestore.current = undefined
    following.current = false
    cancelFrame()
    setShowJumpToLatest(true)
  }, [cancelFrame])
  const scrollToEnd = useCallback(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    // 先记录程序滚动终点，后续 scroll 事件不能将布局调整误判为用户上滚。
    lastTop.current = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    if (typeof viewport.scrollTo === 'function') viewport.scrollTo({ top: viewport.scrollHeight })
    else viewport.scrollTop = viewport.scrollHeight
    setShowJumpToLatest(false)
  }, [])
  const restorePosition = useCallback(() => {
    const viewport = viewportRef.current
    const saved = pendingRestore.current
    if (!viewport || !saved) return
    const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-agent-message]')].find(node => node.dataset.agentMessage === saved.anchor)
    const target = anchor ? viewport.scrollTop + anchor.getBoundingClientRect().top
      - viewport.getBoundingClientRect().top - (saved.offset ?? 0) : saved.top
    viewport.scrollTop = Math.max(0, target)
    lastTop.current = viewport.scrollTop
    // 虚拟片段尚未挂载时高度不足；保留目标，在真实正文变高后完成恢复。
    if (Math.abs(viewport.scrollTop - Math.max(0, target)) < 2) pendingRestore.current = undefined
  }, [])
  const scheduleFollow = useCallback(() => {
    if (!following.current && !pendingRestore.current || frame.current !== undefined) return
    frame.current = window.requestAnimationFrame(() => {
      frame.current = undefined
      if (pendingRestore.current) restorePosition()
      else if (following.current) scrollToEnd()
    })
  }, [restorePosition, scrollToEnd])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!active && !viewport?.getClientRects().length) return
    const saved = presentation?.conversations?.[sessionKey]
    if (viewport && saved && !saved.follow) {
      pendingRestore.current = saved
      restorePosition()
      following.current = false
      setShowJumpToLatest(true)
    }
  }, [active, presentation, restorePosition, sessionKey])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !active && !viewport.getClientRects().length) return
    const saved = pendingAnchor.current
    if (saved) {
      const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-agent-part]')].find(node => node.dataset.agentPart === saved.id)
      if (anchor) viewport.scrollTop += anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset
      lastTop.current = viewport.scrollTop
      pendingAnchor.current = undefined
    }
    scheduleFollow()
  }, [active, content, scheduleFollow])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !active && !viewport.getClientRects().length) return
    // 观察正文容器，而非前置的加载按钮；每个视图只保留一个跟随观察器。
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(scheduleFollow)
    if (contentRef.current) observer?.observe(contentRef.current)
    return () => { observer?.disconnect(); cancelFrame() }
  }, [active, cancelFrame, scheduleFollow])

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!active) return
    const viewport = event.currentTarget
    if (pendingRestore.current && viewport.scrollTop === lastTop.current) return
    const movedUp = viewport.scrollTop < lastTop.current - 1
    const atEnd = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 2
    // 取消跟随取决于上滚意图，恢复跟随必须真正到达末尾，不能用宽阈值拉回用户。
    if (movedUp || !atEnd) pause()
    else if (following.current || viewport.scrollTop > lastTop.current) {
      following.current = true
      setShowJumpToLatest(false)
    }
    lastTop.current = viewport.scrollTop
    if (presentation) {
      const top = viewport.getBoundingClientRect().top
      const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-agent-message]')].find(node => node.getBoundingClientRect().bottom > top)
      ;(presentation.conversations ??= {})[sessionKey] = { top: viewport.scrollTop, follow: following.current,
        anchor: anchor?.dataset.agentMessage, offset: anchor ? anchor.getBoundingClientRect().top - top : undefined }
    }
  }
  const onWheel = (event: WheelEvent<HTMLDivElement>) => { if (active && event.deltaY < 0) pause() }
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => { touchY.current = event.touches[0]?.clientY }
  const onTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    const y = event.touches[0]?.clientY
    if (active && y !== undefined && touchY.current !== undefined && y > touchY.current) pause()
    touchY.current = y
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (active && !event.defaultPrevented && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,[contenteditable="true"]'))
      && (['ArrowUp', 'PageUp', 'Home'].includes(event.key) || event.key === ' ' && event.shiftKey)) pause()
  }
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (active && event.target === event.currentTarget) pause()
  }
  const preserveAnchor = () => {
    const viewport = viewportRef.current
    const top = viewport?.getBoundingClientRect().top ?? 0
    const anchor = [...(viewport?.querySelectorAll<HTMLElement>('[data-agent-part]') ?? [])].find(node => node.getBoundingClientRect().bottom > top)
    if (anchor?.dataset.agentPart) pendingAnchor.current = { id: anchor.dataset.agentPart, offset: anchor.getBoundingClientRect().top - top }
    pause()
  }
  const resume = () => {
    pendingRestore.current = undefined
    following.current = true
    pendingAnchor.current = undefined
    scrollToEnd()
    if (presentation && viewportRef.current) (presentation.conversations ??= {})[sessionKey] = { top: viewportRef.current.scrollTop, follow: true }
  }
  return { viewportRef, contentRef, showJumpToLatest, preserveAnchor, resume,
    scrollEvents: { onScroll, onWheel, onTouchStart, onTouchMove, onKeyDown, onPointerDown } }
}
