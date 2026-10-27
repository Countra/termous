export interface Rect { x: number; y: number; width: number; height: number }
export const badgeSize = { width: 168, height: 40 }
export const barSize = { width: 392, height: 80 }
const clamp = (value: number, start: number, length: number, size: number) => Math.round(Math.max(start, Math.min(value, start + Math.max(0, length - size))))
export function indicatorBounds(point: { x: number; y: number }, area: Rect): { badge: Rect; bar: Rect } {
  const width = Math.min(barSize.width, area.width)
  // 系统鼠标与工作区均为 DIP；屏幕负坐标和混合缩放不需要额外换算。
  const badgeX = point.x + 20 + badgeSize.width <= area.x + area.width ? point.x + 20 : point.x - badgeSize.width - 12
  const badgeY = point.y + 22 + badgeSize.height <= area.y + area.height ? point.y + 22 : point.y - badgeSize.height - 12
  return {
    badge: { ...badgeSize, x: clamp(badgeX, area.x, area.width, badgeSize.width), y: clamp(badgeY, area.y, area.height, badgeSize.height) },
    bar: { width, height: barSize.height, x: clamp(area.x + area.width - width - 12, area.x, area.width, width), y: clamp(area.y + area.height - barSize.height - 12, area.y, area.height, barSize.height) },
  }
}
export function sameBounds(a: Rect, b: Rect) { return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height }
