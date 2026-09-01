import { App as AntdApp } from 'antd'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentLaunchIntent, AgentModel, AgentQueuedTurn, AgentReadiness, AgentRun, AgentSession, AgentSSHResourceState } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import { AgentRuntimeStartError, type AgentWorkspaceGateway } from '#features/agent-runtime'

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  workspaceProps: null as Record<string, unknown> | null,
  workspaceRenderCount: 0,
  createSession: vi.fn(),
  replaceResourceBinding: vi.fn(),
  removeResourceBinding: vi.fn(),
  startRun: vi.fn(),
  updateDraft: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  selectSession: vi.fn(),
  reloadContext: vi.fn(),
  reloadUsage: vi.fn(),
  reloadSession: vi.fn(),
  cancelQueuedTurnEdit: vi.fn(),
  attachmentOptions: null as null | { ensureSession: () => Promise<string> },
  attachmentRecords: {} as Record<string, unknown[]>,
  addAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  retryAttachment: vi.fn(),
  clearAttachments: vi.fn(),
  discardAttachments: vi.fn(),
  modelProviders: vi.fn(),
  models: vi.fn(),
  readiness: vi.fn(),
  updateMcpPolicy: vi.fn(),
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
      replaceResourceBinding: harness.replaceResourceBinding,
      removeResourceBinding: harness.removeResourceBinding,
      startRun: harness.startRun,
      updateDraft: harness.updateDraft,
      updateSession: harness.updateSession,
      deleteSession: harness.deleteSession,
      selectSession: harness.selectSession,
      reloadContext: harness.reloadContext,
      reloadUsage: harness.reloadUsage,
      reloadSession: harness.reloadSession,
      cancelQueuedTurnEdit: harness.cancelQueuedTurnEdit,
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
    harness.replaceResourceBinding.mockReset()
    harness.removeResourceBinding.mockReset()
    harness.replaceResourceBinding.mockResolvedValue(undefined)
    harness.removeResourceBinding.mockResolvedValue(undefined)
    harness.startRun.mockReset()
    harness.updateDraft.mockReset()
    harness.updateSession.mockReset()
    harness.deleteSession.mockReset().mockResolvedValue(undefined)
    harness.selectSession.mockReset()
    harness.reloadContext.mockReset().mockResolvedValue(undefined)
    harness.reloadUsage.mockReset().mockResolvedValue(undefined)
    harness.reloadSession.mockReset().mockResolvedValue(undefined)
    harness.cancelQueuedTurnEdit.mockReset().mockResolvedValue(undefined)
    harness.attachmentOptions = null
    harness.attachmentRecords = {}
    harness.addAttachment.mockReset()
    harness.removeAttachment.mockReset()
    harness.retryAttachment.mockReset()
    harness.clearAttachments.mockReset()
    harness.discardAttachments.mockReset().mockResolvedValue(undefined)
    harness.modelProviders.mockReset().mockResolvedValue({ items: [providerFixture()] })
    harness.models.mockReset().mockResolvedValue({ items: [modelFixture()] })
    harness.readiness.mockReset()
    harness.updateMcpPolicy.mockReset().mockResolvedValue({
      ...readinessFixture().mcp_policy,
      approval_bypass: true,
      revision: 2,
    })
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

  it('将语义化审核方式映射到带 revision 的 MCP 策略更新', async () => {
    renderPage()
    await waitFor(() => expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'ready',
      mode: 'review',
    }))

    await act(async () => {
      const changeMode = harness.workspaceProps?.onApprovalModeChange as (mode: 'bypass') => Promise<void>
      await changeMode('bypass')
    })

    expect(harness.updateMcpPolicy).toHaveBeenCalledWith({
      approval_bypass: true,
      sync_scopes: false,
      expected_revision: 1,
    })
    await waitFor(() => expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'ready',
      mode: 'bypass',
    }))
  })

  it('MCP 策略缺失时投影不可用态，不伪装为逐次审批', async () => {
    renderPage({ readiness: { ...readinessFixture(), mcp_policy: undefined } })

    await waitFor(() => expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'unavailable',
    }))
  })

  it('MCP 策略更新冲突后重新读取 readiness 对账', async () => {
    const refreshed = readinessFixture()
    refreshed.mcp_policy = {
      ...refreshed.mcp_policy!,
      approval_bypass: true,
      revision: 4,
    }
    harness.updateMcpPolicy.mockRejectedValueOnce({ code: 'AGENT_REVISION_CONFLICT' })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'ready',
      mode: 'review',
    }))
    harness.readiness.mockResolvedValue(refreshed)

    await act(async () => {
      const changeMode = harness.workspaceProps?.onApprovalModeChange as (mode: 'bypass') => Promise<void>
      await expect(changeMode('bypass')).rejects.toThrow('AGENT_MCP_POLICY_UPDATE_FAILED')
    })

    expect(harness.readiness).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'ready',
      mode: 'bypass',
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

  it('草稿输入变化时复用未变的消息投影', async () => {
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    const projectedMessages = harness.workspaceProps?.messages
    const renderCount = harness.workspaceRenderCount

    act(() => {
      const change = harness.workspaceProps?.onDraftChange as (value: string) => void
      change('流式回复期间的新草稿')
    })

    await waitFor(() => expect(harness.workspaceRenderCount).toBeGreaterThan(renderCount))
    expect(harness.workspaceProps?.messages).toBe(projectedMessages)
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

  it('取消排队消息编辑只通过状态收口清理一次新上传附件', async () => {
    const turn = queuedTurnFixture({ editing: true })
    harness.state = {
      ...workspaceState(),
      queued_turns: { 'session-one': [turn] },
      queue_states: { 'session-one': { session_id: 'session-one', state: 'running', revision: 1 } },
      queued_turn_edits: {
        'session-one': { turn_id: turn.id, text: turn.prompt, retained_attachment_ids: [] },
      },
    }
    harness.cancelQueuedTurnEdit.mockImplementation(async () => {
      harness.state = {
        ...harness.state,
        queued_turns: { 'session-one': [{ ...turn, editing: false, revision: 2 }] },
        queued_turn_edits: {},
      }
      publishState()
    })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    await act(async () => {
      const cancel = harness.workspaceProps?.onCancelQueuedTurnEdit as () => Promise<void>
      await cancel()
    })

    await waitFor(() => expect(harness.discardAttachments).toHaveBeenCalledTimes(1))
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
    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({
      resource_reference: { kind: 'ssh_session', session_id: 'ssh-session-one' },
    }))

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

  it('引用的精确 SSH 会话失效后不跟随同 Profile 新会话，并阻止发送且保留草稿', async () => {
    harness.state = {
      ...workspaceState(),
      sessions: [boundSession(), sessions[1]],
      drafts: { 'session-one': { text: '尚未发送的排查要求', updated_at: 1 } },
    }
    renderPage({ sshResourcesReady: true, sshResources: [sshResource('ssh-session-two')] })

    await waitFor(() => expect(harness.workspaceProps?.resource_context).toMatchObject({ status: 'stale' }))
    expect(harness.workspaceProps?.resource_run_blocked).toBe(true)
    await act(async () => {
      const send = harness.workspaceProps?.onSend as (message: string, ids: string[]) => Promise<void>
      await send('尚未发送的排查要求', [])
    })
    expect(harness.startRun).not.toHaveBeenCalled()
    expect((harness.state.drafts as Record<string, { text: string }>)['session-one']?.text)
      .toBe('尚未发送的排查要求')
  })

  it('Agent Workspace 权威快照恢复前把已有绑定保持为 checking 并阻止发送', async () => {
    harness.state = {
      ...workspaceState(),
      snapshot_complete: false,
      sessions: [boundSession(), sessions[1]],
      drafts: { 'session-one': { text: '等待权威状态恢复', updated_at: 1 } },
    }
    renderPage({
      sshResourcesReady: true,
      sshResources: [sshResource('ssh-session-one')],
    })

    await waitFor(() => expect(harness.workspaceProps?.resource_context)
      .toMatchObject({ status: 'checking' }))
    expect(harness.workspaceProps?.resource_run_blocked).toBe(true)
    await act(async () => {
      const send = harness.workspaceProps?.onSend as (message: string, ids: string[]) => Promise<void>
      await send('等待权威状态恢复', [])
    })
    expect(harness.startRun).not.toHaveBeenCalled()
    expect((harness.state.drafts as Record<string, { text: string }>)['session-one']?.text)
      .toBe('等待权威状态恢复')
  })

  it('显式更换与解除引用使用 Agent Session revision', async () => {
    harness.state = { ...workspaceState(), sessions: [boundSession(), sessions[1]] }
    renderPage({ sshResourcesReady: true, sshResources: [sshResource('ssh-session-two')] })
    await waitFor(() => expect(harness.workspaceProps?.resource_context).toBeDefined())

    await act(async () => {
      const replace = harness.workspaceProps?.onReplaceResourceBinding as (id: string) => Promise<boolean>
      await replace('ssh-session-two')
    })
    expect(harness.replaceResourceBinding).toHaveBeenCalledWith('session-one', {
      kind: 'ssh_session',
      session_id: 'ssh-session-two',
      expected_revision: 1,
    })

    await act(async () => {
      const remove = harness.workspaceProps?.onRemoveResourceBinding as () => Promise<boolean>
      await remove()
    })
    expect(harness.removeResourceBinding).toHaveBeenCalledWith('session-one', 1)
  })

  it('资源绑定 revision 冲突后主动恢复权威会话并保留失败结果', async () => {
    harness.state = { ...workspaceState(), sessions: [boundSession(), sessions[1]] }
    harness.replaceResourceBinding.mockRejectedValueOnce({ code: 'AGENT_REVISION_CONFLICT' })
    renderPage({ sshResourcesReady: true, sshResources: [sshResource('ssh-session-two')] })
    await waitFor(() => expect(harness.workspaceProps?.resource_context).toBeDefined())

    let result = true
    await act(async () => {
      const replace = harness.workspaceProps?.onReplaceResourceBinding as (id: string) => Promise<boolean>
      result = await replace('ssh-session-two')
    })

    expect(result).toBe(false)
    expect(harness.reloadSession).toHaveBeenCalledWith('session-one')
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

  it('恢复默认配置在一次 Session PATCH 中同时更新模型与推理强度', async () => {
    const currentModel = {
      ...modelFixture('model-current'),
      reasoning_control: 'openai_effort' as const,
      supported_reasoning_levels: ['off', 'high'] as const,
      supports_reasoning: true,
      effective_default_reasoning_level: 'high' as const,
    }
    const defaultModel = {
      ...modelFixture(),
      reasoning_control: 'openai_effort' as const,
      supported_reasoning_levels: ['off', 'low'] as const,
      supports_reasoning: true,
      effective_default_reasoning_level: 'low' as const,
    }
    harness.models.mockResolvedValue({ items: [currentModel, defaultModel] })
    harness.state = {
      ...workspaceState(),
      sessions: [{
        ...sessions[0],
        model_id: currentModel.id,
        reasoning_level: 'high',
      }, sessions[1]],
    }
    harness.updateSession.mockResolvedValue({
      ...sessions[0],
      model_id: defaultModel.id,
      reasoning_level: 'low',
    })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const reset = harness.workspaceProps?.onResetResponseOptions as () => void
      reset()
    })

    await waitFor(() => expect(harness.updateSession).toHaveBeenCalledTimes(1))
    expect(harness.updateSession).toHaveBeenCalledWith('session-one', expect.objectContaining({
      model_id: defaultModel.id,
      reasoning_level: 'low',
      expected_revision: 1,
    }))
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

  it('活动 Run 在模型目录暂缺时仍使用启动快照判断图片能力', async () => {
    harness.models.mockResolvedValue({ items: [] })
    const run = runFixture({
      model_snapshot: {
        ...runFixture().model_snapshot,
        supports_images: true,
      },
    })
    harness.state = {
      ...workspaceState(),
      active_run_id: run.id,
      runs: { [run.id]: run },
      runtime_status: { state: 'running', active_run_id: run.id, generation: run.generation },
    }

    renderPage()

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    expect(harness.workspaceProps?.supports_images).toBe(true)
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

  it('重新激活配置水合期间锁定新 Run 并在策略对账后解除', async () => {
    const pendingReadiness = deferred<AgentReadiness>()
    const refreshedReadiness = readinessFixture()
    refreshedReadiness.mcp_policy = {
      ...refreshedReadiness.mcp_policy!,
      approval_bypass: true,
      revision: 2,
    }
    const page = renderPage()
    await waitFor(() => expect(harness.workspaceProps?.run_blocked).toBe(false))

    page.rerenderPage({ active: false })
    harness.readiness.mockReturnValueOnce(pendingReadiness.promise)
    page.rerenderPage({ active: true })
    await waitFor(() => expect(harness.readiness).toHaveBeenCalledTimes(2))
    expect(harness.workspaceProps?.run_blocked).toBe(true)
    expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'unavailable',
    })
    await act(async () => {
      const send = harness.workspaceProps?.onSend as (message: string) => Promise<void>
      await send('配置水合期间不应发送')
    })
    expect(harness.startRun).not.toHaveBeenCalled()

    await act(async () => {
      pendingReadiness.resolve(refreshedReadiness)
      await pendingReadiness.promise
    })
    await waitFor(() => expect(harness.workspaceProps?.run_blocked).toBe(false))
    expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'ready',
      mode: 'bypass',
    })
  })

  it('重新激活配置水合失败后保持锁定并提供权威状态重试', async () => {
    const refreshedReadiness = readinessFixture()
    refreshedReadiness.mcp_policy = {
      ...refreshedReadiness.mcp_policy!,
      approval_bypass: true,
      revision: 2,
    }
    const page = renderPage()
    await waitFor(() => expect(harness.workspaceProps?.run_blocked).toBe(false))

    page.rerenderPage({ active: false })
    harness.readiness.mockRejectedValueOnce(new Error('readiness unavailable'))
    page.rerenderPage({ active: true })

    const retry = await waitFor(() => page.getByRole('button', { name: 'app.retry' }))
    expect(harness.workspaceProps?.run_blocked).toBe(true)
    expect(harness.workspaceProps?.approval_policy).toEqual({ status: 'unavailable' })
    harness.readiness.mockResolvedValueOnce(refreshedReadiness)
    fireEvent.click(retry)

    await waitFor(() => expect(harness.readiness).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(harness.workspaceProps?.run_blocked).toBe(false))
    expect(page.queryByRole('button', { name: 'app.retry' })).not.toBeInTheDocument()
    expect(harness.workspaceProps?.approval_policy).toEqual({
      status: 'ready',
      mode: 'bypass',
    })
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

function queuedTurnFixture(overrides: Partial<AgentQueuedTurn> = {}): AgentQueuedTurn {
  return {
    id: 'queued-one', session_id: 'session-one', client_request_id: 'request-queued',
    queue_sequence: 1, prompt: '继续检查', model_id: 'model-one', reasoning_level: 'medium',
    force_context_compression: false, state: 'queued', editing: false, revision: 1,
    created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z', attachments: [],
    ...overrides,
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
  sshResources = [],
  sshResourcesReady = false,
}: {
  launchIntent?: AgentLaunchIntent
  onLaunchIntentHandled?: (key: number) => void
  onRuntimeSummaryChange?: (snapshot: {
    agentRunCount: number
    snapshotComplete: boolean
  }) => void
  readiness?: AgentReadiness
  active?: boolean
  sshResources?: AgentSSHResourceState[]
  sshResourcesReady?: boolean
} = {}) {
  harness.readiness.mockResolvedValue(readiness)
  const setupGateway = {
    readiness: harness.readiness,
    modelProviders: harness.modelProviders,
    models: harness.models,
  } as unknown as AgentSetupGateway
  const gateway = {
    updateMcpPolicy: harness.updateMcpPolicy,
  } as unknown as AgentWorkspaceGateway
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
        sshResources={sshResources}
        sshResourcesReady={sshResourcesReady}
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

function boundSession(): AgentSession {
  return {
    ...sessions[0],
    resource_binding: {
      kind: 'ssh_session',
      session_id: 'ssh-session-one',
      host_id: 'host-one',
      ssh_profile_id: 'ssh-one',
      host_name: 'Production',
      platform: 'linux',
      bound_at: '2026-08-31T08:00:00Z',
    },
  }
}

function sshResource(sessionId: string): AgentSSHResourceState {
  return {
    session_id: sessionId,
    host_id: 'host-two',
    ssh_profile_id: 'ssh-two',
    host_name: 'Fallback',
    ssh_profile_name: 'Primary',
    status: 'ready',
    started_at: '2026-08-31T09:00:00Z',
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
    ssh_profile_id: 'ssh-one',
    host_id: 'host-one',
    connection_status: 'connected',
    resource_reference: { kind: 'ssh_session', session_id: 'ssh-session-one' },
    source_context: {
      kind: 'workbench',
      entity_id: 'host-one',
      title: '生产主机',
      summary: '连接已就绪',
    },
  }
}
