import { useEffect, type RefObject } from 'react'

export function useDesktopClipboardPaste(target: RefObject<HTMLElement | null>, enabled: boolean, paste: () => void) {
  useEffect(() => {
    const root = target.current
    if (!enabled || !root) return
    const belongs = (event: Event) => {
      const element = event.target
      if (event.defaultPrevented || !(element instanceof Element) || element.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false
      // 导航按钮与页脚也属于当前文件抽屉；其它弹层和桌面画布不接管。
      const dialog = root.closest('[role="dialog"]')
      return dialog ? element.closest('[role="dialog"], [role="menu"], [role="listbox"]') === dialog : root.contains(element)
    }
    const keydown = (event: KeyboardEvent) => {
      if (!belongs(event) || event.isComposing || event.code !== 'KeyV' && event.key.toLowerCase() !== 'v' || event.ctrlKey === event.metaKey || event.altKey || event.shiftKey) return
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) paste()
    }
    const clipboard = (event: ClipboardEvent) => {
      if (!belongs(event)) return
      event.preventDefault()
      event.stopPropagation()
      paste()
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('paste', clipboard)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('paste', clipboard)
    }
  }, [enabled, paste, target])
}
