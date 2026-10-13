import type { Point, Region } from '#entities/desktop-workflow'

export function imagePoint(client: Point, rect: { left: number; top: number; width: number; height: number }, size: { width: number; height: number }): Point {
  return {
    x: Math.max(0, Math.min(size.width - 1, Math.floor((client.x - rect.left) * size.width / rect.width))),
    y: Math.max(0, Math.min(size.height - 1, Math.floor((client.y - rect.top) * size.height / rect.height))),
  }
}
export function imageRegion(a: Point, b: Point): Region {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x) + 1, height: Math.abs(a.y - b.y) + 1 }
}
