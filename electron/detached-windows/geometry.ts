import type { DetachedRect } from '#common/contracts'

export function clampDetachedBounds(saved: DetachedRect | undefined, work: DetachedRect,
  size = { width: 1100, height: 800, minWidth: 480, minHeight: 520 }): DetachedRect {
  const width = Math.min(work.width, Math.max(size.minWidth, saved?.width ?? size.width))
  const height = Math.min(work.height, Math.max(size.minHeight, saved?.height ?? size.height))
  return {
    width, height,
    x: Math.round(Math.max(work.x, Math.min(saved?.x ?? work.x + (work.width - width) / 2, work.x + work.width - width))),
    y: Math.round(Math.max(work.y, Math.min(saved?.y ?? work.y + (work.height - height) / 2, work.y + work.height - height))),
  }
}
