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
import { createAgentMessageProjector } from './agentMessageProjectionCache.ts'
import {
  agentRunInteractionBlocked,
  agentWorkspaceInfrastructureReady,
  projectAgentModelOptions,
  projectAgentMessages,
  projectAgentSessions,
  selectionAfterSessionRemoval,
} from './agentWorkspaceProjection.ts'

describe('Agent 工作区页面投影', () => {
  it('本地文件配对及独立结果均使用有界卡片，外部同名工具保留普通结果', () => {
    const result = { id: 'result', message_id: 'message', sequence: 2, revision: 1, created_at: '', updated_at: '',
      kind: 'tool_result' as const, tool_result: { tool_call_id: 'call', tool_name: 'termous.local.files.read', is_error: false,
        content: [{ type: 'text', text: JSON.stringify({ path: 'C:/test.txt', text: 'x'.repeat(8000), size_bytes: 8000,
          offset: 0, next_offset: 8000, truncated: false }) }] } }
    const message: AgentMessage = { id: 'message', session_id: 'session', role: 'assistant', status: 'completed',
      sequence: 2, revision: 1, created_at: '', updated_at: '', parts: [result], attachments: [] }
    const call = { ...result, id: 'call-part', sequence: 1, kind: 'tool_call' as const,
      tool_call: { tool_call_id: 'call', tool_name: result.tool_result.tool_name, arguments: { path: 'C:/test.txt' } } }
    for (const parts of [[result], [call, result]]) {
      const projected = projectAgentMessages([{ ...message, parts }], undefined, [])[0]!.parts
      expect(projected).toHaveLength(1)
      expect(projected[0]).toMatchObject({ local_file: { action: 'read', text: 'x'.repeat(4000), previewLimited: true } })
    }
    for (const tool_result of [{ ...result.tool_result, tool_name: 'external::termous.local.files.read' },
      { ...result.tool_result, is_error: true }]) {
      expect(projectAgentMessages([{ ...message, parts: [{ ...result, tool_result }] }], undefined, [])[0]!.parts[0])
        .not.toHaveProperty('local_file', expect.anything())
    }
  })

  it('准备阶段跟随当前调用，审批与终态优先于迟到的阶段', () => {
    const run = activeRun()
    const call = { id: 'call-part', message_id: run.assistant_message_id, sequence: 1, revision: 1, created_at: '', updated_at: '',
      kind: 'tool_call' as const, tool_call: { tool_call_id: 'call', tool_name: 'termous.desktop_workflows.runs.start', arguments: {} } }
    const message: AgentMessage = { id: run.assistant_message_id, session_id: run.session_id, role: 'assistant', status: 'streaming',
      sequence: 2, revision: 1, created_at: '', updated_at: '', parts: [call], attachments: [] }
    const progress: AgentRunEvent = { id: 'progress', run_id: run.id, generation: run.generation, sequence: 2, created_at: '',
      kind: 'tool_progress', payload: { tool: { tool_call_id: 'call', tool_name: call.tool_call.tool_name, phase: 'preparing' } } }
    expect(projectAgentMessages([message], run, [progress])[0]!.parts[0]).toMatchObject({ status: 'running', phase: 'preparing' })
    expect(projectAgentMessages([message], { ...run, status: 'waiting_approval' }, [progress])[0]!.parts[0])
      .toMatchObject({ status: 'waiting_approval', phase: 'preparing' })
    const result = { ...call, id: 'result-part', sequence: 2, kind: 'tool_result' as const,
      tool_result: { tool_call_id: 'call', tool_name: call.tool_call.tool_name, content: [], is_error: false } }
    expect(projectAgentMessages([{ ...message, parts: [call, result] }], run, [progress])[0]!.parts[0])
      .toMatchObject({ status: 'completed', phase: undefined })
    expect(projectAgentMessages([message], run, [{ ...progress, generation: run.generation - 1 }])[0]!.parts[0])
      .toMatchObject({ status: 'running', phase: undefined })
  })

  it('分页从工具结果开始时仍展示结果和图片，合并调用页后只显示一次', () => {
    const result = { id: 'result', message_id: 'message', sequence: 2, revision: 1, created_at: '', updated_at: '',
      kind: 'tool_result' as const, tool_result: { tool_call_id: 'call', tool_name: 'termous.screen_analyses.images.get',
        content: [{ type: 'text', text: 'observation' }], is_error: false,
        images: [{ content_index: 1, mime_type: 'image/png', size_bytes: 100 }],
      } }
    const message: AgentMessage = { id: 'message', session_id: 'session', role: 'assistant', status: 'completed',
      sequence: 2, revision: 1, created_at: '', updated_at: '', parts: [result], attachments: [] }
    const projected = projectAgentMessages([message], undefined, [])[0]!.parts
    expect(projected).toHaveLength(1)
    expect(projected[0]).toMatchObject({ kind: 'tool', status: 'completed', images: [{ part_id: 'result', content_index: 1 }] })
    const call = { ...result, id: 'call-part', sequence: 1, kind: 'tool_call' as const,
      tool_call: { tool_call_id: 'call', tool_name: result.tool_result.tool_name, arguments: { analysis_id: 'analysis' } } }
    expect(projectAgentMessages([{ ...message, parts: [call, result] }], undefined, [])[0]!.parts).toHaveLength(1)
  })

  it('投影缓存跟随当前 Run 的状态与用量，后继任务不会借用上一轮元数据', () => {
    const project = createAgentMessageProjector()
    const message: AgentMessage = {
      id: 'message-assistant', session_id: 'session-one', role: 'assistant', status: 'completed',
      sequence: 2, revision: 1, created_at: '', updated_at: '', parts: [], attachments: [],
    }
    const first = activeRun({ status: 'completed', usage: tokenUsage(100) })
    const initial = project([message], first, [])
    const revised = { ...first, revision: first.revision + 1, usage: tokenUsage(200) }
    expect(project([message], revised, [])[0]?.usage?.total_tokens).toBe(200)
    expect(initial[0]?.usage?.total_tokens).toBe(100)
    const next = activeRun({ id: 'next', assistant_message_id: 'next-assistant' })
    expect(project([message], next, [])).toEqual(projectAgentMessages([message], next, []))
    expect(project([message], next, [])[0]?.usage).toBeUndefined()
  })

  it('仅在 Main Runtime 与当前 Run 的 generation 对齐后开放运行态交互', () => {
    const run = activeRun()
    expect(agentRunInteractionBlocked(run.id, run, {
      state: 'ready', workers: [{ state: 'starting', run_id: run.id, generation: run.generation, session_id: run.session_id }],
    })).toBe(true)
    expect(agentRunInteractionBlocked(run.id, run, {
      state: 'ready', workers: [{ state: 'running', run_id: run.id, generation: run.generation + 1, session_id: run.session_id }],
    })).toBe(true)
    expect(agentRunInteractionBlocked(run.id, run, {
      state: 'ready', workers: [{ state: 'running', run_id: run.id, generation: run.generation, session_id: run.session_id }],
    })).toBe(false)
    expect(agentRunInteractionBlocked('agr-other', run, {
      state: 'ready', workers: [{ state: 'running', run_id: 'agr-other', generation: run.generation, session_id: run.session_id }],
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
        global_context_window_tokens: 16_384, global_max_output_tokens: 4_096,
        max_concurrent_runs: 4,
        context_compaction_threshold_percent: 80,
        connect_ssh_profile_on_bind: false,
        show_turn_token_usage: true, revision: 1,
      },
    }

    expect(agentWorkspaceInfrastructureReady(readiness)).toBe(true)
    expect(agentWorkspaceInfrastructureReady({
      ...readiness,
      mcp_client: { status: 'missing', message: '' },
    })).toBe(false)
  })

  it('手工模型不受远程目录陈旧状态限制', () => {
    const provider: AgentModelProvider = {
      id: 'apv-current', name: 'Provider', api_mode: 'responses',
      base_url: 'http://127.0.0.1:18188/v1', enabled: true, api_key_configured: false,
      refresh_status: 'stale', revision: 2,
      created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:02Z',
    }
    const synced = modelFixture({ id: 'sync', source: 'sync' })
    const manual = modelFixture({ id: 'manual', source: 'manual' })

    const projected = projectAgentModelOptions([synced, manual], new Map([[provider.id, provider]]))

    expect(projected.find(({ id }) => id === synced.id)).toMatchObject({
      runnable: false,
      unavailable_reason: 'catalog_stale',
    })
    expect(projected.find(({ id }) => id === manual.id)).toMatchObject({
      runnable: true,
      unavailable_reason: undefined,
    })
  })

  it('已逻辑移除模型与远程目录缺失使用不同不可用原因', () => {
    const provider: AgentModelProvider = {
      id: 'apv-current', name: 'Provider', api_mode: 'responses',
      base_url: 'http://127.0.0.1:18188/v1', enabled: true, api_key_configured: false,
      refresh_status: 'ready', revision: 2,
      created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:02Z',
    }
    const removed = modelFixture({
      id: 'removed',
      removed_at: '2026-08-30T00:00:00Z',
    })
    const missing = modelFixture({ id: 'missing', availability: 'missing' })

    const projected = projectAgentModelOptions([removed, missing], new Map([[provider.id, provider]]))

    expect(projected.find(({ id }) => id === removed.id)?.unavailable_reason).toBe('removed')
    expect(projected.find(({ id }) => id === missing.id)?.unavailable_reason).toBe('missing')
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
      model_name: 'remote-current',
      provider_name: '当前 Provider 快照',
    })
  })

  it('当前模型目录优先于历史 Run 快照展示', () => {
    const current = agentSession('model-current')
    const model: AgentModel = {
      id: 'model-current', provider_id: 'apv-current', remote_model_id: 'remote-current',
      display_name: '当前目录模型', availability: 'available', source: 'sync',
      parameter_mode: 'custom', context_window_tokens: 16_384, max_output_tokens: 4_096,
      default_reasoning_level: 'off', reasoning_control: 'none', supported_reasoning_levels: ['off'],
      supports_images: false, supports_reasoning: false, capabilities_confirmed: false,
      effective_context_window_tokens: 16_384, effective_max_output_tokens: 4_096,
      effective_default_reasoning_level: 'off', revision: 2,
      first_seen_at: '2026-08-29T00:00:00Z', last_seen_at: '2026-08-29T00:00:02Z',
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
      model_name: 'remote-current',
      provider_name: '当前目录 Provider',
    })
  })

  it('一次索引多个会话的最新 Run，并在时间相同时使用稳定 ID 决胜', () => {
    const firstSession = agentSession('model-current')
    const secondSession = {
      ...agentSession('model-other'),
      id: 'session-two',
      title: '第二个会话',
    }
    const tiedEarlier = activeRun({
      id: 'agr-a',
      status: 'failed',
      model_id: 'model-current',
      model_snapshot: modelSnapshot({ model_id: 'remote-earlier' }),
      queued_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:02Z',
    })
    const tiedStableWinner = activeRun({
      id: 'agr-z',
      status: 'completed',
      model_id: 'model-current',
      model_snapshot: modelSnapshot({ model_id: 'remote-stable-winner' }),
      queued_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:02Z',
    })
    const secondLatest = activeRun({
      id: 'agr-second',
      session_id: secondSession.id,
      status: 'interrupted',
      model_id: 'model-other',
      updated_at: '2026-08-29T00:00:03Z',
    })

    const projected = projectAgentSessions(
      [firstSession, secondSession],
      [],
      [],
      {
        [secondLatest.id]: secondLatest,
        [tiedStableWinner.id]: tiedStableWinner,
        [tiedEarlier.id]: tiedEarlier,
      },
    )

    expect(projected.find(({ id }) => id === firstSession.id)).toMatchObject({
      model_name: 'remote-stable-winner',
      run_status: 'completed',
    })
    expect(projected.find(({ id }) => id === secondSession.id)?.run_status).toBe('interrupted')
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

  it.each([
    ['termous.sftp.files.stat', 'termous.files.stat'],
    ['termous.sftp.sessions.list', 'termous.files.sessions.list'],
    ['termous.sftp.transfers.get', 'termous.files.transfers.get'],
    ['termous.files.stat', 'termous.files.stat'],
    ['termous.sftp.files.unknown', 'termous.sftp.files.unknown'],
  ])('当前与归档消息仅转换工具显示名 %s，保留原记录及配对', (toolName, displayName) => {
    const legacyHistoryFixture: AgentMessage = {
      id: 'message-history', session_id: 'session-one', role: 'assistant', status: 'completed',
      sequence: 1, revision: 1, attachments: [],
      created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:01Z',
      parts: [
        {
          id: 'part-call', message_id: 'message-history', sequence: 1, revision: 1,
          created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z', kind: 'tool_call',
          tool_call: { tool_call_id: 'call-history', tool_name: toolName, arguments: { path: '/tmp/example' } },
        },
        {
          id: 'part-result', message_id: 'message-history', sequence: 2, revision: 1,
          created_at: '2026-08-29T00:00:01Z', updated_at: '2026-08-29T00:00:01Z', kind: 'tool_result',
          tool_result: { tool_call_id: 'call-history', tool_name: toolName, content: { size: 0 }, is_error: false },
        },
      ],
    }
    const before = structuredClone(legacyHistoryFixture)
    for (const run of [undefined, activeRun()]) {
      const [projected] = projectAgentMessages([legacyHistoryFixture], run, [])
      expect(projected?.parts).toEqual([expect.objectContaining({
        kind: 'tool', name: displayName, status: 'completed',
        detail: expect.stringContaining('"size": 0'),
      })])
    }
    expect(legacyHistoryFixture).toEqual(before)
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

  it('文本投影保持当前 Markdown 内容，不额外切换流式展示模式', () => {
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
        id: 'part-text',
        message_id: 'message-assistant',
        sequence: 1,
        revision: 1,
        created_at: '2026-08-29T00:00:00Z',
        updated_at: '2026-08-29T00:00:01Z',
        kind: 'text',
        text: '**持续输出**',
      }],
      attachments: [],
    }
    const finalPart: AgentRunEvent = {
      id: 'event-text-part',
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
    expect(before).toEqual({ id: 'part-text', kind: 'text', text: '**持续输出**' })
    expect(after).toEqual(before)
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
        resources: [{ kind: 'ssh_session', id: 'ses-original', name: '原关联主机' }],
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
    expect(projected?.resources).toEqual([{ kind: 'ssh_session', id: 'ses-original', name: '原关联主机' }])
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

  it('失败原因优先使用匹配 Run，保留原始详情且不借用其他会话详情', () => {
    const message: AgentMessage = {
      id: 'message-assistant', session_id: 'session-one', role: 'assistant', status: 'failed',
      sequence: 2, revision: 1, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:01Z',
      parts: [], attachments: [],
      turn_usage: { run_id: 'agr-history', usage: tokenUsage(0), error_code: 'AGENT_MODEL_TIMEOUT' },
    }
    const run = activeRun({
      status: 'failed', error_code: 'AGENT_MODEL_STREAM_INTERRUPTED', error_message: '  connection closed  ',
    })
    expect(projectAgentMessages([message], run, [])[0]).toMatchObject({
      status: 'failed', error_code: 'AGENT_MODEL_STREAM_INTERRUPTED', error_message: '  connection closed  ',
    })
    for (const otherRun of [undefined, { ...run, session_id: 'other-session' }, { ...run, assistant_message_id: 'other-message' }]) {
      const historical = projectAgentMessages([message], otherRun, [])[0]
      expect(historical?.error_code).toBe('AGENT_MODEL_TIMEOUT')
      expect(historical?.error_message).toBeUndefined()
    }
    const streaming = projectAgentMessages([{ ...message, status: 'streaming' }], run, [])[0]
    expect(streaming?.error_code).toBeUndefined()
    expect(streaming?.error_message).toBeUndefined()
    expect(projectAgentMessages([message], { ...run, error_message: 'x'.repeat(5_000) }, [])[0]?.error_message?.length).toBe(5_000)
  })

  it('后继 Run 开始后仍按历史终态元数据展示 steer 中断', () => {
    const message: AgentMessage = {
      id: 'message-steered', session_id: 'session-one', role: 'assistant', status: 'interrupted',
      sequence: 2, revision: 1, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:01Z',
      parts: [], attachments: [],
      turn_usage: { run_id: 'agr-steered', usage: tokenUsage(0), error_code: 'AGENT_RUN_STEERED' },
    }
    const followingRun = activeRun({
      id: 'agr-following', assistant_message_id: 'message-following', status: 'running',
    })

    expect(projectAgentMessages([message], followingRun, [])[0]?.status).toBe('interrupted_by_steer')
    expect(projectAgentMessages([
      { ...message, turn_usage: { ...message.turn_usage!, error_code: 'AGENT_RUNTIME_INTERRUPTED' } },
    ], followingRun, [])[0]?.status).toBe('interrupted')
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

function modelFixture(overrides: Partial<AgentModel> = {}): AgentModel {
  return {
    id: 'model', provider_id: 'apv-current', remote_model_id: 'remote-model',
    display_name: '模型', availability: 'available', source: 'sync', parameter_mode: 'custom',
    context_window_tokens: 16_384, max_output_tokens: 4_096, default_reasoning_level: 'off',
    reasoning_control: 'none', supported_reasoning_levels: ['off'], supports_images: false,
    supports_reasoning: false, capabilities_confirmed: true,
    effective_context_window_tokens: 16_384, effective_max_output_tokens: 4_096,
    effective_default_reasoning_level: 'off', revision: 1,
    first_seen_at: '2026-08-29T00:00:00Z', last_seen_at: '2026-08-29T00:00:01Z',
    created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:01Z',
    ...overrides,
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
        context_compaction_threshold_percent: 80,
    context_window_tokens: 8_192,
    max_output_tokens: 1_024,
    supports_images: false,
    reasoning_control: 'openai_effort',
    supported_reasoning_levels: ['off', 'medium'],
    supports_reasoning: true,
    ...overrides,
  }
}
