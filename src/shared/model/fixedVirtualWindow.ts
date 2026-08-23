export interface FixedVirtualWindow {
  start: number
  end: number
  offset: number
  totalHeight: number
}

export function calculateFixedVirtualWindow(
  totalItems: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 5,
): FixedVirtualWindow {
  const safeTotal = Math.max(0, Math.trunc(totalItems))
  const safeRowHeight = Math.max(1, rowHeight)
  const safeViewportHeight = Math.max(safeRowHeight, viewportHeight)
  const safeOverscan = Math.max(0, Math.trunc(overscan))
  const firstVisible = Math.min(
    safeTotal,
    Math.floor(Math.max(0, scrollTop) / safeRowHeight),
  )
  const visibleCount = Math.ceil(safeViewportHeight / safeRowHeight)
  const start = Math.min(safeTotal, Math.max(0, firstVisible - safeOverscan))
  const end = Math.min(safeTotal, firstVisible + visibleCount + safeOverscan)
  return {
    start,
    end,
    offset: start * safeRowHeight,
    totalHeight: safeTotal * safeRowHeight,
  }
}
