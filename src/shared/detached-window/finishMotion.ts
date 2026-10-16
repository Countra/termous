// 只等待当前可见的有限动画；窗口被遮挡、动画取消或减少动画时不能阻塞业务交接。
export async function finishDetachedMotion(element: HTMLElement | null) {
  if (!element || element.ownerDocument.hidden || !element.getClientRects().length
    || element.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const animations = element.getAnimations?.({ subtree: true }).filter(animation =>
    animation.playState !== 'finished' && Number.isFinite(animation.effect?.getComputedTiming().endTime)) ?? []
  if (!animations.length) return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      Promise.allSettled(animations.map(animation => animation.finished)),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 400) }),
    ])
  } finally { clearTimeout(timer) }
}
