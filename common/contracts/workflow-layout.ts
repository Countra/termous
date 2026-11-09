export interface WorkflowEditorPanels { chainWidth: number; detailsWidth: number }

export const workflowPanelLimits = {
  chain: { min: 220, max: 420, default: 268 },
  details: { min: 260, max: 480, default: 300 },
} as const

export function isWorkflowEditorPanels(value: unknown): value is WorkflowEditorPanels {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const panels = value as Record<string, unknown>
  return Object.keys(panels).length === 2 && ['chain', 'details'].every(side => {
    const size = panels[`${side}Width`]
    const bounds = workflowPanelLimits[side as keyof typeof workflowPanelLimits]
    return typeof size === 'number' && Number.isFinite(size) && size >= bounds.min && size <= bounds.max
  })
}
