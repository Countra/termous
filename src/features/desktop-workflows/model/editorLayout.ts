import { workflowPanelLimits, type WorkflowEditorPanels } from '#common/contracts'

export const editorSeparatorWidth = 8
export const editorCompactWidth = 860
export type EditorPanel = 'chain' | 'canvas' | 'details'
export const defaultEditorPanels: WorkflowEditorPanels = { chainWidth: workflowPanelLimits.chain.default, detailsWidth: workflowPanelLimits.details.default }

export function editorLayout(width: number, preferred: WorkflowEditorPanels, chainCollapsed: boolean, detailsVisible: boolean, selected: EditorPanel = 'canvas') {
  const compact = width < editorCompactWidth
  const chainDocked = compact ? selected === 'chain' : !chainCollapsed
  const detailsDocked = compact ? selected === 'details' : detailsVisible
  const separatorCount = compact ? 0 : Number(chainDocked) + Number(detailsDocked)
  const available = Math.max(1, width - editorSeparatorWidth * separatorCount)
  if (compact) return { compact, chainDocked, detailsDocked, available, separatorCount, centerMin: 0,
    chainWidth: chainDocked ? available : 0, detailsWidth: detailsDocked ? available : 0,
    sizes: { chain: chainDocked ? 100 : 0, canvas: selected === 'canvas' ? 100 : 0, details: detailsDocked ? 100 : 0 } }
  const minimumChain = chainDocked ? workflowPanelLimits.chain.min : 0
  const minimumDetails = detailsDocked ? workflowPanelLimits.details.min : 0
  const chain = chainDocked ? Math.min(workflowPanelLimits.chain.max, Math.max(minimumChain, preferred.chainWidth)) : 0
  const details = detailsDocked ? Math.min(workflowPanelLimits.details.max, Math.max(minimumDetails, preferred.detailsWidth)) : 0
  // 临时压缩仅适应当前窗口，不覆盖用户保存的展开宽度。
  const spare = Math.max(0, available - 320 - minimumChain - minimumDetails)
  const wanted = chain + details - minimumChain - minimumDetails
  const ratio = wanted > spare ? spare / wanted : 1
  const chainWidth = minimumChain + (chain - minimumChain) * ratio
  const detailsWidth = minimumDetails + (details - minimumDetails) * ratio
  return { compact, chainDocked, detailsDocked, available, separatorCount, chainWidth, detailsWidth,
    centerMin: Math.min(320, Math.max(0, available - minimumChain - minimumDetails)),
    sizes: { chain: chainWidth / available * 100, canvas: Math.max(0, available - chainWidth - detailsWidth) / available * 100, details: detailsWidth / available * 100 } }
}
