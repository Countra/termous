import { expect, it, vi } from 'vitest'
import type { WorkflowFileBridge, WorkflowFileProgress, WorkflowFileResponse } from '#common/contracts'
import type { WorkflowExchangeGateway, WorkflowGateway, WorkflowImportReceipt, WorkflowImportView } from '#entities/desktop-workflow'
import { WorkflowExchangeController } from './WorkflowExchangeController'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function setup() {
  const listeners = new Set<(value: WorkflowFileProgress) => void>()
  const files: WorkflowFileBridge = { run: vi.fn(), openDirectory: vi.fn(async () => ({})), cancel: vi.fn(async () => {}),
    onProgress: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } }
  const gateway: WorkflowExchangeGateway = { inspect: vi.fn(), commit: vi.fn(), release: vi.fn(async () => {}), asset: vi.fn() }
  const host = { context: () => ({ dirty: false, token: 'editor' }), changed: vi.fn(), committed: vi.fn(async () => {}) }
  const controller = new WorkflowExchangeController(gateway, files, {} as WorkflowGateway, host)
  return { controller, gateway, files, listeners, host }
}

it('取消正在读取的导入预览会释放资源，不显示失败对话框', async () => {
  const { controller, files, gateway } = setup()
  vi.mocked(files.run).mockResolvedValue({ import_id: 'import' })
  vi.mocked(gateway.inspect).mockImplementation((_id, signal) => new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('取消读取', 'AbortError')), { once: true })
  }))
  controller.activate()
  const pending = controller.dispatch({ kind: 'import' })
  await vi.waitFor(() => expect(gateway.inspect).toHaveBeenCalled())
  await controller.dispatch({ kind: 'cancel' }); await pending
  expect(gateway.release).toHaveBeenCalledWith('import')
  expect(controller.getSnapshot()).toMatchObject({ busy: false })
  expect(controller.getSnapshot().error).toBeUndefined()
  expect(controller.getSnapshot().preview).toBeUndefined()
  controller.dispose()
})

it('释放旧预览期间取消导入，不再打开新文件选择框或保留已释放预览', async () => {
  const { controller, files, gateway } = setup()
  const releasing = deferred<void>()
  vi.mocked(files.run).mockResolvedValue({ import_id: 'old' })
  vi.mocked(gateway.inspect).mockResolvedValue({ id: 'old', state: 'ready' })
  controller.activate()
  await controller.dispatch({ kind: 'import' })
  vi.mocked(gateway.release).mockReturnValueOnce(releasing.promise)
  const pending = controller.dispatch({ kind: 'import' })
  expect(gateway.release).toHaveBeenCalledWith('old')
  await controller.dispatch({ kind: 'cancel' })
  releasing.resolve(); await pending
  expect(files.run).toHaveBeenCalledOnce()
  expect(controller.getSnapshot()).toMatchObject({ busy: false })
  expect(controller.getSnapshot().preview).toBeUndefined()
  expect(controller.getSnapshot().error).toBeUndefined()
  controller.dispose()
})

it('重试遇到仍在提交的会话时继续锁定原参数', async () => {
  const { controller, files, gateway } = setup()
  vi.mocked(files.run).mockResolvedValue({ import_id: 'import' })
  vi.mocked(gateway.inspect).mockResolvedValueOnce({ id: 'import', state: 'ready' }).mockResolvedValue({ id: 'import', state: 'committing' })
  vi.mocked(gateway.commit).mockRejectedValue(Object.assign(new Error('busy'), { status: 429, code: 'desktop_workflow_exchange_busy' }))
  controller.activate()
  await controller.dispatch({ kind: 'import' })
  await controller.dispatch({ kind: 'name', name: '原名称' })
  await controller.dispatch({ kind: 'commit' })
  expect(controller.getSnapshot().uncertain).toBe(true)
  await controller.dispatch({ kind: 'name', name: '不能改名' })
  await controller.dispatch({ kind: 'commit' })
  expect(vi.mocked(gateway.commit).mock.calls.map(call => call[1])).toEqual([
    { mode: 'create', name: '原名称' }, { mode: 'create', name: '原名称' },
  ])
  controller.dispose()
})

it('构造不订阅，重复激活和清理只保留当前挂载的一份监听', () => {
  const { controller, listeners } = setup()
  expect(listeners.size).toBe(0)
  controller.activate(); controller.activate()
  expect(listeners.size).toBe(1)
  controller.dispose(); controller.dispose()
  expect(listeners.size).toBe(0)
  controller.activate()
  expect(listeners.size).toBe(1)
  controller.dispose()
})

it('重新挂载后的操作不被上一次原生请求的迟到回执或 finally 覆盖', async () => {
  const { controller, files, gateway } = setup()
  const old = deferred<WorkflowFileResponse>(), next = deferred<WorkflowFileResponse>()
  vi.mocked(files.run).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
  vi.mocked(gateway.inspect).mockResolvedValue({ id: 'next', state: 'ready' })
  controller.activate()
  const first = controller.dispatch({ kind: 'import' })
  controller.dispose(); controller.activate()
  const second = controller.dispatch({ kind: 'import' })
  old.resolve({ import_id: 'old' }); await first
  expect(gateway.release).toHaveBeenCalledWith('old')
  expect(controller.getSnapshot().busy).toBe(true)
  expect(controller.getSnapshot().preview).toBeUndefined()
  next.resolve({ import_id: 'next' }); await second
  expect(controller.getSnapshot().preview?.id).toBe('next')
  expect(controller.getSnapshot().busy).toBe(false)
  controller.dispose()
})

it('预览读取期间卸载会释放预览，迟到数据不会重开对话框', async () => {
  const { controller, files, gateway } = setup()
  const reading = deferred<WorkflowImportView>()
  vi.mocked(files.run).mockResolvedValue({ import_id: 'old' })
  vi.mocked(gateway.inspect).mockReturnValue(reading.promise)
  controller.activate()
  const pending = controller.dispatch({ kind: 'import' })
  await vi.waitFor(() => expect(gateway.inspect).toHaveBeenCalled())
  controller.dispose(); controller.activate()
  reading.resolve({ id: 'old', state: 'ready' }); await pending
  expect(gateway.release).toHaveBeenCalledWith('old')
  expect(controller.getSnapshot().preview).toBeUndefined()
  expect(controller.getSnapshot().error).toBeUndefined()
  controller.dispose()
})

it('提交中卸载保留待确认参数，重新挂载后按原请求查询重试', async () => {
  const { controller, files, gateway, host } = setup()
  const pending = deferred<WorkflowImportReceipt>()
  const receipt: WorkflowImportReceipt = { import_id: 'import', created_at: '', script: {
    id: 'script', name: '原名称', description: '', tags: [], revision: 1, created_at: '', updated_at: '',
  } }
  vi.mocked(files.run).mockResolvedValue({ import_id: 'import' })
  vi.mocked(gateway.inspect).mockResolvedValue({ id: 'import', state: 'ready' })
  vi.mocked(gateway.commit).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(receipt)
  controller.activate()
  await controller.dispatch({ kind: 'import' })
  await controller.dispatch({ kind: 'name', name: '原名称' })
  const first = controller.dispatch({ kind: 'commit' })
  controller.dispose(); controller.activate()
  expect(controller.getSnapshot().uncertain).toBe(true)
  expect(gateway.release).not.toHaveBeenCalled()
  await controller.dispatch({ kind: 'name', name: '不能覆盖' })
  pending.resolve(receipt); await first
  expect(host.committed).not.toHaveBeenCalled()
  await controller.dispatch({ kind: 'commit' })
  expect(vi.mocked(gateway.commit).mock.calls.map(call => call[1])).toEqual([
    { mode: 'create', name: '原名称' }, { mode: 'create', name: '原名称' },
  ])
  expect(controller.getSnapshot().receipt).toEqual(receipt)
  expect(host.committed).toHaveBeenCalledOnce()
  controller.dispose()
})

it('关闭旧预览的迟到释放结果不能清空重新挂载后的新预览', async () => {
  const { controller, files, gateway } = setup()
  const releasing = deferred<void>()
  vi.mocked(files.run).mockResolvedValueOnce({ import_id: 'old' }).mockResolvedValueOnce({ import_id: 'next' })
  vi.mocked(gateway.inspect).mockResolvedValueOnce({ id: 'old', state: 'ready' }).mockResolvedValueOnce({ id: 'next', state: 'ready' })
  controller.activate()
  await controller.dispatch({ kind: 'import' })
  vi.mocked(gateway.release).mockReturnValueOnce(releasing.promise)
  const close = controller.dispatch({ kind: 'close' })
  controller.dispose(); controller.activate()
  await controller.dispatch({ kind: 'import' })
  releasing.resolve(); await close
  expect(controller.getSnapshot().preview?.id).toBe('next')
  controller.dispose()
})
