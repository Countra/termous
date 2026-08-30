import { App as AntdApp } from 'antd'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentLaunchIntent, AgentModel, AgentReadiness, AgentRun, AgentSession } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import { AgentRuntimeStartError, type AgentWorkspaceGateway } from '#features/agent-runtime'

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  workspaceProps: null as Record<string, unknown> | null,
  workspaceRenderCount: 0,
  createSession: vi.fn(),
  startRun: vi.fn(),
  steerActiveRun: vi.fn(),
  updateDraft: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  selectSession: vi.fn(),
  reloadContext: vi.fn(),
  reloadUsage: vi.fn(),
  attachmentOptions: null as null | { ensureSession: () => Promise<string> },
  attachmentRecords: {} as Record<string, unknown[]>,
  addAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  retryAttachment: vi.fn(),
  clearAttachments: vi.fn(),
  discardAttachments: vi.fn(),
  modelProviders: vi.fn(),
  models: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#features/agent-runtime', () => ({
  AgentRuntimeStartError: class AgentRuntimeStartError extends Error {
    constructor(_code: string, readonly run: { session_id: string }) {
      super(_code)
    }
  },
  AgentWorkspaceController: function AgentWorkspaceController() {
    return {
      subscribe: (listener: () => void) => {
        harness.listeners.add(listener)
        return () => harness.listeners.delete(listener)
      },
      getSnapshot: () => harness.state,
      start: vi.fn(),
      close: vi.fn(),
      createSession: harness.createSession,
      startRun: harness.startRun,
      steerActiveRun: harness.steerActiveRun,
      updateDraft: harness.updateDraft,
      updateSession: harness.updateSession,
      deleteSession: harness.deleteSession,
      selectSession: harness.selectSession,
      reloadContext: harness.reloadContext,
      reloadUsage: harness.reloadUsage,
    }
  },
  useAgentDraftAttachments: (options: { ensureSession: () => Promise<string> }) => {
    harness.attachmentOptions = options
    return {
      records: harness.attachmentRecords,
      add: harness.addAttachment,
      remove: harness.removeAttachment,
      retry: harness.retryAttachment,
      clear: harness.clearAttachments,
      discard: harness.discardAttachments,
    }
  },
}))

vi.mock('#widgets/agent-workspace', () => ({
  AgentWorkspace: (props: Record<string, unknown>) => {
    harness.workspaceRenderCount += 1
    harness.workspaceProps = props
    return <div data-testid="agent-workspace" />
  },
}))

import { AgentPage } from './AgentPage.tsx'

describe('AgentPage', () => {
  beforeEach(() => {
    harness.listeners.clear()
    harness.workspaceProps = null
    harness.workspaceRenderCount = 0
    harness.createSession.mockReset()
    harness.startRun.mockReset()
    harness.steerActiveRun.mockReset()
    harness.updateDraft.mockReset()
    harness.updateSession.mockReset()
    harness.deleteSession.mockReset().mockResolvedValue(undefined)
    harness.selectSession.mockReset()
    harness.reloadContext.mockReset().mockResolvedValue(undefined)
    harness.reloadUsage.mockReset().mockResolvedValue(undefined)
    harness.attachmentOptions = null
    harness.attachmentRecords = {}
    harness.addAttachment.mockReset()
    harness.removeAttachment.mockReset()
    harness.retryAttachment.mockReset()
    harness.clearAttachments.mockReset()
    harness.discardAttachments.mockReset().mockResolvedValue(undefined)
    harness.modelProviders.mockReset().mockResolvedValue({ items: [providerFixture()] })
    harness.models.mockReset().mockResolvedValue({ items: [modelFixture()] })
    harness.state = workspaceState()
    harness.selectSession.mockImplementation((sessionId?: string) => {
      harness.state = {
        ...harness.state,
        selected_session_id: sessionId,
        new_session_selected: sessionId === undefined,
        selection_intent_revision: Number(harness.state.selection_intent_revision ?? 0) + 1,
      }
      publishState()
    })
    harness.updateDraft.mockImplementation((sessionId: string, text: string) => {
      const drafts = { ...(harness.state.drafts as Record<string, { text: string; updated_at: number }>) }
      if (text) drafts[sessionId] = { text, updated_at: Date.now() }
      else delete drafts[sessionId]
      harness.state = { ...harness.state, drafts }
      publishState()
    })
    harness.createSession.mockImplementation(async () => {
      const created = { ...sessions[0], id: 'session-created', title: 'Created' }
      harness.state = {
        ...harness.state,
        sessions: [created, ...(harness.state.sessions as AgentSession[])],
        selected_session_id: created.id,
        new_session_selected: false,
        selection_intent_revision: Number(harness.state.selection_intent_revision ?? 0) + 1,
      }
      publishState()
      return created
    })
    harness.startRun.mockResolvedValue(undefined)
    harness.steerActiveRun.mockResolvedValue(undefined)
  })

  it('归档当前会话后切换到相邻的未归档会话', async () => {
    harness.updateSession.mockResolvedValue({ ...sessions[0], archived_at: '2026-08-29T02:00:00Z' })
    renderPage()

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    await act(async () => {
      const archive = harness.workspaceProps?.onArchiveSession as (sessionId: string) => void
      archive('session-one')
    })

    await waitFor(() => expect(harness.updateSession).toHaveBeenCalledTimes(1))
    expect(harness.selectSession).toHaveBeenCalledWith('session-two')
  })

  it('向应用上报 Core 权威活动任务和快照完整性', async () => {
    const onRuntimeSummaryChange = vi.fn()
    renderPage({ onRuntimeSummaryChange })

    await waitFor(() => expect(onRuntimeSummaryChange).toHaveBeenCalledWith({
      agentRunCount: 0,
      snapshotComplete: true,
    }))
    act(() => {
      harness.state = {
        ...harness.state,
        phase: 'reconnecting',
        snapshot_complete: false,
        active_run_id: 'run-one',
      }
      publishState()
    })
    await waitFor(() => expect(onRuntimeSummaryChange).toHaveBeenLastCalledWith({
      agentRunCount: 1,
      snapshotComplete: false,
    }))
  })

  it('查看其他会话时投影全局活动 Run，并可返回运行会话', async () => {
    const run = runFixture({ session_id: 'session-two' })
    harness.state = {
      ...workspaceState(),
      active_run_id: run.id,
      runs: { [run.id]: run },
      runtime_status: { state: 'running', active_run_id: run.id, generation: run.generation },
    }
    renderPage()

    await waitFor(() => expect(harness.workspaceProps?.active_run).toEqual({
      session_id: 'session-two',
      status: 'running',
    }))
    expect((harness.workspaceProps?.inspector as { mcp: { connection: string } }).mcp.connection)
      .toBe('connected')
    act(() => {
      const returnToRun = harness.workspaceProps?.onReturnToActiveRun as () => void
      returnToRun()
    })
    expect(harness.selectSession).toHaveBeenCalledWith('session-two')
  })

  it('返回 Agent 页面时刷新当前会话的权威上下文容量与 Token 用量', async () => {
    renderPage()

    await waitFor(() => expect(harness.reloadContext).toHaveBeenCalledWith('session-one'))
    expect(harness.reloadUsage).toHaveBeenCalledWith('session-one')
  })

  it('投影当前会话 Token 用量并路由独立重试', async () => {
    harness.state = {
      ...workspaceState(),
      session_usages: {
        'session-one': {
          phase: 'ready',
          value: {
            session_id: 'session-one', run_count: 3,
            input_tokens: 1_200, output_tokens: 800,
            cache_read_tokens: 125, cache_write_tokens: 25,
            reasoning_tokens: 100,
            total_tokens: 2_150, estimated: true,
            updated_at: '2026-08-29T02:00:00Z',
          },
        },
      },
    }
    renderPage()

    await waitFor(() => expect(harness.workspaceProps?.inspector).toMatchObject({
      usage: {
        phase: 'ready', has_snapshot: true, run_count: 3,
        input_tokens: 1_200, output_tokens: 800,
        cache_read_tokens: 125, cache_write_tokens: 25,
        reasoning_tokens: 100,
        total_tokens: 2_150, estimated: true,
      },
    }))
    act(() => {
      const retryUsage = harness.workspaceProps?.onRetryUsage as () => void
      retryUsage()
    })
    expect(harness.reloadUsage).toHaveBeenCalledWith('session-one')
  })

  it('流式事件未改变会话与 Run 时复用会话投影', async () => {
    renderPage()
    await waitFor(() => expect(harness.reloadContext).toHaveBeenCalledWith('session-one'))
    const projectedSessions = harness.workspaceProps?.sessions
    const renderCount = harness.workspaceRenderCount

    act(() => {
      harness.state = {
        ...harness.state,
        run_events: { stream: [] },
      }
      publishState()
    })

    await waitFor(() => expect(harness.workspaceRenderCount).toBeGreaterThan(renderCount))
    expect(harness.workspaceProps?.sessions).toBe(projectedSessions)
  })

  it('归档非当前会话时保持现有选择', async () => {
    harness.updateSession.mockResolvedValue({ ...sessions[1], archived_at: '2026-08-29T02:00:00Z' })
    renderPage()

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    await act(async () => {
      const archive = harness.workspaceProps?.onArchiveSession as (sessionId: string) => void
      archive('session-two')
    })

    await waitFor(() => expect(harness.updateSession).toHaveBeenCalledTimes(1))
    expect(harness.selectSession).not.toHaveBeenCalled()
  })

  it('归档响应迟到时不覆盖用户切换到的新会话草稿', async () => {
    const pending = deferred<AgentSession>()
    harness.updateSession.mockReturnValueOnce(pending.promise)
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const archive = harness.workspaceProps?.onArchiveSession as (sessionId: string) => void
      archive('session-one')
    })
    await waitFor(() => expect(harness.updateSession).toHaveBeenCalledTimes(1))
    act(() => {
      const create = harness.workspaceProps?.onCreateSession as () => void
      create()
    })
    pending.resolve({ ...sessions[0], archived_at: '2026-08-29T02:00:00Z' })
    await act(async () => { await pending.promise })

    await waitFor(() => expect(harness.discardAttachments).toHaveBeenCalledWith('session-one'))
    expect(harness.selectSession).toHaveBeenCalledTimes(1)
    expect(harness.selectSession).toHaveBeenLastCalledWith(undefined)
  })

  it('新会话草稿跨会话保留，并在首次发送时才持久化会话', async () => {
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const create = harness.workspaceProps?.onCreateSession as () => void
      create()
    })
    await waitFor(() => expect(harness.workspaceProps?.selected_session_id).toBeUndefined())
    expect((harness.workspaceProps?.inspector as {
      context: { phase: string }
    }).context.phase).toBe('unavailable')
    expect(harness.createSession).not.toHaveBeenCalled()

    act(() => {
      const change = harness.workspaceProps?.onDraftChange as (value: string) => void
      change('保留的本地草稿')
    })
    act(() => {
      const select = harness.workspaceProps?.onSelectSession as (sessionId: string) => void
      select('session-one')
    })
    act(() => {
      const create = harness.workspaceProps?.onCreateSession as () => void
      create()
    })
    await waitFor(() => expect(harness.workspaceProps?.draft).toBe('保留的本地草稿'))
    expect(harness.createSession).not.toHaveBeenCalled()

    await act(async () => {
      const send = harness.workspaceProps?.onSend as (message: string) => Promise<void>
      await send('保留的本地草稿')
    })
    expect(harness.createSession).toHaveBeenCalledTimes(1)
    expect(harness.startRun).toHaveBeenCalledWith('session-created', '保留的本地草稿', undefined, undefined)
  })

  it('steer 完成时不清除提交期间继续输入的草稿', async () => {
    const pending = deferred<void>()
    harness.steerActiveRun.mockReturnValueOnce(pending.promise)
    harness.state = {
      ...workspaceState(),
      drafts: { 'session-one': { text: '第一条追加要求', updated_at: 1 } },
    }
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    let steering!: Promise<void>
    act(() => {
      const steer = harness.workspaceProps?.onSteer as (message: string) => Promise<void>
      steering = steer('第一条追加要求')
    })
    await waitFor(() => expect(harness.steerActiveRun).toHaveBeenCalledTimes(1))
    act(() => {
      const change = harness.workspaceProps?.onDraftChange as (value: string) => void
      change('第二条追加要求')
    })
    pending.resolve()
    await act(async () => { await steering })

    expect((harness.state.drafts as Record<string, { text: string }>)['session-one']?.text)
      .toBe('第二条追加要求')
  })

  it('附件预建会话首次发送时更新标题并提交附件 ID', async () => {
    harness.updateSession.mockImplementation(async (sessionId: string, input: { title: string }) => ({
      ...sessions[0], id: sessionId, title: input.title,
    }))
    renderPage()
    await waitFor(() => expect(harness.attachmentOptions).not.toBeNull())
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const create = harness.workspaceProps?.onCreateSession as () => void
      create()
    })
    await act(async () => { await harness.attachmentOptions!.ensureSession() })
    await waitFor(() => expect(harness.workspaceProps?.selected_session_id).toBe('session-created'))
    await act(async () => {
      const send = harness.workspaceProps?.onSend as (
        message: string,
        attachmentIds: string[],
      ) => Promise<void>
      await send('检查生产连接', ['attachment-one'])
    })

    expect(harness.updateSession).toHaveBeenCalledWith('session-created', expect.objectContaining({
      title: '检查生产连接',
      expected_revision: 1,
    }))
    expect(harness.startRun).toHaveBeenCalledWith(
      'session-created', '检查生产连接', ['attachment-one'], undefined,
    )
    expect(harness.clearAttachments).toHaveBeenCalledWith('session-created')
  })

  it('Run 已创建但 Runtime 启动失败时清理已提交附件和来源上下文', async () => {
    harness.startRun.mockRejectedValueOnce(new AgentRuntimeStartError(
      'AGENT_RUNTIME_START_REJECTED',
      { session_id: 'session-created' } as AgentRun,
    ))
    renderPage({ launchIntent: launchIntent() })
    await waitFor(() => expect(harness.workspaceProps?.selected_session_id).toBe('session-created'))
    await waitFor(() => expect(harness.workspaceProps?.draft_source_context).toEqual(
      launchIntent().source_context,
    ))

    await act(async () => {
      const send = harness.workspaceProps?.onSend as (
        message: string,
        attachmentIds: string[],
        sourceContext: AgentLaunchIntent['source_context'],
      ) => Promise<void>
      await send('检查生产连接', ['attachment-one'], launchIntent().source_context)
    })

    expect(harness.clearAttachments).toHaveBeenCalledWith('session-created')
    await waitFor(() => expect(harness.workspaceProps?.draft_source_context).toBeUndefined())
  })

  it('Run 创建失败时保留未提交附件草稿', async () => {
    harness.startRun.mockRejectedValueOnce(new Error('AGENT_RUN_CREATE_FAILED'))
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    await act(async () => {
      const send = harness.workspaceProps?.onSend as (
        message: string,
        attachmentIds: string[],
      ) => Promise<void>
      await send('检查生产连接', ['attachment-one'])
    })

    expect(harness.clearAttachments).not.toHaveBeenCalled()
  })

  it('业务来源创建失败时释放 pending intent，允许用户重新发起', async () => {
    const onLaunchIntentHandled = vi.fn()
    harness.createSession.mockRejectedValueOnce(new Error('failed'))
    renderPage({ launchIntent: launchIntent(), onLaunchIntentHandled })

    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onLaunchIntentHandled).toHaveBeenCalledWith(7))
    expect(harness.startRun).not.toHaveBeenCalled()
  })

  it('默认模型不可用时保留业务来源，选择可运行模型后自动创建草稿', async () => {
    const disabledProvider = { ...providerFixture(), enabled: false }
    const runnableProvider = {
      ...providerFixture(),
      id: 'provider-two',
      name: 'Provider Two',
    }
    harness.modelProviders.mockResolvedValue({ items: [disabledProvider, runnableProvider] })
    harness.models.mockResolvedValue({
      items: [
        modelFixture(),
        { ...modelFixture('model-two'), provider_id: runnableProvider.id },
      ],
    })
    harness.state = { ...workspaceState(), selected_session_id: undefined }
    const onLaunchIntentHandled = vi.fn()
    renderPage({
      launchIntent: launchIntent(),
      onLaunchIntentHandled,
      readiness: readinessFixture('needs_setup', 'missing'),
    })

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(onLaunchIntentHandled).not.toHaveBeenCalled()

    act(() => {
      const selectModel = harness.workspaceProps?.onModelChange as (modelId: string) => void
      selectModel('model-two')
    })

    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onLaunchIntentHandled).toHaveBeenCalledWith(7))
    expect(harness.updateDraft).toHaveBeenCalledWith('session-created', 'agent.launch.prompt.workbench')
  })

  it('切换模型时在同一次会话更新中回退不受支持的推理档位', async () => {
    const reasoningModel = {
      ...modelFixture(),
      reasoning_control: 'openai_effort' as const,
      supported_reasoning_levels: ['off', 'high'] as const,
      supports_reasoning: true,
      effective_default_reasoning_level: 'high' as const,
    }
    const lowModel = {
      ...modelFixture('model-low'),
      reasoning_control: 'openai_effort' as const,
      supported_reasoning_levels: ['off', 'low'] as const,
      supports_reasoning: true,
      effective_default_reasoning_level: 'low' as const,
    }
    harness.models.mockResolvedValue({ items: [reasoningModel, lowModel] })
    harness.state = {
      ...workspaceState(),
      sessions: [{ ...sessions[0], reasoning_level: 'high' }, sessions[1]],
    }
    harness.updateSession.mockResolvedValue({ ...sessions[0], model_id: lowModel.id, reasoning_level: 'low' })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const selectModel = harness.workspaceProps?.onModelChange as (modelId: string) => void
      selectModel(lowModel.id)
    })

    await waitFor(() => expect(harness.updateSession).toHaveBeenCalledWith('session-one', expect.objectContaining({
      model_id: lowModel.id,
      reasoning_level: 'low',
      expected_revision: 1,
    })))
  })

  it('会话推理强度选择通过 Session PATCH 仅影响后续 Run', async () => {
    const model = {
      ...modelFixture(),
      reasoning_control: 'openai_effort' as const,
      supported_reasoning_levels: ['off', 'medium', 'high'] as const,
      supports_reasoning: true,
      effective_default_reasoning_level: 'medium' as const,
    }
    harness.models.mockResolvedValue({ items: [model] })
    harness.updateSession.mockResolvedValue({ ...sessions[0], reasoning_level: 'high' })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const selectReasoning = harness.workspaceProps?.onReasoningChange as (level: string) => void
      selectReasoning('high')
    })

    await waitFor(() => expect(harness.updateSession).toHaveBeenCalledWith('session-one', expect.objectContaining({
      model_id: 'model-one',
      reasoning_level: 'high',
      expected_revision: 1,
    })))
    expect(harness.startRun).not.toHaveBeenCalled()
  })

  it('模型能力变更后会话保留不受支持的推理档位时禁止发送', async () => {
    harness.models.mockResolvedValue({ items: [modelFixture()] })
    harness.state = {
      ...workspaceState(),
      sessions: [{ ...sessions[0], reasoning_level: 'high' }, sessions[1]],
    }

    renderPage()

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    expect(harness.workspaceProps?.selected_reasoning_level).toBe('high')
    expect(harness.workspaceProps?.model_runnable).toBe(false)
  })

  it('重新激活时等待当前模型目录水合后再处理业务来源', async () => {
    const initialProvider = providerFixture()
    const disabledProvider = { ...initialProvider, enabled: false }
    const runnableProvider = {
      ...providerFixture(),
      id: 'provider-two',
      name: 'Provider Two',
    }
    const pendingProviders = deferred<{ items: ReturnType<typeof providerFixture>[] }>()
    harness.modelProviders.mockReset()
      .mockResolvedValueOnce({ items: [initialProvider] })
      .mockReturnValueOnce(pendingProviders.promise)
    harness.models.mockReset()
      .mockResolvedValueOnce({ items: [modelFixture()] })
      .mockResolvedValueOnce({
        items: [
          modelFixture(),
          { ...modelFixture('model-two'), provider_id: runnableProvider.id },
        ],
      })
    const onLaunchIntentHandled = vi.fn()
    const page = renderPage()
    await waitFor(() => expect(harness.reloadContext).toHaveBeenCalledWith('session-one'))

    act(() => {
      harness.state = { ...harness.state, selected_session_id: undefined }
      publishState()
    })
    page.rerenderPage({ active: false })
    page.rerenderPage({
      active: true,
      launchIntent: launchIntent(),
      onLaunchIntentHandled,
    })
    await waitFor(() => expect(harness.modelProviders).toHaveBeenCalledTimes(2))
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(onLaunchIntentHandled).not.toHaveBeenCalled()

    await act(async () => {
      pendingProviders.resolve({ items: [disabledProvider, runnableProvider] })
      await pendingProviders.promise
    })
    await waitFor(() => expect((harness.workspaceProps?.models as Array<{ id: string }>))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'model-two' })])))
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(onLaunchIntentHandled).not.toHaveBeenCalled()

    act(() => {
      const selectModel = harness.workspaceProps?.onModelChange as (modelId: string) => void
      selectModel('model-two')
    })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onLaunchIntentHandled).toHaveBeenCalledWith(7))
  })

  it('业务入口创建独立草稿但不自动发送或覆盖当前会话草稿', async () => {
    const onLaunchIntentHandled = vi.fn()
    harness.state = {
      ...workspaceState(),
      drafts: { 'session-one': { text: '当前会话草稿', updated_at: 1 } },
    }
    renderPage({ launchIntent: launchIntent(), onLaunchIntentHandled })

    await waitFor(() => expect(onLaunchIntentHandled).toHaveBeenCalledWith(7))
    expect(harness.startRun).not.toHaveBeenCalled()
    expect((harness.state.drafts as Record<string, { text: string }>)['session-one']?.text)
      .toBe('当前会话草稿')
    expect(harness.updateDraft).toHaveBeenCalledWith('session-created', 'agent.launch.prompt.workbench')
  })

  it('附件草稿创建在途时业务入口等待后创建独立会话', async () => {
    const attachmentSession = { ...sessions[0], id: 'session-attachment', title: 'Attachment' }
    const launchSession = { ...sessions[0], id: 'session-launch', title: 'Launch' }
    const pendingAttachmentSession = deferred<AgentSession>()
    harness.createSession
      .mockImplementationOnce(() => pendingAttachmentSession.promise)
      .mockResolvedValueOnce(launchSession)
    harness.state = {
      ...workspaceState(),
      selected_session_id: undefined,
      drafts: { new: { text: '附件草稿', updated_at: 1 } },
    }
    const onLaunchIntentHandled = vi.fn()
    const page = renderPage()
    await waitFor(() => expect(harness.attachmentOptions).not.toBeNull())

    let attachmentCreation!: Promise<string>
    act(() => {
      attachmentCreation = harness.attachmentOptions!.ensureSession()
    })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(1))

    page.rerenderPage({ launchIntent: launchIntent(), onLaunchIntentHandled })
    await act(async () => { await Promise.resolve() })
    expect(harness.createSession).toHaveBeenCalledTimes(1)

    pendingAttachmentSession.resolve(attachmentSession)
    await act(async () => { await attachmentCreation })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(onLaunchIntentHandled).toHaveBeenCalledWith(7))

    expect(harness.updateDraft).toHaveBeenCalledWith('session-attachment', '附件草稿')
    expect(harness.updateDraft).toHaveBeenCalledWith('session-launch', 'agent.launch.prompt.workbench')
    expect(harness.selectSession).toHaveBeenCalledWith('session-attachment')
    expect(harness.selectSession).toHaveBeenCalledWith('session-launch')
  })

  it('归档会话时丢弃未绑定附件，删除会话时释放本地附件记录', async () => {
    harness.updateSession.mockResolvedValue({ ...sessions[0], archived_at: '2026-08-29T03:00:00Z' })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    await act(async () => {
      const archive = harness.workspaceProps?.onArchiveSession as (sessionId: string) => void
      archive('session-one')
    })
    await waitFor(() => expect(harness.discardAttachments).toHaveBeenCalledWith('session-one'))

    harness.state = workspaceState()
    publishState()
    await act(async () => {
      const remove = harness.workspaceProps?.onDeleteSession as (sessionId: string) => void
      remove('session-one')
    })
    await waitFor(() => expect(harness.clearAttachments).toHaveBeenCalledWith('session-one'))
  })

  it('模型分页拒绝重复 cursor，避免异常服务端响应导致无限请求', async () => {
    harness.models
      .mockResolvedValueOnce({ items: [modelFixture('model-one')], next_cursor: 'repeat' })
      .mockResolvedValueOnce({ items: [modelFixture('model-two')], next_cursor: 'repeat' })

    renderPage()

    await waitFor(() => expect(harness.models).toHaveBeenCalledTimes(2))
    expect(harness.workspaceProps).toBeNull()
  })

  it('模型分页拒绝跨页重复 ID', async () => {
    harness.models
      .mockResolvedValueOnce({ items: [modelFixture('duplicate')], next_cursor: 'next' })
      .mockResolvedValueOnce({ items: [modelFixture('duplicate')] })
    renderPage()
    await waitFor(() => expect(harness.models).toHaveBeenCalledTimes(2))
    expect(harness.workspaceProps).toBeNull()
  })

})

const sessions: AgentSession[] = [
  {
    id: 'session-one',
    title: 'First',
    model_id: 'model-one',
    reasoning_level: 'off',
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T02:00:00Z',
  },
  {
    id: 'session-two',
    title: 'Second',
    model_id: 'model-one',
    reasoning_level: 'off',
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T01:00:00Z',
  },
]

function workspaceState() {
  return {
    phase: 'ready',
    snapshot_complete: true,
    revision: 1,
    sessions,
    runs: {},
    messages: {},
    run_events: {},
    run_event_sequences: {},
    run_part_overlays: {},
    drafts: {},
    session_contexts: {},
    session_usages: {},
    selected_session_id: 'session-one',
    new_session_selected: false,
    selection_intent_revision: 0,
  }
}

function publishState() {
  for (const listener of harness.listeners) listener()
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((done) => { resolve = done })
  return { promise, resolve }
}

function renderPage({
  launchIntent,
  onLaunchIntentHandled,
  onRuntimeSummaryChange,
  readiness = readinessFixture(),
  active = true,
}: {
  launchIntent?: AgentLaunchIntent
  onLaunchIntentHandled?: (key: number) => void
  onRuntimeSummaryChange?: (snapshot: {
    agentRunCount: number
    snapshotComplete: boolean
  }) => void
  readiness?: AgentReadiness
  active?: boolean
} = {}) {
  const setupGateway = {
    readiness: vi.fn(async () => readiness),
    modelProviders: harness.modelProviders,
    models: harness.models,
  } as unknown as AgentSetupGateway
  const gateway = {} as AgentWorkspaceGateway
  const element = (next: {
    launchIntent?: AgentLaunchIntent
    onLaunchIntentHandled?: (key: number) => void
    active?: boolean
  } = {}) => (
    <AntdApp>
      <AgentPage
        gateway={gateway}
        setupGateway={setupGateway}
        enabled
        active={next.active ?? active}
        launchIntent={next.launchIntent ?? launchIntent}
        onLaunchIntentHandled={next.onLaunchIntentHandled ?? onLaunchIntentHandled}
        onRuntimeSummaryChange={onRuntimeSummaryChange}
      />
    </AntdApp>
  )
  const view = render(element())
  return {
    ...view,
    rerenderPage: (next: {
      launchIntent?: AgentLaunchIntent
      onLaunchIntentHandled?: (key: number) => void
      active?: boolean
    }) => view.rerender(element(next)),
  }
}

function providerFixture() {
  return {
    id: 'provider-one',
    name: 'Provider One',
    api_mode: 'responses' as const,
    base_url: 'http://127.0.0.1:11434/v1',
    enabled: true,
    api_key_configured: false,
    refresh_status: 'ready' as const,
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}

function readinessFixture(
  status: AgentReadiness['status'] = 'ready',
  defaultModelStatus: AgentReadiness['default_model']['status'] = 'ready',
): AgentReadiness {
  return {
    status,
    mcp_runtime: { status: 'ready', message: '' },
    mcp_client: { status: 'ready', message: '' },
    skills_bundle: { status: 'ready', message: '' },
    default_model: { status: defaultModelStatus, message: '' },
    mcp_policy: {
      client_id: 'mcp-one',
      approval_bypass: false,
      scope_count: 29,
      required_scope_count: 29,
      scope_sync_required: false,
      revision: 1,
    },
    settings: {
      default_model_id: 'model-one',
      default_reasoning_level: 'off',
      global_context_window_tokens: 16_384,
      global_max_output_tokens: 4_096,
      show_turn_token_usage: true,
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
    },
  }
}

function modelFixture(id = 'model-one'): AgentModel {
  return {
    id,
    provider_id: 'provider-one',
    remote_model_id: `remote-${id}`,
    display_name: `Model ${id}`,
    availability: 'available' as const,
    source: 'sync' as const,
    parameter_mode: 'inherit_global' as const,
    context_window_tokens: 8_192,
    max_output_tokens: 1_024,
    default_reasoning_level: 'off' as const,
    reasoning_control: 'none' as const,
    supported_reasoning_levels: ['off'],
    supports_images: false,
    supports_reasoning: false,
    capabilities_confirmed: false,
    effective_context_window_tokens: 16_384,
    effective_max_output_tokens: 4_096,
    effective_default_reasoning_level: 'off' as const,
    revision: 1,
    first_seen_at: '2026-08-29T00:00:00Z',
    last_seen_at: '2026-08-29T00:00:00Z',
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}

function runFixture(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: 'run-active',
    client_request_id: 'request-active',
    session_id: 'session-one',
    generation: 1,
    event_sequence: 0,
    status: 'running',
    user_message_id: 'message-user',
    assistant_message_id: 'message-assistant',
    provider_id: 'provider-one',
    model_id: 'model-one',
    model_snapshot: {
      api_mode: 'responses',
      base_url: 'http://127.0.0.1:11434/v1',
      model_id: 'model',
      provider_id: 'provider-one',
      provider_name: 'Provider One',
      model_display_name: 'Model model-one',
      provider_revision: 1,
      model_revision: 1,
      context_window_tokens: 8_192,
      max_output_tokens: 1_024,
      supports_images: false,
      reasoning_control: 'none',
      supported_reasoning_levels: ['off'],
      supports_reasoning: false,
    },
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
    revision: 1,
    queued_at: '2026-08-29T00:00:00Z',
    started_at: '2026-08-29T00:00:01Z',
    updated_at: '2026-08-29T00:00:01Z',
    ...overrides,
  }
}

function launchIntent(): AgentLaunchIntent {
  return {
    key: 7,
    source: 'workbench',
    host_id: 'host-one',
    connection_status: 'failed',
    source_context: {
      kind: 'workbench',
      entity_id: 'host-one',
      title: '生产主机',
      summary: '连接已断开',
    },
  }
}
