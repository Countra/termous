import { isWorkflowEditorPanels } from '#common/contracts'
import type { WorkflowPresentation } from './types'

export const workflowLayoutStorageKey = 'termous.ui.desktopWorkflow.layout.v1'
type LayoutPreferences = Pick<WorkflowPresentation, 'catalogCollapsed' | 'chainCollapsed' | 'editorPanels' | 'propertiesVisible'>

function layoutPreferences(value: unknown): Partial<LayoutPreferences> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const input = value as Record<string, unknown>
  const result: Partial<LayoutPreferences> = {}
  for (const key of ['catalogCollapsed', 'chainCollapsed', 'propertiesVisible'] as const) {
    if (typeof input[key] === 'boolean') result[key] = input[key]
  }
  if (isWorkflowEditorPanels(input.editorPanels)) result.editorPanels = { ...input.editorPanels }
  return result
}

export function readWorkflowLayoutPreferences(): Partial<LayoutPreferences> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(workflowLayoutStorageKey)
    return raw ? layoutPreferences(JSON.parse(raw)) : {}
  } catch {
    // 缓存损坏或浏览器禁止存储时使用默认布局，不影响流程编辑。
    return {}
  }
}

export function saveWorkflowLayoutPreferences(previous: WorkflowPresentation, next: WorkflowPresentation) {
  if (previous.catalogCollapsed === next.catalogCollapsed && previous.chainCollapsed === next.chainCollapsed
    && previous.propertiesVisible === next.propertiesVisible
    && previous.editorPanels?.chainWidth === next.editorPanels?.chainWidth
    && previous.editorPanels?.detailsWidth === next.editorPanels?.detailsWidth) return
  if (typeof window === 'undefined') return
  try {
    // 仅缓存有界布局偏好，不保存草稿、查询、分析记录或步骤选择。
    window.localStorage.setItem(workflowLayoutStorageKey, JSON.stringify(layoutPreferences(next)))
  } catch {
    // 写入失败仍保留本次内存状态及窗口同步，后续调整时可以再次保存。
  }
}
