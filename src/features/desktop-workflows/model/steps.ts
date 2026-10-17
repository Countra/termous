import type { Definition, Step, StepKind } from '#entities/desktop-workflow'

export const newDefinition = (): Definition => ({ schema_version: 1, parameters: [], steps: [] })
export function newStep(kind: StepKind): Step {
  const action = kind === 'pointer.click' ? { button: 'left', count: 1 } : kind === 'pointer.scroll' ? { delta: 120 } : kind === 'pointer.drag' ? { button: 'left', duration_ms: 500 } : kind === 'keyboard.key' ? { code: 'Enter' } : kind === 'resize' ? { width: 1280, height: 720 } : {}
  return { id: crypto.randomUUID(), name: '', kind, action, ...(kind === 'delay' ? { delay_ms: 1000 } : {}), ...(kind === 'repeat' ? { iterations: 2, steps: [] } : {}), ...(kind === 'if' ? { steps: [], else: [] } : {}) }
}
export function findStep(steps: Step[], id?: string): Step | undefined {
  for (const step of steps) { if (step.id === id) return step; const child = findStep(step.steps ?? [], id) ?? findStep(step.else ?? [], id); if (child) return child }
}
export function editStep(steps: Step[], id: string, edit: (step: Step) => Step | undefined): Step[] {
  return steps.flatMap((step) => {
    if (step.id === id) { const result = edit(step); return result ? [result] : [] }
    return [{ ...step, ...(step.steps ? { steps: editStep(step.steps, id, edit) } : {}), ...(step.else ? { else: editStep(step.else, id, edit) } : {}) }]
  })
}
export function cloneStep(step: Step): Step {
  return { ...structuredClone(step), id: crypto.randomUUID(), ...(step.steps ? { steps: step.steps.map(cloneStep) } : {}), ...(step.else ? { else: step.else.map(cloneStep) } : {}) }
}
export function moveStep(steps: Step[], id: string, delta: number): Step[] {
  const index = steps.findIndex((step) => step.id === id)
  if (index >= 0) {
    const destination = index + delta
    if (!Number.isInteger(destination) || destination < 0 || destination >= steps.length) return steps
    const next = [...steps]
    const [moving] = next.splice(index, 1)
    next.splice(destination, 0, moving!)
    return next
  }
  return steps.map((step) => ({ ...step, ...(step.steps ? { steps: moveStep(step.steps, id, delta) } : {}), ...(step.else ? { else: moveStep(step.else, id, delta) } : {}) }))
}
export function insertStep(steps: Step[], step: Step, parent?: string, branch: 'steps' | 'else' = 'steps'): Step[] {
  return parent ? editStep(steps, parent, (value) => ({ ...value, [branch]: [...(value[branch] ?? []), step] })) : [...steps, step]
}
export function copyStep(steps: Step[], id: string): Step[] {
  return steps.flatMap((step) => step.id === id ? [step, cloneStep(step)] : [{ ...step, ...(step.steps ? { steps: copyStep(step.steps, id) } : {}), ...(step.else ? { else: copyStep(step.else, id) } : {}) }])
}
