import { useLayoutEffect, useRef } from 'react'

export function useAccountAuthMotion(view: string, onViewChange?: () => void) {
  const ref = useRef<HTMLElement>(null)
  const previous = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    const from = previous.current
    previous.current = view
    if (from === view) return
    // 容器负责恢复滚动位置，减少动态效果时也保持切页后的标题可见。
    onViewChange?.()
    const element = ref.current
    const reduced = element?.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (!element?.animate || reduced || from === undefined) return
    // 仅对现有节点做入场过渡，不重挂表单或扫码组件，快速切换时取消上一段动画。
    const offset = view === 'login:password' ? -10 : 10
    const animation = element.animate([
      { opacity: 0.35, transform: `translateX(${offset}px)` },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 200, easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' })
    return () => animation.cancel()
  }, [view, onViewChange])
  return ref
}
