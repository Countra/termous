import { describe, expect, it } from 'vitest'
import type {
  AgentMessage,
  AgentModel,
  AgentModelProvider,
  AgentReadiness,
  AgentRun,
  AgentRunEvent,
  AgentSession,
} from '#entities/agent'
import type { AgentWorkspaceSession } from '#widgets/agent-workspace'
import {
  agentRunInteractionBlocked,
  agentWorkspaceInfrastructureReady,
  projectAgentMessages,
  projectAgentSessions,
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

  it('默认模型异常只限制模型操作，不遮蔽已就绪的历史工作区', () => {
    const readiness: AgentReadiness = {
      status: 'needs_repair',
      mcp_runtime: { status: 'ready', message: '' },
      mcp_client: { status: 'ready', message: '' },
      skills_bundle: { status: 'ready', message: '' },
      default_model: { status: 'outdated', message: '' },
      settings: {
        default_model_id: 'model-missing', default_reasoning_level: 'off',
        show_turn_token_usage: true, revision: 1,
        created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z',
      },
    }

    expect(agentWorkspaceInfrastructureReady(readiness)).toBe(true)
    expect(agentWorkspaceInfrastructureReady({
      ...readiness,
      mcp_client: { status: 'missing', message: '' },
    })).toBe(false)
  })

  it('目录缺失时只使用当前模型对应的最近 Run 快照恢复会话模型信息', () => {
    const current = agentSession('model-current')
    const currentRun = activeRun({
      id: 'agr-current-model',
      model_id: 'model-current',
      model_snapshot: modelSnapshot({
        model_id: 'remote-current',
        model_display_name: '当前模型快照',
        provider_name: '当前 Provider 快照',
      }),
      updated_at: '2026-08-29T00:00:01Z',
    })
    const newerOtherRun = activeRun({
      id: 'agr-other-model',
      model_id: 'model-other',
      model_snapshot: modelSnapshot({
        model_id: 'remote-other',
        model_display_name: '其他模型快照',
        provider_name: '其他 Provider 快照',
      }),
      updated_at: '2026-08-29T00:00:02Z',
    })

    const [projected] = projectAgentSessions(
      [current],
      [],
      [],
      { [currentRun.id]: currentRun, [newerOtherRun.id]: newerOtherRun },
    )

    expect(projected).toMatchObject({
      model_id: 'model-current',
      model_name: '当前模型快照',
      provider_name: '当前 Provider 快照',
    })
  })

  it('当前模型目录优先于历史 Run 快照展示', () => {
    const current = agentSession('model-current')
    const model: AgentModel = {
      id: 'model-current', provider_id: 'apv-current', remote_model_id: 'remote-current',
      display_name: '当前目录模型', availability: 'available', context_window_tokens: 16_384,
      max_output_tokens: 4_096, supports_images: false, supports_reasoning: false,
      capabilities_confirmed: false, revision: 2,
      created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:02Z',
    }
    const provider: AgentModelProvider = {
      id: 'apv-current', name: '当前目录 Provider', api_mode: 'responses',
      base_url: 'http://127.0.0.1:18188/v1', enabled: true, api_key_configured: false,
      refresh_status: 'ready', revision: 2,
      created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:02Z',
    }

    const [projected] = projectAgentSessions(
      [current],
      [model],
      [provider],
      { run: activeRun({ model_id: 'model-current' }) },
    )

    expect(projected).toMatchObject({
      model_name: '当前目录模型',
      provider_name: '当前目录 Provider',
    })
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
      attachments: [],
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
      attachments: [],
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

    const run = activeRun()
    const before = projectAgentMessages([message], run, [])[0]?.parts[0]
    const after = projectAgentMessages([message], run, [finalPart])[0]?.parts[0]
    expect(before?.kind === 'reasoning' && before.streaming).toBe(true)
    expect(after?.kind === 'reasoning' && after.streaming).toBe(false)
  })

  it('将消息附件与文本片段中的来源上下文投影到工作区', () => {
    const message: AgentMessage = {
      id: 'message-user',
      session_id: 'session-one',
      role: 'user',
      status: 'completed',
      sequence: 1,
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
      parts: [{
        id: 'part-text',
        message_id: 'message-user',
        sequence: 1,
        revision: 1,
        created_at: '2026-08-29T00:00:00Z',
        updated_at: '2026-08-29T00:00:00Z',
        kind: 'text',
        text: '检查连接',
        source_context: {
          kind: 'workbench', entity_id: 'host-one', title: '生产主机', summary: '连接中断',
        },
      }],
      attachments: [{
        id: 'attachment-one', session_id: 'session-one', original_name: 'diagnostic.txt',
        mime_type: 'text/plain', kind: 'text', size_bytes: 10, state: 'bound', revision: 1,
        created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z',
      }],
    }

    const [projected] = projectAgentMessages([message], undefined, [])
    expect(projected?.source_context?.entity_id).toBe('host-one')
    expect(projected?.attachments[0]?.id).toBe('attachment-one')
  })

  it('优先投影内存终态 Run 用量并在重载后回退到历史本轮用量', () => {
    const historicalUsage = tokenUsage(100)
    const currentUsage = tokenUsage(240)
    const message: AgentMessage = {
      id: 'message-assistant',
      session_id: 'session-one',
      role: 'assistant',
      status: 'completed',
      sequence: 2,
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:01Z',
      parts: [],
      attachments: [],
      turn_usage: { run_id: 'agr-history', usage: historicalUsage },
    }
    const run = activeRun({
      status: 'completed',
      usage: currentUsage,
      completed_at: '2026-08-29T00:00:02Z',
      updated_at: '2026-08-29T00:00:02Z',
    })

    expect(projectAgentMessages([message], undefined, [])[0]?.usage).toEqual(historicalUsage)
    expect(projectAgentMessages([message], run, [])[0]?.usage).toEqual(currentUsage)
    const foreignRun = { ...run, id: 'agr-foreign', session_id: 'session-other' }
    expect(projectAgentMessages([message], foreignRun, [])[0]?.usage)
      .toEqual(historicalUsage)
    expect(projectAgentMessages([
      { ...message, status: 'streaming' },
    ], run, [])[0]?.usage).toBeUndefined()
  })
})

function session(id: string): AgentWorkspaceSession {
  return {
    id,
    title: id,
    model_id: 'model',
    model_name: 'Model',
    updated_at: '2026-08-29T00:00:00Z',
    archived: false,
    run_status: 'idle',
  }
}

function activeRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'agr-current',
    client_request_id: 'request-current',
    session_id: 'session-one',
    generation: 2,
    event_sequence: 2,
    status: 'running',
    user_message_id: 'message-user',
    assistant_message_id: 'message-assistant',
    provider_id: 'apv-current',
    model_id: 'model',
    model_snapshot: modelSnapshot(),
    reasoning_level: 'off',
    usage: {
      input_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
      estimated: true,
    },
    revision: 2,
    queued_at: '2026-08-29T00:00:00Z',
    started_at: '2026-08-29T00:00:01Z',
    updated_at: '2026-08-29T00:00:01Z',
    ...overrides,
  }
}

function tokenUsage(totalTokens: number): AgentRun['usage'] {
  return {
    input_tokens: totalTokens - 30,
    cache_read_tokens: 10,
    cache_write_tokens: 5,
    output_tokens: 15,
    reasoning_tokens: 4,
    total_tokens: totalTokens,
    estimated: false,
  }
}

function agentSession(modelId: string): AgentSession {
  return {
    id: 'session-one', title: '会话', model_id: modelId, reasoning_level: 'off', revision: 1,
    created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:01Z',
  }
}

function modelSnapshot(
  overrides: Partial<AgentRun['model_snapshot']> = {},
): AgentRun['model_snapshot'] {
  return {
    api_mode: 'chat_completions',
    base_url: 'http://127.0.0.1:18188/v1',
    model_id: 'fixture',
    provider_id: 'apv-current',
    provider_name: 'Provider 快照',
    model_display_name: '模型快照',
    provider_revision: 1,
    model_revision: 1,
    context_window_tokens: 8_192,
    max_output_tokens: 1_024,
    supports_images: false,
    supports_reasoning: true,
    ...overrides,
  }
}
