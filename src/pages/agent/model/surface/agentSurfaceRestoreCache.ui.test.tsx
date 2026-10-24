import { expect, it } from 'vitest'
import { AgentSurfaceRestoreCache } from './agentSurfaceRestoreCache.ts'
import { restoreAgentSurface } from './agentSurfaceProjection.ts'

function fixture() {
  return {
    'workspace.messageIds': ['one', 'two'],
    'message:workspace:one': { id: 'one', role: 'assistant', partIds: ['first', 'second'] },
    'message:workspace:two': { id: 'two', role: 'user', partIds: ['third'] },
    'part:workspace:one:first': { id: 'first', kind: 'text', text: '历史' },
    'part:workspace:one:second': { id: 'second', kind: 'text', text: '正在输出' },
    'part:workspace:two:third': { id: 'third', kind: 'text', text: '问题' },
    'workspace.session_management': { pendingIds: ['pending'] },
    'archive.pendingIds': ['archived'],
  }
}

it('输入确认及其他面板更新复用消息和待处理集合，正文变化只替换所属消息', () => {
  const cache = new AgentSurfaceRestoreCache()
  const partitions = fixture()
  const before = restoreAgentSurface(partitions, cache)
  const ack = restoreAgentSurface({ ...partitions, 'workspace.draft': '新草稿', inputSequence: 12 }, cache)
  expect(ack.workspace!.messages).toBe(before.workspace!.messages)
  expect(ack.workspace!.session_management!.pendingIds).toBe(before.workspace!.session_management!.pendingIds)
  expect(ack.archive!.pendingIds).toBe(before.archive!.pendingIds)
  const stream = restoreAgentSurface({ ...partitions,
    'part:workspace:one:second': { id: 'second', kind: 'text', text: '新的输出' },
  }, cache)
  expect(stream.workspace!.messages).not.toBe(ack.workspace!.messages)
  expect(stream.workspace!.messages[1]).toBe(ack.workspace!.messages[1])
  expect(stream.workspace!.messages[0].parts[0]).toBe(ack.workspace!.messages[0].parts[0])
  expect(stream.workspace!.messages[0].parts[1]).toMatchObject({ text: '新的输出' })
})

it('消息重排、删除、元数据和待处理集合更新均生效，旧窗口条目及时移除', () => {
  const cache = new AgentSurfaceRestoreCache()
  const partitions = fixture()
  const before = restoreAgentSurface(partitions, cache)
  const reordered = restoreAgentSurface({ ...partitions, 'workspace.messageIds': ['two', 'one'] }, cache)
  expect(reordered.workspace!.messages).toEqual([before.workspace!.messages[1], before.workspace!.messages[0]])
  const removed = restoreAgentSurface({ ...partitions, 'workspace.messageIds': ['two'],
    'message:workspace:two': { ...partitions['message:workspace:two'], status: 'failed' },
    'workspace.session_management': { pendingIds: [] },
  }, cache)
  expect(removed.workspace!.messages).toHaveLength(1)
  expect(removed.workspace!.messages[0]).toMatchObject({ id: 'two', status: 'failed' })
  expect(removed.workspace!.session_management!.pendingIds.size).toBe(0)
  const returned = restoreAgentSurface(partitions, cache)
  expect(returned.workspace!.messages[0]).not.toBe(before.workspace!.messages[0])
  restoreAgentSurface({}, cache)
  const reopened = restoreAgentSurface(partitions, cache)
  expect(reopened.workspace!.messages[0]).not.toBe(returned.workspace!.messages[0])
})

it('同编号归档与活动消息独立，重新同步和片段删除不会还原旧正文', () => {
  const cache = new AgentSurfaceRestoreCache()
  const partitions = { ...fixture(), 'archive.messageIds': ['one'],
    'message:archive:one': { id: 'one', partIds: ['first'] },
    'part:archive:one:first': { id: 'first', kind: 'text', text: '归档正文' },
  }
  const before = restoreAgentSurface(partitions, cache)
  expect(before.archive!.messages[0].parts[0]).toMatchObject({ text: '归档正文' })
  const full = restoreAgentSurface(structuredClone(partitions), cache)
  expect(full).toEqual(before)
  const removed = restoreAgentSurface({ ...partitions,
    'message:workspace:one': { ...partitions['message:workspace:one'], partIds: ['first'] },
    'part:workspace:one:second': undefined,
  }, cache)
  expect(removed.workspace!.messages[0].parts).toEqual([partitions['part:workspace:one:first']])
  expect(removed.archive!.messages[0].parts[0]).toMatchObject({ text: '归档正文' })
})

it('元数据未变但片段分区暂时缺失时不复用旧正文，补齐后恢复原顺序', () => {
  const cache = new AgentSurfaceRestoreCache()
  const partitions = fixture()
  restoreAgentSurface(partitions, cache)
  const partial = { ...partitions, 'part:workspace:one:first': undefined }
  const missing = restoreAgentSurface(partial, cache)
  expect(missing.workspace!.messages[0].parts).toEqual([partitions['part:workspace:one:second']])
  expect(restoreAgentSurface(partial, cache)).toEqual(missing)
  const complete = restoreAgentSurface(partitions, cache)
  expect(complete.workspace!.messages[0].parts).toEqual([
    partitions['part:workspace:one:first'], partitions['part:workspace:one:second'],
  ])
})
