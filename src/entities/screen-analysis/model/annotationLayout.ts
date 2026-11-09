import type { AnalysisGeometry, AnalysisLabelMode } from '#common/contracts'

export type Rect = [number, number, number, number]
export interface LabelPlacement { id: number; box: Rect; anchor: [number, number] }
export const overlaps = (a: Rect, b: Rect) => Math.min(a[2], b[2]) > Math.max(a[0], b[0]) && Math.min(a[3], b[3]) > Math.max(a[1], b[1])

// 与 Core 使用相同的有限候选位置；只布局编号，不更改原图几何。
export function layoutLabels(items: { id: number; box: Rect }[], width: number, height: number, mode: AnalysisLabelMode): LabelPlacement[] {
  if (mode === 'none') return []
  const placed: LabelPlacement[] = []
  // 与 Core 一样按固定网格索引标签，避免每次缩放做全量两两碰撞检查。
  const grid = new Map<number, Rect[]>(), columns = Math.ceil(width / 32) + 1
  const cells = (box: Rect, visit: (key: number) => boolean) => {
    for (let y = Math.floor(Math.max(0, box[1]) / 32); y <= Math.floor((box[3] - 1) / 32); y++) {
      for (let x = Math.floor(Math.max(0, box[0]) / 32); x <= Math.floor((box[2] - 1) / 32); x++) if (visit(y * columns + x)) return true
    }
    return false
  }
  const collision = (box: Rect) => cells(box, key => grid.get(key)?.some(previous => overlaps(box, previous)) ?? false)

  for (const { id, box: [l, t, r, b] } of [...items].sort((a, b) => a.id - b.id)) {
    const w = String(id).length * 8 + 4, h = 14
    let chosen: Rect | undefined
    for (const gap of [2, 18, 34]) {
      const points = [[l, t - h - gap], [r - w, t - h - gap], [l, b + gap], [r - w, b + gap],
        [l - w - gap, Math.trunc((t + b - h) / 2)], [r + gap, Math.trunc((t + b - h) / 2)],
        [Math.trunc((l + r - w) / 2), t - h - gap], [Math.trunc((l + r - w) / 2), b + gap]]
      chosen = points.map(([x, y]): Rect => [x, y, x + w, y + h]).find(candidate =>
        candidate[0] >= 0 && candidate[1] >= 0 && candidate[2] <= width && candidate[3] <= height
        && !collision([candidate[0] - 2, candidate[1] - 2, candidate[2] + 2, candidate[3] + 2]))
      if (chosen) break
    }
    if (!chosen && mode === 'all' && w <= width && h <= height) {
      const x = Math.min(Math.max(l, 0), width - w), y = Math.min(Math.max(t - h, 0), height - h)
      chosen = [x, y, x + w, y + h]
    }
    if (chosen) cells(chosen, key => { const bucket = grid.get(key) ?? []; bucket.push(chosen!); grid.set(key, bucket); return false })
    if (chosen) placed.push({ id, box: chosen, anchor: [Math.min(Math.max(Math.trunc((chosen[0] + chosen[2]) / 2), l), r - 1),
      Math.min(Math.max(Math.trunc((chosen[1] + chosen[3]) / 2), t), b - 1)] })
  }
  return placed
}

export function projectGeometry(items: AnalysisGeometry[], scale: number) {
  return items.map(item => ({ id: item.id, box: item.bbox_xyxy.map((v, i) => i < 2 ? Math.floor(v * scale) : Math.ceil(v * scale)) as Rect }))
}

export function hitCandidates(items: AnalysisGeometry[], x: number, y: number, selected?: number) {
  const area = (item: AnalysisGeometry) => (item.bbox_xyxy[2] - item.bbox_xyxy[0]) * (item.bbox_xyxy[3] - item.bbox_xyxy[1])
  return items.filter(({ bbox_xyxy: [l, t, r, b] }) => x >= l && x < r && y >= t && y < b)
    .sort((a, b) => Number(b.id === selected) - Number(a.id === selected) || area(a) - area(b) || a.id - b.id)
}
