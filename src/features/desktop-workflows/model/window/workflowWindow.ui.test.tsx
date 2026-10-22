import { waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { Definition, Run, WorkflowGateway } from '#entities/desktop-workflow'
import { WorkflowController } from '../workspace/WorkflowController'
import { WorkflowSurfaceAdapter } from './WorkflowSurfaceAdapter'
import { WorkflowMediaHost } from './WorkflowMediaHost'

const connection = { module: 'desktop-workflow', instance: 'workspace', generation: 'test' }

it('独立窗口接收宿主提供的真实推理设备，不依赖组件检查记录', async () => {
  const { controller } = fixture()
  controller.runtimeStatus = async () => ({ service: { state: 'ready', device: 'cuda' } })
  const media = new WorkflowMediaHost(controller.media, controller)
  expect(await media.handle({ kind: 'runtime-status' })).toEqual({ service: { state: 'ready', device: 'cuda' } })
  controller.dispose()
})

it('独立窗口分析校验预览归属，取消只影响同一预览的请求', async () => {
  const { gateway, controller } = fixture()
  gateway.analyze = vi.fn().mockImplementation((_id, signal: AbortSignal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))))
  gateway.analysisImage = vi.fn()
  vi.mocked(gateway.openPreview).mockResolvedValue({ id: 'owned', state: 'ready' })
  const media = new WorkflowMediaHost(gateway, controller)
  await expect(media.handle({ kind: 'analyze', id: 'foreign', requestID: 'request' })).rejects.toThrow('workflow_preview_unavailable')
  await media.handle({ kind: 'open', session: 'desktop', generation: 1 })
  const pending = media.handle({ kind: 'analyze', id: 'owned', requestID: 'request' })
  const rejection = expect(pending).rejects.toThrow('Cancelled')
  await media.handle({ kind: 'analysis-cancel', id: 'owned', requestID: 'request' })
  await rejection
  await expect(media.handle({ kind: 'analysis-image', id: 'foreign', analysisID: 'analysis', image: 'original' })).rejects.toThrow('workflow_preview_unavailable')
  expect(gateway.analysisImage).not.toHaveBeenCalled()
  await media.reset(); controller.dispose()
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
