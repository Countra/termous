import { describe, expect, it } from 'vitest'
import type { AgentMessage, AgentRunEvent } from '#entities/agent'
import { createAgentMessageProjector } from './agentMessageProjectionCache.ts'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

const historical: AgentMessage = {
  id: 'old', session_id: 'session', role: 'assistant', status: 'completed', sequence: 1, revision: 1,
  created_at: '', updated_at: '', attachments: [],
  parts: [{ id: 'text', message_id: 'old', kind: 'text', sequence: 1, revision: 1, text: '历史内容', created_at: '', updated_at: '' }],
}

describe('消息投影缓存', () => {
  it('连续输出只更新当前实体，历史投影复用且与无缓存投影一致', () => {
    const project = createAgentMessageProjector()
    let active: AgentMessage = { ...historical, id: 'active', status: 'streaming', sequence: 2 }
    const first = project([historical, active], undefined, [])
    for (let index = 0; index < 8; index++) {
      active = { ...active, revision: index + 2 }
      const projected = project([historical, active], undefined, [])
      expect(projected).toEqual(projectAgentMessages([historical, active], undefined, []))
      expect(projected[0]).toBe(first[0])
      expect(projected[1]).toBe(first[1])
    }
    const revised = { ...historical, status: 'failed' as const }
    expect(project([revised], undefined, [])[0]).not.toBe(first[0])
    expect(project([revised], undefined, [])[0]?.status).toBe('failed')
  })

  it('同一活动实体的推理片段完成事件不能被缓存隐藏', () => {
    const project = createAgentMessageProjector()
    const reasoning = { ...historical.parts[0]!, kind: 'reasoning' as const, text: '推理内容' }
    const active = { ...historical, status: 'streaming' as const, parts: [reasoning] }
    const initial = project([active], undefined, [])
    const event: AgentRunEvent = { id: 'event', run_id: 'run', generation: 1, sequence: 1,
      kind: 'message_part', payload: { message_part: reasoning }, created_at: '' }
    const updated = project([active], undefined, [event])
    expect(initial[0]?.parts[0]).toMatchObject({ streaming: true })
    expect(updated[0]?.parts[0]).toMatchObject({ streaming: false })
  })

  it('同一长消息输出时复用未变化片段，内容或状态变化及时可见', () => {
    const project = createAgentMessageProjector()
    const original = historical.parts[0]!
    if (original.kind !== 'text') throw new Error('测试需要文字片段')
    const parts = Array.from({ length: 199 }, (_, index) => ({ ...original, id: `text-${index}`, sequence: index + 1 }))
    const active = { ...historical, status: 'streaming' as const, parts }
    const first = project([active], undefined, [])
    const next = project([{ ...active, parts: [...parts, { ...parts[0]!, id: 'latest', sequence: 200, text: '新增正文' }] }], undefined, [])
    expect(next[0]!.parts).toHaveLength(200)
    for (let i = 0; i < 199; i++) expect(next[0]!.parts[i]).toBe(first[0]!.parts[i])
    const changed = project([{ ...active, parts: [{ ...parts[0]!, text: '修订正文' }, ...parts.slice(1)] }], undefined, [])
    expect(changed[0]!.parts[0]).not.toBe(first[0]!.parts[0])
    expect(changed[0]!.parts[0]).toMatchObject({ text: '修订正文' })
    expect(project([], undefined, [])).toEqual([])
  })
})
