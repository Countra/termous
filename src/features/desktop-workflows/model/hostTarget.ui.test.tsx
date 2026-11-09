import { expect, test, vi } from 'vitest'
import { hostDesktopTargetKey, isWorkflowDetachedCommand, isWorkflowDetachedMedia, type HostDesktopTarget } from '#common/contracts'
import type { Script, WorkflowGateway } from '#entities/desktop-workflow'
import { isTargetAvailable } from './target'
import { WorkflowExecution } from './workspace/WorkflowExecution'

const target: HostDesktopTarget = { kind: 'host_desktop', instance_id: 'core', host: { id: 'screen', kind: 'screen', generation: 2, title: 'Display' } }
const selection = { mode: 'host' as const, id: hostDesktopTargetKey(target), host: target }

test('本机运行传递精确来源，不合成协议会话', async () => {
  const start = vi.fn().mockResolvedValue({ id: 'run' })
  const execution = new WorkflowExecution({ start } as unknown as WorkflowGateway, vi.fn())
  execution.environment = { sessions: [], profiles: [], hostSources: [{ target, name: 'Display', read_only: false }] }
  execution.open({ id: 'script', revision: 1 } as Script, { schema_version: 1, parameters: [], steps: [] }, selection, false)
  await execution.start()
  expect(start).toHaveBeenCalledOnce()
  const request = start.mock.calls[0]![0]
  expect(request.target).toEqual(target)
  expect(request).not.toHaveProperty('session_id')
  expect(request).not.toHaveProperty('profile_id')
})

test('来源代次或 Core 身份变化必须重选，独立窗口保留同一合同', () => {
  const sources = [{ target, name: 'Display', read_only: false }]
  expect(isTargetAvailable(selection, [], [], sources)).toBe(true)
  expect(isTargetAvailable({ ...selection, host: { ...target, instance_id: 'restarted' } }, [], [], sources)).toBe(false)
  expect(isTargetAvailable({ ...selection, host: { ...target, host: { ...target.host, generation: 3 } } }, [], [], sources)).toBe(false)
  expect(isWorkflowDetachedCommand({ name: 'target', args: [selection], inputSequence: 1 })).toBe(true)
  expect(isWorkflowDetachedMedia({ kind: 'open-host', target })).toBe(true)
  expect(isWorkflowDetachedMedia({ kind: 'open-host', target: { ...target, instance_id: '' } })).toBe(false)
})
