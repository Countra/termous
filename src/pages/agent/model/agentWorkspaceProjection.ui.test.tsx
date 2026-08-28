import { describe, expect, it } from 'vitest'
import type { AgentMessage, AgentRun, AgentRunEvent } from '#entities/agent'
import type { AgentWorkspaceSession } from '#widgets/agent-workspace'
import {
  agentRunInteractionBlocked,
  projectAgentMessages,
  selectionAfterSessionRemoval,
} from './agentWorkspaceProjection.ts'

describe('Agent 工作区页面投影', () => {
  it('仅在 Main Runtime 与当前 Run 的 generation 对齐后开放 steer', () => {
    const run = activeRun()
    expect(agentRunInteractionBlocked(run.id, run, {
      state: 'starting', active_run_id: run.id, generation: run.generation,
    })).toBe(true)
    expect(agentRunInteractionBlocked(run.id, run, {
      state: 'running', active_run_id: run.id, generation: run.generation + 1,
    })).toBe(true)
    expect(agentRunInteractionBlocked(run.id, run, {
      state: 'running', active_run_id: run.id, generation: run.generation,
    })).toBe(false)
    expect(agentRunInteractionBlocked('agr-other', run, {
      state: 'running', active_run_id: 'agr-other', generation: run.generation,
    })).toBe(true)
  })

  it('归档当前会话后优先选择相邻会话，没有剩余会话时进入新草稿态', () => {
    const sessions = [session('one'), session('two'), session('three')]

    expect(selectionAfterSessionRemoval(sessions, 'two')).toBe('three')
    expect(selectionAfterSessionRemoval(sessions, 'three')).toBe('two')
    expect(selectionAfterSessionRemoval([sessions[0]!], 'one')).toBeUndefined()
  })

  it('目标会话已不在投影中时回退到首个可见会话', () => {
    expect(selectionAfterSessionRemoval([session('one'), session('two')], 'missing')).toBe('one')
  })

  it('将尚未开始输出的消息投影为流式状态', () => {
    const message: AgentMessage = {
      id: 'message-one',
      session_id: 'session-one',
      role: 'assistant',
      status: 'pending',
      sequence: 1,
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
      parts: [],
    }

    expect(projectAgentMessages([message], undefined, [])[0]?.status).toBe('streaming')
  })

  it('reasoning 最终 Part 到达后立即收起，不等待整条消息结束', () => {
    const message: AgentMessage = {
      id: 'message-assistant',
      session_id: 'session-one',
      role: 'assistant',
      status: 'streaming',
      sequence: 2,
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:01Z',
      parts: [{
        id: 'part-reasoning',
        message_id: 'message-assistant',
        sequence: 1,
        revision: 1,
        created_at: '2026-08-29T00:00:00Z',
        updated_at: '2026-08-29T00:00:01Z',
        kind: 'reasoning',
        text: '已完成的分析',
      }],
    }
    const finalPart: AgentRunEvent = {
      id: 'event-part',
      run_id: 'agr-current',
      generation: 2,
      sequence: 2,
      kind: 'message_part',
      payload: { message_part: message.parts[0]! },
      created_at: '2026-08-29T00:00:01Z',
    }

    const before = projectAgentMessages([message], activeRun(), [])[0]?.parts[0]
    const after = projectAgentMessages([message], activeRun(), [finalPart])[0]?.parts[0]
    expect(before?.kind === 'reasoning' && before.streaming).toBe(true)
    expect(after?.kind === 'reasoning' && after.streaming).toBe(false)
  })
})

function session(id: string): AgentWorkspaceSession {
  return {
    id,
    title: id,
    model_profile_id: 'model',
    model_name: 'Model',
    updated_at: '2026-08-29T00:00:00Z',
    archived: false,
    run_status: 'idle',
  }
}

function activeRun(): AgentRun {
  return {
    id: 'agr-current',
    client_request_id: 'request-current',
    session_id: 'session-one',
    generation: 2,
    event_sequence: 2,
    status: 'running',
    user_message_id: 'message-user',
    assistant_message_id: 'message-assistant',
    model_profile_id: 'model',
    model_snapshot: {
      api_mode: 'chat_completions',
      base_url: 'http://127.0.0.1:18188/v1',
      model_id: 'fixture',
      context_window_tokens: 8_192,
      max_output_tokens: 1_024,
      supports_images: false,
      supports_reasoning: true,
    },
    reasoning_level: 'off',
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
      estimated: true,
    },
    revision: 2,
    queued_at: '2026-08-29T00:00:00Z',
    started_at: '2026-08-29T00:00:01Z',
    updated_at: '2026-08-29T00:00:01Z',
  }
}
