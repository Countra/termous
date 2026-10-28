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

it('后台运行回执和完成观察合并到原工具身份，分页缺少调用也不重复展示', () => {
  const base = { message_id: 'message', revision: 1, created_at: '', updated_at: '' }
  const run = { id: 'desktop_execution_async', revision: 3, state: 'running', accepted_actions: 1,
    steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 30000 }] }
  const result = { ...base, id: 'result', sequence: 2, kind: 'tool_result' as const,
    tool_result: { tool_call_id: 'call', tool_name: 'termous.desktops.execute', content: [{ type: 'text', text: JSON.stringify({ run, capture_state: 'pending' }) }], is_error: false } }
  const call = { ...base, id: 'call-part', sequence: 1, kind: 'tool_call' as const,
    tool_call: { tool_call_id: 'call', tool_name: 'termous.desktops.execute', arguments: {} } }
  const task = { ...base, id: 'observation', sequence: 3, kind: 'task_result' as const, task_result: {
    tool_call_id: 'call', execution_id: run.id, revision: 5,
    result: { run: { ...run, revision: 5, state: 'completed' }, capture_state: 'ready' },
    image: { resource_id: 'image', kind: 'image' as const, mime_type: 'image/png', sha256: 'a'.repeat(64), size_bytes: 100, image: { width: 1, height: 1 } },
  } }
  const message: AgentMessage = { id: 'message', session_id: 'session', role: 'assistant', status: 'streaming', sequence: 2, revision: 1, created_at: '', updated_at: '', parts: [call, result], attachments: [] }
  expect(projectAgentMessages([message], undefined, [])[0].parts[0]).toMatchObject({ id: 'call-part', status: 'running' })
  for (const parts of [[call, result, task], [result, task], [task]]) {
    const projected = projectAgentMessages([{ ...message, parts }], undefined, [])[0].parts
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({ tool_call_id: 'call', status: 'completed', desktop_batch: { state: 'completed' }, images: [{ part_id: 'observation', content_index: 1 }] })
  }
})

it.each(['wait_desktop_execution', 'termous.desktops.executions.get'])('显式 %s 的终态更新原执行记录，保持图片和调用来源', (toolName) => {
  const base = { message_id: 'message', revision: 1, created_at: '', updated_at: '' }
  const run = { id: 'desktop_execution_explicit', revision: 3, state: 'running', accepted_actions: 1,
    steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 30000 }] }
  const result = { ...base, id: 'result', sequence: 2, kind: 'tool_result' as const,
    tool_result: { tool_call_id: 'execute', tool_name: 'termous.desktops.execute', content: [{ type: 'text', text: JSON.stringify({ run, capture_state: 'pending' }) }], is_error: false } }
  const call = { ...base, id: 'call-part', sequence: 1, kind: 'tool_call' as const,
    tool_call: { tool_call_id: 'execute', tool_name: 'termous.desktops.execute', arguments: {} } }
  const terminal = { ...base, id: 'wait-result', sequence: 4, kind: 'tool_result' as const,
    tool_result: { tool_call_id: 'wait', tool_name: toolName,
      content: [{ type: 'text', text: JSON.stringify({ run: { ...run, revision: 5, state: 'completed' }, capture_state: 'ready' }) }],
      is_error: false, images: [{ content_index: 1, mime_type: 'image/png', size_bytes: 100 }] } }
  const message: AgentMessage = { id: 'message', session_id: 'session', role: 'assistant', status: 'completed', sequence: 2, revision: 1, created_at: '', updated_at: '', parts: [call, result], attachments: [] }
  for (const parts of [[call, result], [result]]) {
    const same = projectAgentMessages([{ ...message, parts: [...parts, terminal] }], undefined, [])[0].parts
    const split = projectAgentMessages([{ ...message, parts }, { ...message, id: 'next', sequence: 3, parts: [{ ...terminal, message_id: 'next' }] }], undefined, [])[0].parts
    for (const projected of [same, split]) {
      expect(projected[0]).toMatchObject({ tool_call_id: 'execute', name: 'termous.desktops.execute', status: 'completed',
        desktop_batch: { state: 'completed' }, images: [{ part_id: 'wait-result' }] })
    }
    const isolated = projectAgentMessages([{ ...message, parts }, { ...message, session_id: 'other', parts: [terminal] }], undefined, [])[0].parts
    expect(isolated[0]).toMatchObject({ status: 'running' })
  }
})
