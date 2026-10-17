import type { Definition, Run, Step, StepResult } from '#entities/desktop-workflow'

// 仅用于视觉与交互验收，所有输入和目标均为合成数据。
export const reviewDefinition: Definition = { schema_version: 1, parameters: [{ id: 'token', name: '访问口令', type: 'string', sensitive: true }], steps: [
  { id: 'open', kind: 'pointer.click', name: '打开监控面板', action: { button: 'left', count: 1 }, target: { kind: 'point', x: 120, y: 100, reference_width: 1280, reference_height: 720 } },
  { id: 'filter', kind: 'keyboard.text', name: '输入服务筛选条件', action: { text: 'service: gateway\nstatus: healthy' } },
  { id: 'enter', kind: 'keyboard.key', name: '确认筛选条件', action: { code: 'Enter' } },
  { id: 'save', kind: 'keyboard.shortcut', name: '保存当前视图', action: { codes: ['ControlLeft', 'KeyS'] } },
  { id: 'secret', kind: 'keyboard.text', name: '填入运行参数', action: {}, bindings: { text: 'token' } },
  { id: 'repeat', kind: 'repeat', name: '重复检查服务', action: {}, iterations: 2, steps: [
    { id: 'wait', kind: 'delay', name: '等待页面加载', action: {}, delay_ms: 1000 },
    { id: 'capture', kind: 'capture', name: '保存检查结果', action: {} },
  ] },
  { id: 'assert', kind: 'image.assert', name: '确认服务健康', action: {}, image: { asset_id: 'review-image', offset: { x: 0, y: 0 }, threshold: 0.9 } },
] }

export function createReviewHistory(now: string) {
  const time = (offset: number) => new Date(Date.parse(now) + offset).toISOString()
  const base = { script_id: 'inspection', version: 1, name: '发布前环境检查', target_name: '运维工作站', protocol: 'vnc', revision: 1, initiator: { origin: 'app' as const } }
  const runs: Run[] = [
    { ...base, id: 'review-paused', state: 'paused', phase: 'paused', executed: 3, assertions: 0, session_id: 'desktop', started_at: time(-20000) },
    { ...base, id: 'review-completed', state: 'completed', phase: 'finished', executed: 11, assertions: 1, started_at: time(-180000), finished_at: time(-168400) },
    { ...base, id: 'review-failed', state: 'failed', phase: 'finished', executed: 11, assertions: 0, error_code: 'desktop_workflow_assertion_failed', started_at: time(-540000), finished_at: time(-528400) },
    { ...base, id: 'review-uncertain', state: 'uncertain', phase: 'finished', executed: 2, assertions: 0, error_code: 'desktop_input_uncertain', started_at: time(-900000), finished_at: time(-898300) },
  ]
  const steps = new Map<string, StepResult[]>()
  for (const run of runs) {
    const results: StepResult[] = []
    const append = (step: Step, occurrence: string) => {
      const index = results.length + 1
      const started = new Date(Date.parse(run.started_at) + index * 800).toISOString()
      const failed = run.state === 'failed' && step.id === 'assert'
      results.push({ run_id: run.id, index, step_id: step.id, occurrence, kind: step.kind, state: failed ? 'failed' : step.id === 'assert' ? 'assertion_passed' : 'completed',
        started_at: started, finished_at: new Date(Date.parse(started) + 320).toISOString(),
        ...(step.kind === 'capture' ? { asset_id: 'review-image' } : {}), ...(failed ? { error_code: run.error_code } : {}) })
    }
    reviewDefinition.steps.forEach((step, index) => {
      append(step, String(index + 1))
      if (step.kind === 'repeat') for (let iteration = 1; iteration <= 2; iteration++) step.steps?.forEach((child, childIndex) => append(child, `${index + 1}.${iteration}.${childIndex + 1}`))
    })
    steps.set(run.id, results.slice(0, run.executed))
  }
  return { runs, steps }
}
