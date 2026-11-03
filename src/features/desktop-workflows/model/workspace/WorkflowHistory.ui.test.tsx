import { expect, it, vi } from 'vitest'
import type { Definition, WorkflowGateway } from '#entities/desktop-workflow'
import { WorkflowController } from './WorkflowController'

it.each(['create', 'load', 'copy', 'remove'] as const)('%s 切换编辑上下文后不保留原流程的版本列表', async action => {
  const definition: Definition = { schema_version: 2, parameters: [], steps: [] }
  const gateway = {
    get: vi.fn(async (id: string) => ({ script: { id, name: id, revision: 2, description: '', tags: [], created_at: '', updated_at: '' },
      version: { script_id: id, number: 2, definition, created_at: '' } })),
    versions: vi.fn(async (id: string) => [{ script_id: id, number: 1, name: '旧名称', definition, created_at: '' }]),
    remove: vi.fn(async () => {}),
  } as unknown as WorkflowGateway
  const controller = new WorkflowController(gateway)
  try {
    await controller.actions.load('first')
    await controller.actions.history()
    expect(controller.getSnapshot().state.versions?.[0].script_id).toBe('first')
    if (action === 'create') controller.actions.create('新建流程')
    if (action === 'load') await controller.actions.load('second')
    if (action === 'copy') controller.actions.copy('流程副本')
    if (action === 'remove') await controller.actions.remove()
    expect(controller.getSnapshot().state.versions).toBeUndefined()
    if (action === 'load') {
      await controller.actions.history()
      expect(controller.getSnapshot().state.versions?.[0].script_id).toBe('second')
    }
  } finally { controller.dispose() }
})
