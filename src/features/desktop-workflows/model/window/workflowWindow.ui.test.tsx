import { waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Definition, Run, WorkflowGateway } from '#entities/desktop-workflow'
import { WorkflowController } from '../workspace/WorkflowController'
import { WorkflowSurfaceAdapter } from './WorkflowSurfaceAdapter'
import { WorkflowMediaHost } from './WorkflowMediaHost'

const connection = { module: 'desktop-workflow', instance: 'workspace', generation: 'test' }

it('独立窗口 OCR 只接受所属预览，取消后拒绝迟到结果', async () => {
  const { gateway, controller } = fixture()
  vi.mocked(gateway.openPreview).mockResolvedValue({ id: 'owned', state: 'ready' })
  let finish!: (value: unknown) => void
  gateway.previewOCR = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const media = new WorkflowMediaHost(gateway, controller)
  const query = { text_confidence: .5, ocr_max_side: 1600 }
  await expect(media.handle({ kind: 'ocr-preview', id: 'foreign', request: 'request', query })).rejects.toThrow('workflow_preview_unavailable')
  await media.handle({ kind: 'open', session: 'desktop', generation: 1 })
  const pending = media.handle({ kind: 'ocr-preview', id: 'owned', request: 'request', query })
  const rejected = expect(pending).rejects.toThrow()
  await media.handle({ kind: 'ocr-cancel', id: 'owned', request: 'request' })
  expect(vi.mocked(gateway.previewOCR).mock.calls[0][2]?.aborted).toBe(true)
  finish({})
  await rejected
  await media.reset()
  controller.dispose()
})

it('OCR 图片传输准备期间取消预览也拒绝迟到响应', async () => {
  const { gateway, controller } = fixture()
  vi.mocked(gateway.openPreview).mockResolvedValue({ id: 'owned', state: 'ready' })
  const image = new Blob(['image'], { type: 'image/png' })
  let finish!: (value: ArrayBuffer) => void
  const bytes = vi.spyOn(image, 'arrayBuffer').mockImplementation(() => new Promise(resolve => { finish = resolve }))
  gateway.previewOCR = vi.fn().mockResolvedValue({ image })
  const media = new WorkflowMediaHost(gateway, controller)
  await media.handle({ kind: 'open', session: 'desktop', generation: 1 })
  const pending = media.handle({ kind: 'ocr-preview', id: 'owned', request: 'request', query: { text_confidence: .5, ocr_max_side: 1600 } })
  const rejected = expect(pending).rejects.toThrow()
  await waitFor(() => expect(bytes).toHaveBeenCalledOnce())
  await media.handle({ kind: 'close', id: 'owned' })
  finish(new ArrayBuffer(0))
  await rejected
  controller.dispose()
})

it('OCR 明细读取完成前切换报告或释放窗口，不再交付旧报告正文', async () => {
  for (const reset of [false, true]) {
    const { gateway, controller } = fixture()
    const run = { id: 'run' } as Run
    vi.mocked(gateway.run).mockResolvedValue({ run, steps: [] })
    controller.execution.selectReport(run.id, true)
    await waitFor(() => expect(controller.getSnapshot().execution.report.value?.run.id).toBe('run'))
    let finish!: (value: unknown) => void
    gateway.ocrReport = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const media = new WorkflowMediaHost(gateway, controller)
    const pending = media.handle({ kind: 'ocr-report', id: 'run', index: 1, offset: 0, limit: 20 })
    const rejected = expect(pending).rejects.toThrow('workflow_report_unavailable')
    if (reset) await media.reset()
    else {
      vi.mocked(gateway.run).mockResolvedValue({ run: { ...run, id: 'next' }, steps: [] })
      controller.execution.selectReport('next', true)
      await waitFor(() => expect(controller.getSnapshot().execution.report.value?.run.id).toBe('next'))
    }
    finish({ items: [] })
    await rejected
    controller.dispose()
  }
})

it('独立窗口接收宿主提供的真实推理设备，不依赖组件检查记录', async () => {
  const { controller } = fixture()
  controller.runtimeStatus = async () => ({ service: { state: 'ready', device: 'cuda' } })
  controller.warmupRuntime = vi.fn().mockResolvedValue(undefined)
  const media = new WorkflowMediaHost(controller.media, controller)
  expect(await media.handle({ kind: 'runtime-status' })).toEqual({ service: { state: 'ready', device: 'cuda' } })
  await media.handle({ kind: 'runtime-warmup' })
  expect(controller.warmupRuntime).toHaveBeenCalledTimes(1)
  controller.dispose()
})

it('独立窗口只允许从所属预览提交，关闭预览不取消已接受任务', async () => {
  const { gateway, controller } = fixture()
  gateway.submitAnalysis = vi.fn().mockResolvedValue({ id: 'analysis' })
  gateway.cancelAnalysis = vi.fn()
  gateway.getAnalysis = vi.fn().mockResolvedValue({ id: 'analysis', state: 'succeeded' })
  vi.mocked(gateway.openPreview).mockResolvedValue({ id: 'owned', state: 'ready' })
  const media = new WorkflowMediaHost(gateway, controller)
  await expect(media.handle({ kind: 'analysis', request: { operation: 'submit', input: { request_id: 'request', source: { kind: 'preview', id: 'foreign' } } } })).rejects.toThrow('workflow_preview_unavailable')
  await media.handle({ kind: 'open', session: 'desktop', generation: 1 })
  await media.handle({ kind: 'analysis', request: { operation: 'submit', input: { request_id: 'request', source: { kind: 'preview', id: 'owned' } } } })
  await media.reset()
  expect(gateway.cancelAnalysis).not.toHaveBeenCalled()
  expect(await media.handle({ kind: 'analysis', request: { operation: 'get', id: 'analysis' } })).toMatchObject({ state: 'succeeded' })
  await media.handle({ kind: 'analysis', request: { operation: 'cancel', id: 'analysis' } })
  expect(gateway.cancelAnalysis).toHaveBeenCalledWith('analysis')
  controller.dispose()
})
function fixture() {
  const gateway = { save: vi.fn(), start: vi.fn(), control: vi.fn(), openPreview: vi.fn(), closePreview: vi.fn().mockResolvedValue(undefined), capture: vi.fn(), upload: vi.fn(), asset: vi.fn(), run: vi.fn() } as unknown as WorkflowGateway
  const controller = new WorkflowController(gateway)
  controller.configure({ sessions: [{ id: 'desktop', profile_name: '桌面', protocol: 'vnc', status: 'streaming', connection_generation: 1 }], profiles: [], activeSessionId: 'desktop' }, { scripts: [], runs: [], loading: false })
  const adapter = new WorkflowSurfaceAdapter(controller)
  controller.actions.create('待保存草稿')
  return { gateway, controller, adapter }
}

it('操作反馈由宿主持有，迟到的消费确认不会清除下一次反馈', async () => {
  const { gateway, controller, adapter } = fixture()
  gateway.validate = vi.fn().mockResolvedValue([])
  await controller.actions.validate()
  const first = controller.getSnapshot().state.notice!
  await controller.actions.validate()
  const second = controller.getSnapshot().state.notice!
  expect(second.id).not.toBe(first.id)
  const packet = { connection, kind: 'request' as const, operation: 'command' as const, payload: { name: 'dismissNotice', args: [first.id] } }
  expect(await adapter.handle(packet)).toMatchObject({ ok: true })
  expect(controller.getSnapshot().state.notice?.id).toBe(second.id)
  expect(await adapter.handle({ ...packet, payload: { ...packet.payload, args: [second.id] } })).toMatchObject({ ok: true })
  expect(controller.getSnapshot().state.notice).toBeUndefined()
  controller.dispose()
})

it('子窗口草稿由唯一宿主持有，旧所有者不能覆盖新草稿，已确认输入可以补回执', async () => {
  const { controller, adapter } = fixture()
  const owner = controller.getSnapshot().state.draft!.editingID
  const packet = { connection, kind: 'request' as const, operation: 'command' as const, payload: { name: 'change', args: [{ name: '独立窗口编辑' }], owner, inputSequence: 1 } }
  expect(await adapter.handle(packet)).toMatchObject({ ok: true })
  expect(controller.getSnapshot().state.draft?.name).toBe('独立窗口编辑')
  controller.actions.create('下一份草稿')
  expect(await adapter.handle(packet)).toMatchObject({ ok: true })
  expect(await adapter.handle({ ...packet, payload: { ...packet.payload, inputSequence: 2 } })).toMatchObject({ ok: false })
  expect(controller.getSnapshot().state.draft?.name).toBe('下一份草稿')
})

it('启动响应丢失后跨视图保留原始参数、会话代次和请求标识', async () => {
  const { gateway, controller } = fixture()
  const definition = controller.getSnapshot().state.draft!.definition
  const script = { id: 'script', revision: 1, name: '脚本', description: '', tags: [], created_at: '', updated_at: '' }
  controller.execution.open(script, definition, controller.getSnapshot().target, true)
  vi.mocked(gateway.start).mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ id: 'run' } as Run)
  controller.execution.change({ parameters: { value: '原始值' } })
  await controller.actions.start()
  controller.execution.environment = { sessions: [], profiles: [] }
  controller.actions.changeRun({ parameters: { value: '不能覆盖' } })
  await controller.actions.start()
  expect(vi.mocked(gateway.start).mock.calls[1]).toEqual(vi.mocked(gateway.start).mock.calls[0])
  expect(controller.getSnapshot().state.selectedRun).toBe('run')
})

it('跨视图切换不丢失单步请求标识，返回只恢复读取而不取消执行', async () => {
  const { gateway, controller } = fixture()
  vi.mocked(gateway.run).mockResolvedValue({ run: { id: 'run' } as Run, steps: [] })
  vi.mocked(gateway.control).mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ id: 'run' } as Run)
  controller.execution.selectReport('run', true)
  await controller.actions.control('step')
  controller.execution.selectReport('run', false)
  controller.execution.selectReport('run', true)
  await controller.actions.control('step')
  expect(vi.mocked(gateway.control).mock.calls[1]).toEqual(vi.mocked(gateway.control).mock.calls[0])
  expect(vi.mocked(gateway.control).mock.calls.every(call => call[2] === 'step')).toBe(true)
  controller.dispose()
})

it('媒体能力拒绝跨窗口预览和未发布资源，迟到的观察在窗口释放后关闭', async () => {
  const { gateway, controller } = fixture()
  const media = new WorkflowMediaHost(gateway, controller)
  await expect(media.handle({ kind: 'capture', id: 'foreign' })).rejects.toThrow('workflow_preview_unavailable')
  await expect(media.handle({ kind: 'asset', id: 'foreign' })).rejects.toThrow('workflow_asset_unavailable')
  expect(gateway.capture).not.toHaveBeenCalled()
  expect(gateway.asset).not.toHaveBeenCalled()
  let resolve!: (preview: { id: string; state: string }) => void
  vi.mocked(gateway.openPreview).mockImplementation(() => new Promise(done => { resolve = done }))
  const pending = media.handle({ kind: 'open', session: 'desktop', generation: 1 })
  await media.reset()
  resolve({ id: 'late', state: 'ready' })
  await expect(pending).rejects.toThrow('detached_disconnected')
  expect(gateway.closePreview).toHaveBeenCalledWith('late')
})

it('独立窗口仅能读取当前执行固定版本的模板，切换报告后不保留旧报告的权限', async () => {
  const { gateway, controller } = fixture()
  const media = new WorkflowMediaHost(gateway, controller)
  const definition: Definition = { schema_version: 1, parameters: [], steps: [{ id: 'image', name: '', kind: 'image.assert', action: {}, image: { asset_id: 'historical-template', offset: { x: 0, y: 0 } } }] }
  const run = { id: 'run', script_id: 'script', version: 1 } as Run
  gateway.versions = vi.fn().mockResolvedValue([{ script_id: 'script', number: 1, definition, created_at: '' }])
  vi.mocked(gateway.run).mockResolvedValue({ run, steps: [] })
  vi.mocked(gateway.asset).mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  controller.execution.selectReport(run.id, true)
  await waitFor(() => expect(controller.getSnapshot().execution.report.definition?.status).toBe('ready'))
  expect(controller.getSnapshot().state.versions).toBeUndefined()
  await expect(media.handle({ kind: 'asset', id: 'historical-template' })).resolves.toMatchObject({ type: 'image/png' })
  await expect(media.handle({ kind: 'asset', id: 'foreign-template' })).rejects.toThrow('workflow_asset_unavailable')
  vi.mocked(gateway.run).mockResolvedValue({ run: { ...run, id: 'next', version: 2 }, steps: [] })
  controller.execution.selectReport('next', true)
  await expect(media.handle({ kind: 'asset', id: 'historical-template' })).rejects.toThrow('workflow_asset_unavailable')
  await waitFor(() => expect(controller.getSnapshot().execution.report.definition?.status).toBe('unavailable'))
  await expect(media.handle({ kind: 'asset', id: 'historical-template' })).rejects.toThrow('workflow_asset_unavailable')
  expect(gateway.asset).toHaveBeenCalledOnce()
  controller.dispose()
})
