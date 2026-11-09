type Point = { x: number; y: number }

export function createRdpIme(options: {
  target: HTMLElement; canvas: HTMLCanvasElement
  size: () => { width: number; height: number }
  authority: () => string | undefined
  commit: (text: string) => void
}) {
  // 本机候选框跟随最近点击的画面位置；像素协议不包含远端文字插入光标。
  const element = document.createElement('textarea')
  element.setAttribute('aria-label', 'RDP keyboard input')
  element.autocomplete = 'off'
  element.spellcheck = false
  element.wrap = 'off'
  element.style.cssText = 'position:absolute;width:1px;height:20px;min-width:0;min-height:0;padding:0;border:0;margin:0;opacity:0;overflow:hidden;resize:none;pointer-events:none;font-size:16px;line-height:20px'
  let anchor: Point | undefined
  let composing = false
  let compositionAuthority: string | undefined
  const listeners = new AbortController()

  function refresh() {
    const host = options.target.getBoundingClientRect(), canvas = options.canvas.getBoundingClientRect()
    const size = options.size()
    if (host.width <= 0 || host.height <= 0 || size.width <= 0 || size.height <= 0) return
    const point = anchor ?? { x: size.width / 2, y: size.height / 2 }
    const x = canvas.left - host.left + Math.min(size.width - 1, Math.max(0, point.x)) * canvas.width / size.width
    const y = canvas.top - host.top + Math.min(size.height - 1, Math.max(0, point.y)) * canvas.height / size.height
    element.style.left = `${options.target.scrollLeft + Math.max(0, Math.min(host.width - 1, x))}px`
    element.style.top = `${options.target.scrollTop + Math.max(0, Math.min(host.height - 20, y))}px`
  }
  function reset() { composing = false; compositionAuthority = undefined; element.value = '' }
  element.addEventListener('compositionstart', () => {
    composing = true
    compositionAuthority = options.authority()
    refresh()
  }, { signal: listeners.signal })
  element.addEventListener('compositionend', event => {
    const valid = composing && compositionAuthority !== undefined && compositionAuthority === options.authority()
    reset()
    if (valid && event.data) options.commit(event.data)
  }, { signal: listeners.signal })
  element.addEventListener('input', event => { if (!(event as InputEvent).isComposing) element.value = '' }, { signal: listeners.signal })
  element.addEventListener('blur', reset, { signal: listeners.signal })
  options.target.addEventListener('scroll', refresh, { signal: listeners.signal })
  return {
    element, refresh, reset,
    get composing() { return composing },
    focus(point?: Point) {
      if (point) {
        // 远端点击会切换输入目标，旧组合文本不能随后提交到新目标。
        if (composing) { reset(); element.blur() }
        anchor = { ...point }
      }
      refresh()
      element.focus({ preventScroll: true })
    },
    dispose() { reset(); listeners.abort(); element.remove() },
  }
}
