import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from 'react'
import { computeTerminalCompletionPosition, type TerminalCompletionPopupPosition } from '../model/terminalCompletionPosition'
import {
  TERMINAL_AI_COMPLETION_POPUP_WIDTH, TERMINAL_AI_COMPLETION_MAX_HEIGHT,
  TERMINAL_AI_COMPLETION_MIN_HEIGHT,
} from '../model/terminalAiCompletion'
import { useTerminalRuntime } from './terminalRuntimeContext'

export function useTerminalAiCompletionPosition(
  frameRef: RefObject<HTMLDivElement | null>, sessionId: string | null, open: boolean,
  onUnavailable: () => void,
) {
  const { captureSessionCompletionCursor, subscribeSessionCompletionLayout } = useTerminalRuntime()
  const [position, setPosition] = useState<TerminalCompletionPopupPosition | null>(null)
  const update = useCallback(() => {
    const frame = frameRef.current
    const geometry = sessionId ? captureSessionCompletionCursor(sessionId) : null
    if (!open || !frame) {
      setPosition(null)
      return
    }
    const rect = frame.getBoundingClientRect()
    const maxWidth = rect.width - 16
    const maxHeight = Math.min(TERMINAL_AI_COMPLETION_MAX_HEIGHT, rect.height - 16)
    // 至少保留抬头、输入栏和关闭按钮，不能让在途请求留在不可见的浮层中。
    if (!Number.isFinite(maxWidth) || !Number.isFinite(maxHeight) || maxWidth <= 0 || maxHeight < TERMINAL_AI_COMPLETION_MIN_HEIGHT) {
      setPosition(null)
      onUnavailable()
      return
    }
    const anchored = geometry ? computeTerminalCompletionPosition({
      paneRect: rect, screenRect: geometry.screenRect,
      cursorX: geometry.cursorX, cursorY: geometry.cursorY,
      cellWidth: geometry.screenRect.width / geometry.columns,
      cellHeight: geometry.screenRect.height / geometry.rows,
      popupWidth: TERMINAL_AI_COMPLETION_POPUP_WIDTH, popupHeight: TERMINAL_AI_COMPLETION_MAX_HEIGHT,
    }) : null
    // 滚动历史或光标上下空间不足时，仍在当前分屏内保留独立的 AI 输入面板。
    const next: TerminalCompletionPopupPosition = anchored && anchored.maxHeight >= TERMINAL_AI_COMPLETION_MIN_HEIGHT ? anchored : {
      left: 8, top: 8, maxWidth, maxHeight, placement: 'below',
    }
    setPosition((previous) => previous && next
      && previous.left === next.left && previous.top === next.top
      && previous.maxWidth === next.maxWidth && previous.maxHeight === next.maxHeight
      && previous.placement === next.placement ? previous : next)
  }, [captureSessionCompletionCursor, frameRef, onUnavailable, open, sessionId])

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(update)
    return () => window.cancelAnimationFrame(frame)
  }, [update])

  useEffect(() => {
    if (!open || !sessionId) return
    const dispose = subscribeSessionCompletionLayout(sessionId, update)
    const observer = new ResizeObserver(update)
    if (frameRef.current) observer.observe(frameRef.current)
    return () => { dispose(); observer.disconnect() }
  }, [frameRef, open, sessionId, subscribeSessionCompletionLayout, update])
  return open ? position : null
}
