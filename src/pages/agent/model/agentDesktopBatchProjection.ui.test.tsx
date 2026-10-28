import { expect, it } from 'vitest'
import type { AgentMessage } from '#entities/agent'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

it('批次结构读取完整结果，失败回执和分页孤立结果仍保留步骤与图片', () => {
  const receipt = { run: { id: 'desktop_execution_test', state: 'stopped', accepted_actions: 1,
    steps: [{ index: 0, kind: 'pointer.click', state: 'accepted', wait_after_ms: 100 }, { index: 1, kind: 'keyboard.text', state: 'failed', wait_after_ms: 0 }] },
  capture_state: 'ready', diagnostic: '合成字段'.repeat(6000) }
  const result = { id: 'result', message_id: 'message', sequence: 2, revision: 1, created_at: '', updated_at: '', kind: 'tool_result' as const,
    tool_result: { tool_call_id: 'call', tool_name: 'termous.desktops.execute', content: [{ type: 'text', text: JSON.stringify(receipt) }], is_error: true,
      images: [{ content_index: 1, mime_type: 'image/png', size_bytes: 100 }] } }
  const message: AgentMessage = { id: 'message', session_id: 'session', role: 'assistant', status: 'completed', sequence: 2, revision: 1, created_at: '', updated_at: '', parts: [result], attachments: [] }
  const call = { ...result, id: 'call-part', sequence: 1, kind: 'tool_call' as const,
    tool_call: { tool_call_id: 'call', tool_name: 'termous.desktops.execute', arguments: { actions: [{ kind: 'pointer.click', x: 1, y: 2 }] } } }
  for (const parts of [[result], [call, result]]) {
    const projected = projectAgentMessages([{ ...message, parts }], undefined, [])[0].parts
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({ status: 'failed', desktop_batch: { accepted_actions: 1, steps: [{ state: 'accepted' }, { state: 'failed' }] }, images: [{ content_index: 1, part_id: 'result' }] })
  }
})
