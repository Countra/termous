import type { Region } from '#entities/desktop-workflow'
import type { AnalysisElement } from '#entities/screen-analysis'

export function analysisRegion(element: AnalysisElement, width: number, height: number): Region {
  const [left, top, right, bottom] = element.bbox_xyxy
  const x = Math.max(0, Math.floor(left)); const y = Math.max(0, Math.floor(top))
  return { x, y, width: Math.min(width, Math.ceil(right)) - x, height: Math.min(height, Math.ceil(bottom)) - y }
}
