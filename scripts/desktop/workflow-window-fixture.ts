import type { Definition, Run, Script, Version, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { createReviewHistory, reviewDefinition } from './workflow-review-fixture'

export function createWorkflowWindowFixture({ history = false } = {}) {
  const now = new Date().toISOString()
  let script: Script = { id: 'inspection', name: '发布前环境检查', description: '检查服务状态并保存截图。', tags: ['巡检'], revision: 1, created_at: now, updated_at: now }
  let definition: Definition = { schema_version: 1, parameters: [], steps: [
    { id: 'open', kind: 'pointer.click', name: '打开监控面板', action: {}, target: { kind: 'point', x: 120, y: 100 } },
    { id: 'wait', kind: 'delay', name: '等待页面加载', action: {}, delay_ms: 1000 },
    { id: 'capture', kind: 'capture', name: '保存检查结果', action: {} },
  ] }
  if (history) definition = structuredClone(reviewDefinition)
  const versions: Version[] = [{ script_id: script.id, number: script.revision, definition: structuredClone(definition), created_at: now }]
  const review = history ? createReviewHistory(now) : undefined
  const runs: Run[] = review?.runs ?? []
  const starts = new Map<string, Run>()
  const controls = new Map<string, Run>()
  const assets = new Map<string, Blob>()
  const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720
  const context = canvas.getContext('2d')!
  context.fillStyle = '#17202d'; context.fillRect(0, 0, 1280, 720)
  context.fillStyle = '#101824'; context.fillRect(0, 0, 200, 720)
  context.font = '24px sans-serif'; context.fillStyle = '#e4edf6'; context.fillText('Operations overview', 240, 68)
  context.font = '15px sans-serif'; context.fillStyle = '#8d9eb2'; context.fillText('Workspace', 28, 68)
  for (let i = 0; i < 4; i++) {
    context.fillStyle = '#233146'; context.fillRect(240, 108 + i * 132, 990, 108)
    context.fillStyle = '#d9e3ee'; context.fillText(`Service ${i + 1}`, 264, 146 + i * 132)
    context.fillStyle = '#73c6ac'; context.fillText('Healthy', 1100, 146 + i * 132)
  }
  const screenshot = new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('截图生成失败')), 'image/png'))
  const metadata = { connection_generation: 1, display_epoch: 1, frame_sequence: 1, desktop_width: 1280, desktop_height: 720,
    region: { x: 0, y: 0, width: 1280, height: 720 }, width: 1280, height: 720, captured_at: now }
  const missing = async (): Promise<never> => { throw new Error('此合成数据夹具不支持该操作') }
  const gateway: WorkflowGateway = {
    analyze: missing, analysisImage: missing, deleteAnalysis: missing,
    list: async () => [structuredClone(script)], listRuns: async () => structuredClone(runs),
    get: async () => ({ script: structuredClone(script), version: { script_id: script.id, number: script.revision, definition: structuredClone(definition), created_at: now } }),
    save: async (_id, value) => { definition = structuredClone(value.definition); script = { ...script, ...value, revision: script.revision + 1 }; versions.unshift({ script_id: script.id, number: script.revision, definition: structuredClone(definition), created_at: now }); return structuredClone(script) },
    remove: missing, restore: missing, versions: async () => structuredClone(versions),
    // 夹具只模拟空流程诊断，正式结构校验始终由 Core 提供。
    validate: async value => value.steps.some(step => !step.disabled) ? [] : [{ field: 'steps', code: 'steps_required' }],
    openPreview: async () => ({ id: crypto.randomUUID(), state: 'ready' }), closePreview: async () => {},
    capture: async () => ({ blob: await screenshot, metadata }), match: async () => ({ capture: { metadata }, result: { state: 'not_found', candidates: [] }, image: await screenshot }),
    upload: async file => { const id = crypto.randomUUID(); assets.set(id, file); return { id, width: 10, height: 10, size: file.size, sha256: '', created_at: now } },
    asset: async id => { if (history && id === 'review-image') return screenshot; const blob = assets.get(id); if (!blob) throw new Error('资源不存在'); return blob },
    start: async input => {
      if (starts.has(input.request_id)) return structuredClone(starts.get(input.request_id)!)
      const run: Run = { id: crypto.randomUUID(), script_id: script.id, version: input.version, name: script.name, state: 'paused', phase: 'paused', executed: 0, assertions: 0,
        revision: 1, session_id: 'desktop', target_name: '运维工作站', protocol: 'vnc', started_at: now }
      runs.unshift(run); starts.set(input.request_id, run); return structuredClone(run)
    },
    run: async id => {
      const run = runs.find(item => item.id === id)
      if (!run) throw new Error('执行记录不存在')
      const version = versions.find(item => item.number === run.version)
      const steps = review?.steps.get(id) ?? version?.definition.steps.slice(0, run.executed).map((step, index) => ({
        run_id: id, index: index + 1, step_id: step.id, occurrence: String(index + 1), kind: step.kind, state: 'completed', started_at: now, finished_at: now,
      })) ?? []
      return { run: structuredClone(run), steps: structuredClone(steps) }
    },
    control: async (id, request, action) => {
      if (controls.has(request)) return structuredClone(controls.get(request)!)
      const run = runs.find(item => item.id === id); if (!run) throw new Error('执行记录不存在')
      if (action === 'step') run.executed++
      else run.state = action === 'cancel' ? 'cancelled' : action === 'resume' ? 'running' : 'paused'
      run.phase = run.state; run.revision++; controls.set(request, structuredClone(run)); return structuredClone(run)
    },
    eventsURL: () => 'ws://fixture.invalid/events',
  }
  const session = { id: 'desktop', profile_name: '运维工作站', protocol: 'vnc', connection_generation: 1, status: 'streaming' } as RemoteDesktopSession
  return { gateway, sessions: [session] }
}
