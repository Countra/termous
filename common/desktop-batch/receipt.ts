export const desktopBatchTools = new Set(['termous.desktops.execute', 'termous.desktops.executions.get', 'termous.desktops.executions.cancel', 'wait_desktop_execution'])
const runStates = ['running', 'completed', 'stopped', 'cancelled', 'uncertain'] as const
const stepStates = ['pending', 'dispatching', 'accepted', 'failed', 'uncertain', 'skipped'] as const
const phases = ['validating', 'executing', 'waiting', 'capturing', 'finalizing', 'finished'] as const
const kinds = new Set(['pointer.move', 'pointer.click', 'pointer.click_current', 'pointer.scroll', 'pointer.drag', 'keyboard.key', 'keyboard.shortcut', 'keyboard.text'])

export interface DesktopBatchStep {
  index: number
  kind: string
  state: typeof stepStates[number]
  wait_after_ms: number
  error_code?: string
}
export interface DesktopBatchReceipt {
  id: string
  state: typeof runStates[number]
  phase?: typeof phases[number]
  accepted_actions: number
  steps: DesktopBatchStep[]
  capture_state: 'pending' | 'ready' | 'unavailable'
  capture_error?: string
  cleanup_error?: string
  report_error?: string
  error_code?: string
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function code(value: unknown) { return typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/u.test(value) ? value : undefined }

// 只投影有界回执，不携带输入正文、截图像素或授权字段。
export function readDesktopBatch(value: unknown): DesktopBatchReceipt | undefined {
  if (!record(value) || !record(value.run)) return undefined
  const run = value.run
  if (typeof run.id !== 'string' || run.id.length > 128 || !run.id.startsWith('desktop_execution_')
    || !runStates.some(state => state === run.state) || !Number.isInteger(run.accepted_actions)
    || !Array.isArray(run.steps) || run.steps.length < 1 || run.steps.length > 5
    || !['pending', 'ready', 'unavailable'].includes(String(value.capture_state))) return undefined
  const steps: DesktopBatchStep[] = []
  for (const [index, step] of run.steps.entries()) {
    if (!record(step) || step.index !== index || typeof step.kind !== 'string' || !kinds.has(step.kind)
      || !stepStates.some(state => state === step.state) || typeof step.wait_after_ms !== 'number'
      || !Number.isInteger(step.wait_after_ms) || step.wait_after_ms < 0 || step.wait_after_ms > 90_000) return undefined
    steps.push({ index, kind: step.kind, state: step.state as DesktopBatchStep['state'], wait_after_ms: step.wait_after_ms, error_code: code(step.error_code) })
  }
  if (run.accepted_actions !== steps.filter(step => step.state === 'accepted').length) return undefined
  return { id: run.id, state: run.state as DesktopBatchReceipt['state'], accepted_actions: run.accepted_actions as number,
    phase: phases.some(phase => phase === run.phase) ? run.phase as DesktopBatchReceipt['phase'] : undefined,
    steps, capture_state: value.capture_state as DesktopBatchReceipt['capture_state'], capture_error: code(value.capture_error),
    cleanup_error: code(run.cleanup_error), report_error: code(run.report_error), error_code: code(run.error_code) }
}

export function readDesktopBatchContent(tool: string, content: unknown): DesktopBatchReceipt | undefined {
  if (!desktopBatchTools.has(tool) || !Array.isArray(content)) return undefined
  for (const block of content.slice(0, 8)) {
    if (!record(block) || block.type !== 'text' || typeof block.text !== 'string' || block.text.length > 64 * 1024) continue
    try { const receipt = readDesktopBatch(JSON.parse(block.text)); if (receipt) return receipt } catch { /* 非完整回执不参与结构化展示。 */ }
  }
  return undefined
}
