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
      expect(projected[1]).not.toBe(first[1])
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
})
