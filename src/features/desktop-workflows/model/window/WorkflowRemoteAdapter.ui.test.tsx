import { expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorkflowDetachedCommand } from '#common/contracts'
import type { WorkflowGateway } from '#entities/desktop-workflow'
import type { DetachedClient } from '#shared/detached-window'
import { WorkflowController } from '../workspace/WorkflowController'
import { WorkflowRemoteAdapter } from './WorkflowRemoteAdapter'
import { WorkflowSurfaceAdapter } from './WorkflowSurfaceAdapter'
import { WorkflowCatalog } from '../../ui/catalog/WorkflowCatalog'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture() {
  const controller = new WorkflowController({} as WorkflowGateway)
  controller.actions.create('原始名称')
  const host = new WorkflowSurfaceAdapter(controller)
  const deliver = (command: WorkflowDetachedCommand) => host.handle({
    connection: { module: 'desktop-workflow', instance: 'workspace', generation: 'test' },
    kind: 'request', operation: 'command', payload: command,
  })
  const request = vi.fn<(operation: string, command: WorkflowDetachedCommand, timeout: number, id?: string) => ReturnType<typeof deliver>>(
    (_operation, command) => deliver(structuredClone(command)),
  )
  const report = vi.fn()
  const remote = new WorkflowRemoteAdapter({ peer: { request } } as unknown as DetachedClient, report)
  remote.interactive = true
  const connect = () => {
    const { state, execution, environment, scripts, runs, loading, dataError, target } = controller.getSnapshot()
    return remote.connect({ state, execution, environment, scripts, runs, loading, dataError, target }, host.inputSequence)
  }
  return { controller, host, remote, request, deliver, connect, report }
}

it('实际点击独立窗口目录刷新按钮不把点击事件传入命令', async () => {
  const f = fixture()
  const refresh = vi.spyOn(f.controller.actions, 'refresh').mockResolvedValue(undefined)
  try {
    render(<WorkflowCatalog scripts={[]} runs={[]} view="scripts" busy={false} loading={false}
      collapsed={false} queries={{ scripts: '', runs: '' }} runFilter="all"
      onCreate={vi.fn()} onSelectScript={vi.fn()} onSelectRun={vi.fn()} onViewChange={vi.fn()}
      onToggle={vi.fn()} onQueriesChange={vi.fn()} onRunFilterChange={vi.fn()} onRefresh={f.connect().actions.refresh} />)
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.refresh' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledExactlyOnceWith())
    expect(f.report).not.toHaveBeenCalled()
  } finally { f.controller.dispose() }
})

it('模板来源随草稿跨窗口传递，并在宿主回执后保留独立查找区域', async () => {
  const f = fixture()
  const source = { region: { x: 100, y: 50, width: 200, height: 100 }, reference_width: 1000, reference_height: 500 }
  const definition = { schema_version: 1 as const, parameters: [], steps: [{ id: 'image', name: '', kind: 'image.assert' as const, action: {},
    image: { asset_id: 'template', offset: { x: 0, y: 0 }, template_source: source, region: { x: 0, y: 0, width: 900, height: 400 }, reference_width: 1000, reference_height: 500 } }] }
  try {
    const actions = f.connect().actions
    await actions.change({ definition })
    await f.remote.flush()
    expect(f.controller.getSnapshot().state.draft?.definition).toEqual(definition)
    expect(f.connect().state.draft?.definition).toEqual(definition)
  } finally { f.controller.dispose() }
})

it('输入发送失败后阻止后续补丁越过，显式重试保留每条修改和请求标识', async () => {
  const f = fixture()
  f.request.mockRejectedValueOnce(new Error('发送失败'))
  const actions = f.connect().actions
  const first = actions.change({ name: '修改名称' })
  const second = actions.change({ description: '补充说明' })
  const third = actions.presentation({ catalogCollapsed: true })
  await Promise.allSettled([first, second, third])
  expect(f.request).toHaveBeenCalledTimes(1)
  expect(f.controller.getSnapshot().state.draft?.name).toBe('原始名称')
  expect(f.connect().state.draft).toMatchObject({ name: '修改名称', description: '补充说明' })
  await expect(actions.save()).rejects.toThrow('detached_receipt_unconfirmed')
  expect(f.request).toHaveBeenCalledTimes(1)
  await f.remote.flush()
  expect(f.request).toHaveBeenCalledTimes(4)
  expect(f.request.mock.calls[1]).toEqual(f.request.mock.calls[0])
  expect(f.controller.getSnapshot().state.draft).toMatchObject({ name: '修改名称', description: '补充说明' })
  expect(f.controller.getSnapshot().state.presentation.catalogCollapsed).toBe(true)
  expect(f.host.inputSequence).toBe(3)
  f.controller.dispose()
})

it('宿主应用输入后回执丢失，重试只补确认并按序发送剩余输入', async () => {
  const f = fixture()
  const change = vi.spyOn(f.controller.actions, 'change')
  f.request.mockImplementationOnce(async (_operation, command) => {
    await f.deliver(command)
    throw new Error('回执丢失')
  })
  const actions = f.connect().actions
  const first = actions.change({ name: '已接收名称' })
  const second = actions.change({ description: '后续说明' })
  await Promise.allSettled([first, second])
  expect(f.connect().state.draft).toMatchObject({ name: '已接收名称', description: '后续说明' })
  await f.remote.flush()
  expect(change).toHaveBeenCalledTimes(2)
  expect(f.request.mock.calls[1]).toEqual(f.request.mock.calls[0])
  expect(f.host.inputSequence).toBe(2)
  expect(f.controller.getSnapshot().state.draft).toMatchObject({ name: '已接收名称', description: '后续说明' })
  f.controller.dispose()
})

it('收回窗口等待尚未开始上传的媒体编辑，并确认其最后一次草稿写入', async () => {
  const f = fixture()
  const actions = f.connect().actions
  let encode!: () => void
  const task = new Promise<void>(resolve => { encode = resolve }).then(() => actions.change({ description: '裁剪上传后的模板配置' }))
  f.remote.trackMediaTask(task)
  let returned = false
  const handoff = f.remote.flush().then(() => { returned = true })
  await Promise.resolve()
  expect(returned).toBe(false)
  expect(f.request).not.toHaveBeenCalled()
  encode()
  await handoff
  expect(f.controller.getSnapshot().state.draft?.description).toBe('裁剪上传后的模板配置')
  f.controller.dispose()
})
