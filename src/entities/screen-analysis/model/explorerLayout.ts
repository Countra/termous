import { analysisPanelLimits, type AnalysisPanelPreferences } from '#common/contracts'

export const analysisSeparatorWidth = 8
export const analysisRailWidth = 48
export const defaultAnalysisPanels: AnalysisPanelPreferences = { historyWidth: analysisPanelLimits.history.default, resultsWidth: analysisPanelLimits.results.default }
export type AnalysisPane = 'canvas' | 'results' | 'history'

export function explorerLayout(width: number, preferred: AnalysisPanelPreferences, history: boolean, results: boolean, pane: AnalysisPane) {
  const compact = width < 800
  const active: AnalysisPane = history ? 'history' : compact ? pane : results ? 'results' : 'canvas'
  const expanded = active !== 'canvas'
  const available = Math.max(1, width - analysisRailWidth - (expanded && !compact ? analysisSeparatorWidth : 0))
  const limits = analysisPanelLimits[active === 'history' ? 'history' : 'results']
  const wanted = active === 'history' ? preferred.historyWidth : preferred.resultsWidth
  // 两种内容共用右侧面板，各自保留宽度；窗口缩小不覆盖用户偏好。
  const sidebar = expanded ? compact ? 100 : Math.min(Math.max(limits.min, Math.min(limits.max, wanted)), available - 360) / available * 100 : 0
  return { compact, active, expanded, available, limits, centerMin: compact ? 0 : 360,
    sizes: { canvas: 100 - sidebar, sidebar } }
}
