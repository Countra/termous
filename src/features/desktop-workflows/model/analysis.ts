import type { AnalysisElement, Region } from '#entities/desktop-workflow'

export function analysisRegion(element: AnalysisElement, width: number, height: number): Region {
  const [left, top, right, bottom] = element.bbox_xyxy
  const x = Math.max(0, Math.floor(left)); const y = Math.max(0, Math.floor(top))
  return { x, y, width: Math.min(width, Math.ceil(right)) - x, height: Math.min(height, Math.ceil(bottom)) - y }
}

export function exportAnalysis(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = filename
    document.body.append(anchor); anchor.click(); anchor.remove()
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
