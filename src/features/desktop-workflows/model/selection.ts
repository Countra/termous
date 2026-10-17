import type { Point, Region } from '#entities/desktop-workflow'

export const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type ResizeHandle = typeof resizeHandles[number]
export interface ImageSize { width: number; height: number }

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export function moveSelection(region: Region, delta: Point, size: ImageSize): Region {
  return {
    ...region,
    x: clamp(region.x + Math.round(delta.x), 0, size.width - region.width),
    y: clamp(region.y + Math.round(delta.y), 0, size.height - region.height),
  }
}

export function resizeSelection(region: Region, handle: ResizeHandle, delta: Point, size: ImageSize): Region {
  let { x: left, y: top } = region
  let right = left + region.width
  let bottom = top + region.height
  // 保持对边固定，最小保留一个原始像素，跨过对边时不翻转手柄方向。
  if (handle.includes('w')) left = clamp(left + Math.round(delta.x), 0, right - 1)
  if (handle.includes('e')) right = clamp(right + Math.round(delta.x), left + 1, size.width)
  if (handle.includes('n')) top = clamp(top + Math.round(delta.y), 0, bottom - 1)
  if (handle.includes('s')) bottom = clamp(bottom + Math.round(delta.y), top + 1, size.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function sameSelection(a?: Region, b?: Region): boolean {
  return a === b || !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
