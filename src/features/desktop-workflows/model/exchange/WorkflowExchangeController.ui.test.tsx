import { afterEach, expect, it, vi } from 'vitest'
import type { WorkflowFileBridge } from '#common/contracts'
import type { WorkflowImportView, WorkflowImportReceipt } from '#entities/desktop-workflow'
import { WorkflowController } from '../workspace/WorkflowController'
import { WorkflowClient } from '../../api/WorkflowClient'
import { WorkflowExchangeClient } from '../../api/WorkflowExchangeClient'
import { WorkflowSurfaceAdapter } from '../window/WorkflowSurfaceAdapter'

const definition = { schema_version: 2 as const, parameters: [], steps: [] }
const script = { id: 'script', name: '导入结果', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
const receipt: WorkflowImportReceipt = { import_id: 'import', script, created_at: '' }
const preview: WorkflowImportView = { id: 'import', state: 'ready', manifest: { format: 'termous.desktop-workflow', format_version: 1, name: '导入结果', description: '', tags: [], definition, assets: [] } }
function setup() {
  const requests = vi.fn(async (request: URL | RequestInfo, options?: RequestInit): Promise<Response> => {
    const url = new URL(String(request))
    if (url.pathname.endsWith('/commit')) return Response.json(receipt)
    if (url.pathname.endsWith('/imports/import')) return options?.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(preview)
    if (url.pathname.endsWith('/script')) return Response.json({ script, version: { script_id: 'script', number: 1, definition, created_at: '' } })
    throw new Error(`未声明请求 ${url.pathname}`)
  })
  vi.stubGlobal('fetch', requests)
  const files: WorkflowFileBridge = { run: vi.fn(async () => ({ import_id: 'import' })), cancel: vi.fn(async () => {}), onProgress: () => () => {} }
  const config = { apiBaseUrl: 'http://127.0.0.1:8122', apiToken: '' }
  const controller = new WorkflowController(new WorkflowClient(config), new WorkflowExchangeClient(config), files)
  return { controller, requests, files }
}
afterEach(() => vi.unstubAllGlobals())

it('导入新建完成后打开编辑器，原生 IPC 仅返回预览标识', async () => {
  const { controller, files } = setup()
  try {
    await controller.actions.exchange!({ kind: 'import' })
    expect(controller.getSnapshot().state.exchange?.preview?.manifest?.name).toBe('导入结果')
    await controller.actions.exchange!({ kind: 'commit' })
    expect(controller.getSnapshot().state.draft?.script?.id).toBe('script')
    expect(controller.getSnapshot().state.exchange?.receipt).toEqual(receipt)
    expect(files.run).toHaveBeenCalledWith(expect.objectContaining({ kind: 'import', operation_id: expect.any(String) }))
  } finally { controller.dispose() }
})

it('提交响应丢失查询持久回执，不重复创建版本', async () => {
  const { controller, requests } = setup()
  try {
    await controller.actions.exchange!({ kind: 'import' })
    requests.mockResolvedValueOnce(Response.json({ error: { code: 'timeout', message: 'timeout' } }, { status: 504 }))
    requests.mockResolvedValueOnce(Response.json({ id: 'import', state: 'committed', receipt }))
    await controller.actions.exchange!({ kind: 'commit' })
    expect(controller.getSnapshot().state.exchange?.receipt).toEqual(receipt)
    expect(requests.mock.calls.filter(([url]) => String(url).endsWith('/commit'))).toHaveLength(1)
  } finally { controller.dispose() }
})

it('提交等待期间切换草稿，迟到成功只刷新库并保留新草稿', async () => {
  const { controller, requests } = setup()
  try {
    await controller.actions.exchange!({ kind: 'import' })
    let complete!: (value: Response) => void
    requests.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    const pending = controller.actions.exchange!({ kind: 'commit' })
    await vi.waitFor(() => expect(complete).toBeDefined())
    controller.actions.create('新的草稿')
    complete(Response.json(receipt)); await pending
    expect(controller.getSnapshot().state.draft?.name).toBe('新的草稿')
    expect(controller.getSnapshot().state.dirty).toBe(true)
  } finally { controller.dispose() }
})

it('更新冲突需要重新读取目标，不能自动换修订重试', async () => {
  const { controller, requests } = setup()
  try {
    await controller.actions.exchange!({ kind: 'import' }); await controller.actions.exchange!({ kind: 'target', id: 'script' })
    requests.mockResolvedValueOnce(Response.json({ error: { code: 'desktop_workflow_revision_conflict', message: 'conflict' } }, { status: 409 }))
    await controller.actions.exchange!({ kind: 'commit' })
    expect(controller.getSnapshot().state.exchange?.conflict).toBe(true)
    const count = requests.mock.calls.length
    await controller.actions.exchange!({ kind: 'commit' })
    expect(requests.mock.calls).toHaveLength(count)
    await controller.actions.exchange!({ kind: 'target', id: 'script' })
    expect(controller.getSnapshot().state.exchange?.conflict).toBe(false)
  } finally { controller.dispose() }
})

it('独立窗口从可信连接转发原生对话框归属，未保存当前版本拒绝导出', async () => {
  const { controller, files } = setup()
  try {
    const adapter = new WorkflowSurfaceAdapter(controller)
    const connection = { module: 'desktop-workflow', instance: 'workspace', generation: 'generation' }
    await adapter.handle({ connection, kind: 'request', operation: 'command', payload: { name: 'exchange', args: [{ kind: 'import' }] } })
    expect(files.run).toHaveBeenCalledWith(expect.objectContaining({ origin: connection }))
    await controller.actions.exchange!({ kind: 'commit' })
    controller.actions.change({ name: '修改后' })
    await controller.actions.exchange!({ kind: 'export', layout: 'zip' })
    expect(controller.getSnapshot().state.exchange?.error?.code).toBe('workflow_exchange_save_first')
    expect(files.run).toHaveBeenCalledTimes(1)
  } finally { controller.dispose() }
})

it('独立窗口迟到的提交不能覆盖另一编辑上下文', async () => {
  const { controller, requests } = setup()
  try {
    await controller.actions.exchange!({ kind: 'import' })
    controller.actions.create('原草稿')
    const owner = controller.getSnapshot().state.draft!.editingID
    controller.actions.create('新草稿')
    const adapter = new WorkflowSurfaceAdapter(controller)
    const response = await adapter.handle({ connection: { module: 'desktop-workflow', instance: 'workspace', generation: 'generation' },
      kind: 'request', operation: 'command', payload: { name: 'exchange', owner, args: [{ kind: 'commit' }] } })
    expect(response).toMatchObject({ ok: false, error: { message: 'workflow_editor_changed' } })
    expect(requests.mock.calls.some(([url]) => String(url).endsWith('/commit'))).toBe(false)
    expect(controller.getSnapshot().state.draft?.name).toBe('新草稿')
  } finally { controller.dispose() }
})
