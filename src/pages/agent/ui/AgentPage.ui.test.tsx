import { App as AntdApp, ConfigProvider } from 'antd'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentFileResourceState, AgentLaunchIntent, AgentModel, AgentQueuedTurn, AgentReadiness, AgentResourceRecoveryView, AgentRun, AgentSession, AgentSessionInput, AgentSessionMetadataInput, AgentSSHResourceState } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import { AgentRuntimeStartError, type AgentWorkspaceGateway } from '#features/agent-runtime'
import { TermousApiError } from '#shared/api'
import type { AgentWorkspaceProps } from '#widgets/agent-workspace'

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  workspaceProps: null as Record<string, unknown> | null,
  archiveProps: null as Record<string, unknown> | null,
  workspaceRenderCount: 0,
  createSession: vi.fn(),
  addTerminalReference: vi.fn(),
  replaceResourceBinding: vi.fn(),
  removeResourceBinding: vi.fn(),
  recoverResourceBinding: vi.fn(),
  resourceBindingRecovery: vi.fn(),
  cancelResourceBindingRecovery: vi.fn(),
  acceptRecoveredResourceSession: vi.fn(),
  startRun: vi.fn(),
  enqueueTurn: vi.fn(),
  saveQueuedTurnEdit: vi.fn(),
  updateDraft: vi.fn(),
  updateSession: vi.fn(),
  updateSessionMetadata: vi.fn(),
  reloadSessionGroups: vi.fn(),
  createSessionGroup: vi.fn(),
  updateSessionGroup: vi.fn(),
  deleteSessionGroup: vi.fn(),
  moveSessionGroup: vi.fn(),
  moveSessionPin: vi.fn(),
  moveSession: vi.fn(),
  deleteSession: vi.fn(),
  selectSession: vi.fn(),
  reloadContext: vi.fn(),
  reloadUsage: vi.fn(),
  reloadSession: vi.fn(),
  cancelQueuedTurnEdit: vi.fn(),
  attachmentOptions: null as null | { ensureSession: () => Promise<string>; getOwnerId?: (sessionId: string) => string | undefined },
  attachmentRecords: {} as Record<string, unknown[]>,
  addAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  retryAttachment: vi.fn(),
  clearAttachments: vi.fn(),
  clearCommittedAttachments: vi.fn(),
  discardAttachments: vi.fn(),
  modelProviders: vi.fn(),
  models: vi.fn(),
  readiness: vi.fn(),
  setup: vi.fn(),
  updateMcpPolicy: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#features/agent-runtime', async () => ({
  ...await vi.importActual<typeof import('#features/agent-runtime')>('#features/agent-runtime'),
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
      createSession: async (input: AgentSessionInput, selectionRevision = harness.state.selection_intent_revision) => {
        const created = await harness.createSession(input)
        if (!(harness.state.sessions as AgentSession[]).some(({ id }) => id === created.id)) {
          harness.state = { ...harness.state, sessions: [created, ...(harness.state.sessions as AgentSession[])] }
          publishState()
        }
        if (harness.state.selection_intent_revision === selectionRevision) harness.selectSession(created.id)
        return created
      },
      replaceResourceBinding: harness.replaceResourceBinding,
      removeResourceBinding: harness.removeResourceBinding,
      acceptRecoveredResourceSession: harness.acceptRecoveredResourceSession,
      startRun: harness.startRun,
      enqueueTurn: harness.enqueueTurn,
      saveQueuedTurnEdit: harness.saveQueuedTurnEdit,
      updateDraft: harness.updateDraft,
      updateSession: harness.updateSession,
      updateSessionMetadata: harness.updateSessionMetadata,
      reloadSessionGroups: harness.reloadSessionGroups,
      createSessionGroup: harness.createSessionGroup,
      updateSessionGroup: harness.updateSessionGroup,
      deleteSessionGroup: harness.deleteSessionGroup,
      moveSessionGroup: harness.moveSessionGroup,
      moveSessionPin: harness.moveSessionPin,
      moveSession: harness.moveSession,
      deleteSession: harness.deleteSession,
      selectSession: harness.selectSession,
      reloadContext: harness.reloadContext,
      reloadUsage: harness.reloadUsage,
      reloadSession: harness.reloadSession,
      cancelQueuedTurnEdit: harness.cancelQueuedTurnEdit,
    }
  },
  useAgentDraftAttachments: (options: { ensureSession: () => Promise<string>; getOwnerId?: (sessionId: string) => string | undefined }) => {
    harness.attachmentOptions = options
    return {
      records: harness.attachmentRecords,
      add: harness.addAttachment,
      addTerminalReference: harness.addTerminalReference,
      remove: harness.removeAttachment,
      retry: harness.retryAttachment,
      clear: harness.clearAttachments,
      clearCommitted: harness.clearCommittedAttachments,
      discard: harness.discardAttachments,
      discardOwner: (sessionId: string, _owner: string, committed: boolean) => committed
        ? harness.clearAttachments(sessionId) : harness.discardAttachments(sessionId),
    }
  },
}))

vi.mock('#widgets/agent-workspace', () => ({
  AgentArchiveManager: (props: Record<string, unknown>) => {
    harness.archiveProps = props
    return <div data-testid="agent-archives" />
  },
  AgentWorkspace: (props: Record<string, unknown>) => {
    harness.workspaceRenderCount += 1
    harness.workspaceProps = props
    return <div data-testid="agent-workspace" />
  },
}))

import { AgentPage } from './AgentPage.tsx'

describe('AgentPage', () => {
  it('终端引用关联后追加已有草稿，不生成提问或运行任务', async () => {
    const source = sshResource('ssh-source')
    prepareTerminalReferenceMocks(source)
    harness.reloadSession.mockImplementation(async (id: string) => (harness.state.sessions as AgentSession[]).find((session) => session.id === id))
    harness.state.drafts = { 'session-one': { text: '原有提问', updated_at: 1 } }
    const handled = vi.fn()
    renderPage({ launchIntent: terminalReferenceIntent(source), sshResources: [source], sshResourcesReady: true, onLaunchIntentHandled: handled })
    await waitFor(() => expect(harness.addTerminalReference).toHaveBeenCalledTimes(1))
    expect(harness.replaceResourceBinding).toHaveBeenCalledWith('session-one', {
      kind: 'ssh_session', session_id: 'ssh-source', expected_revision: 1,
    })
    expect(harness.addTerminalReference).toHaveBeenCalledWith('session-one', expect.objectContaining({ text: '  first\nsecond' }), 'draft')
    expect(harness.workspaceProps?.draft).toBe('原有提问')
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.updateDraft).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
    expect(handled).toHaveBeenCalledOnce()
  })

  it('离开 AI 页面后迟到的换绑确认不弹到其他页面，返回时保留待确认引用', async () => {
    const source = sshResource('ssh-source')
    const pending = deferred<AgentSession>()
    harness.state.sessions = [boundSession()]
    harness.reloadSession.mockReturnValueOnce(pending.promise)
    const view = renderPage({ launchIntent: terminalReferenceIntent(source), sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(harness.reloadSession).toHaveBeenCalledOnce())
    view.rerenderPage({ active: false })
    await act(async () => { pending.resolve(boundSession()); await pending.promise })
    expect(view.queryByRole('dialog')).not.toBeInTheDocument()
    view.rerenderPage({ active: true })
    await waitFor(() => expect(view.getByRole('dialog')).toBeVisible())
    expect(view.getByRole('dialog')).toHaveTextContent('agent.terminalReference.confirmTitle')
    expect(harness.replaceResourceBinding).not.toHaveBeenCalled()
    expect(harness.addTerminalReference).not.toHaveBeenCalled()
  })

  it.each([false, true])('普通文件选择同步传递固定会话与编辑归属：排队编辑=%s', async (editing) => {
    if (editing) harness.state.queued_turn_edits = { 'session-one': { turn_id: 'queued-one', text: '排队提问', retained_attachment_ids: [] } }
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    const file = new File(['日志'], 'log.txt', { type: 'text/plain' })
    await act(async () => { await (harness.workspaceProps as unknown as AgentWorkspaceProps).onAttachFiles?.([file]) })
    expect(harness.addAttachment).toHaveBeenCalledWith([file], {
      sessionId: 'session-one', ownerId: editing ? expect.stringMatching(/^queued:queued-one:/) : 'draft',
    })
  })

  it('终端引用新会话同时关联来源，并将自动命名交给Core', async () => {
    const source = sshResource('ssh-source')
    prepareTerminalReferenceMocks(source)
    const intent = terminalReferenceIntent(source)
    intent.target = { kind: 'new' }
    renderPage({ launchIntent: intent, sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(harness.addTerminalReference).toHaveBeenCalledTimes(1))
    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({
      auto_title_allowed: true, resource_reference: { kind: 'ssh_session', session_id: 'ssh-source' },
    }))
    expect(harness.addTerminalReference).toHaveBeenCalledWith('session-created', expect.anything(), 'draft')
    expect(harness.updateDraft).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
  })

  it.each(['terminal_selection', 'connection_reference'] as const)('%s 等待附件会话时用户切换目标，随后创建不得抢回选择', async (sourceKind) => {
    const source = sshResource('ssh-source')
    prepareTerminalReferenceMocks(source)
    const pendingAttachment = deferred<AgentSession>()
    harness.createSession.mockImplementationOnce(() => pendingAttachment.promise)
    harness.state = { ...workspaceState(), selected_session_id: undefined, new_session_selected: true }
    const page = renderPage({ sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(harness.attachmentOptions).not.toBeNull())
    let attachmentCreation!: Promise<string>
    act(() => { attachmentCreation = harness.attachmentOptions!.ensureSession() })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledOnce())
    const intent: AgentLaunchIntent = sourceKind === 'terminal_selection'
      ? { ...terminalReferenceIntent(source), target: { kind: 'new' } }
      : { key: 32, source: 'connection_reference', target: { kind: 'new' }, source_resource: source,
        resource_reference: { kind: 'ssh_session', session_id: source.session_id } }
    page.rerenderPage({ launchIntent: intent })
    await act(async () => { await Promise.resolve() })
    act(() => { harness.selectSession('session-two') })
    await act(async () => {
      pendingAttachment.resolve({ ...sessions[0]!, id: 'session-attachment' })
      await attachmentCreation
    })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(2))
    await waitFor(() => expect((harness.state.sessions as AgentSession[]).some(({ id }) => id === 'session-created')).toBe(true))
    expect(harness.state.selected_session_id).toBe('session-two')
    expect(harness.selectSession).not.toHaveBeenCalledWith('session-created')
    expect(harness.startRun).not.toHaveBeenCalled()
  })

  it('新草稿的文件校验尚未完成时切换会话，目标创建守卫失效且不因切回而恢复', async () => {
    harness.state = { ...harness.state, selected_session_id: undefined, new_session_selected: true }
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    const file = new File(['日志'], 'log.txt', { type: 'text/plain' })
    await act(async () => { await (harness.workspaceProps as unknown as AgentWorkspaceProps).onAttachFiles?.([file]) })
    const canEnsureSession = harness.addAttachment.mock.calls[0]?.[2] as () => boolean
    expect(canEnsureSession()).toBe(true)
    act(() => harness.selectSession('session-two'))
    expect(canEnsureSession()).toBe(false)
    act(() => harness.selectSession(undefined))
    expect(canEnsureSession()).toBe(false)
    expect(harness.createSession).not.toHaveBeenCalled()
  })

  it.each(['send', 'queue'] as const)('%s回执晚于新增终端引用时只释放本次提交的附件', async (action) => {
    const source = { ...sshResource('ssh-session-one'), host_id: 'host-one', ssh_profile_id: 'ssh-one' }
    prepareTerminalReferenceMocks(source)
    harness.state.sessions = [boundSession()]
    harness.reloadSession.mockImplementation(async () => boundSession())
    const pending = deferred<void>()
    const request = action === 'send' ? harness.startRun : harness.enqueueTurn
    request.mockReturnValueOnce(pending.promise)
    const view = renderPage({ sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    let submitting: Promise<void> | undefined
    act(() => {
      const workspace = harness.workspaceProps as unknown as AgentWorkspaceProps
      submitting = (action === 'send' ? workspace.onSend : workspace.onQueueTurn)('已提交提问', ['attachment-submitted'])
    })
    await waitFor(() => expect(request).toHaveBeenCalledOnce())
    view.rerenderPage({ launchIntent: terminalReferenceIntent(source) })
    await waitFor(() => expect(harness.addTerminalReference).toHaveBeenCalledOnce())
    await act(async () => { pending.resolve(); await submitting })
    expect(harness.clearCommittedAttachments).toHaveBeenCalledExactlyOnceWith('session-one', ['attachment-submitted'])
    expect(harness.clearAttachments).not.toHaveBeenCalled()
  })

  it('排队编辑保存期间保留待引用原文，保存结束后由用户重试接入当前草稿', async () => {
    const source = { ...sshResource('ssh-session-one'), host_id: 'host-one', ssh_profile_id: 'ssh-one' }
    prepareTerminalReferenceMocks(source)
    harness.state.sessions = [boundSession()]
    harness.state.queued_turns = { 'session-one': [queuedTurnFixture({ editing: true })] }
    harness.state.queued_turn_edits = { 'session-one': { turn_id: 'queued-one', text: '正在保存', retained_attachment_ids: [] } }
    harness.reloadSession.mockImplementation(async () => boundSession())
    const pending = deferred<void>()
    harness.saveQueuedTurnEdit.mockImplementation(async () => {
      await pending.promise
      harness.state = { ...harness.state, queued_turn_edits: {} }
      publishState()
    })
    const view = renderPage({ sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    let saving: Promise<void> | undefined
    act(() => { saving = (harness.workspaceProps as unknown as AgentWorkspaceProps).onSaveQueuedTurnEdit([]) })
    await waitFor(() => expect(harness.saveQueuedTurnEdit).toHaveBeenCalledOnce())
    expect(harness.attachmentOptions?.getOwnerId?.('session-one')).toBeUndefined()
    view.rerenderPage({ launchIntent: terminalReferenceIntent(source) })
    await waitFor(() => expect(view.getByText('agent.terminalReference.errors.AGENT_TERMINAL_REFERENCE_EDIT_SAVING')).toBeVisible())
    expect(harness.addTerminalReference).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(); await saving })
    expect(harness.addTerminalReference).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'app.retry' }))
    await waitFor(() => expect(harness.addTerminalReference).toHaveBeenCalledExactlyOnceWith(
      'session-one', expect.objectContaining({ text: '  first\nsecond' }), 'draft',
    ))
  })

  it('同源引用进入正在编辑的队列项，普通草稿不受影响', async () => {
    const source = { ...sshResource('ssh-session-one'), host_id: 'host-one', ssh_profile_id: 'ssh-one' }
    prepareTerminalReferenceMocks(source)
    harness.state.sessions = [boundSession()]
    harness.state.drafts = { 'session-one': { text: '普通草稿', updated_at: 1 } }
    harness.state.queued_turns = { 'session-one': [queuedTurnFixture({ editing: true })] }
    harness.state.queued_turn_edits = { 'session-one': { turn_id: 'queued-one', text: '编辑中的提问', retained_attachment_ids: [] } }
    harness.reloadSession.mockImplementation(async () => boundSession())
    renderPage({ launchIntent: terminalReferenceIntent(source), sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(harness.addTerminalReference).toHaveBeenCalledTimes(1))
    expect(harness.addTerminalReference).toHaveBeenCalledWith('session-one', expect.anything(), expect.stringMatching(/^queued:queued-one:/))
    expect(harness.workspaceProps?.draft).toBe('普通草稿')
    expect(harness.startRun).not.toHaveBeenCalled()
  })
  beforeEach(() => {
    harness.listeners.clear()
    harness.workspaceProps = null
    harness.archiveProps = null
    harness.workspaceRenderCount = 0
    harness.createSession.mockReset()
    harness.addTerminalReference.mockReset().mockResolvedValue(true)
    harness.replaceResourceBinding.mockReset()
    harness.removeResourceBinding.mockReset()
    harness.recoverResourceBinding.mockReset()
    harness.resourceBindingRecovery.mockReset().mockResolvedValue({ instance_id: 'core-one', kind: 'ssh_session', can_recover: true, operation: null })
    harness.cancelResourceBindingRecovery.mockReset()
    harness.acceptRecoveredResourceSession.mockReset()
    harness.replaceResourceBinding.mockResolvedValue(undefined)
    harness.removeResourceBinding.mockResolvedValue(undefined)
    harness.startRun.mockReset()
    harness.enqueueTurn.mockReset().mockResolvedValue(undefined)
    harness.saveQueuedTurnEdit.mockReset().mockResolvedValue(undefined)
    harness.updateDraft.mockReset()
    harness.updateSession.mockReset()
    harness.updateSessionMetadata.mockReset()
    harness.reloadSessionGroups.mockReset().mockResolvedValue(undefined)
    harness.createSessionGroup.mockReset().mockResolvedValue(undefined)
    harness.updateSessionGroup.mockReset().mockResolvedValue(undefined)
    harness.deleteSessionGroup.mockReset().mockResolvedValue(undefined)
    harness.moveSessionGroup.mockReset().mockResolvedValue(undefined)
    harness.moveSessionPin.mockReset().mockResolvedValue(undefined)
    harness.moveSession.mockReset().mockResolvedValue(undefined)
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
    harness.clearCommittedAttachments.mockReset()
    harness.discardAttachments.mockReset().mockResolvedValue(undefined)
    harness.modelProviders.mockReset().mockResolvedValue({ items: [providerFixture()] })
    harness.models.mockReset().mockResolvedValue({ items: [modelFixture()] })
    harness.readiness.mockReset()
    harness.setup.mockReset().mockResolvedValue(readinessFixture())
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
    harness.updateSessionMetadata.mockImplementation(async (id: string, input: AgentSessionMetadataInput) => {
      const current = (harness.state.sessions as AgentSession[]).find((session) => session.id === id)!
      const updated = { ...current, ...input, revision: current.revision + 1 }
      harness.state = { ...harness.state, sessions: (harness.state.sessions as AgentSession[]).map((session) => session.id === id ? updated : session) }
      publishState()
      return updated
    })
    harness.createSession.mockImplementation(async (input: AgentSessionInput) => {
      const created = { ...sessions[0], id: 'session-created', title: input.title, group_id: input.group_id }
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
    harness.updateSessionMetadata.mockResolvedValue({ ...sessions[0], archived_at: '2026-08-29T02:00:00Z' })
    renderPage()

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    await act(async () => {
      const archive = harness.workspaceProps?.onArchiveSession as (sessionId: string) => void
      archive('session-one')
    })

    await waitFor(() => expect(harness.updateSessionMetadata).toHaveBeenCalledWith('session-one', { archived: true, expected_revision: 1 }))
    expect(harness.updateSession).not.toHaveBeenCalled()
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
    harness.updateSessionMetadata.mockResolvedValue({ ...sessions[1], archived_at: '2026-08-29T02:00:00Z' })
    renderPage()

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    await act(async () => {
      const archive = harness.workspaceProps?.onArchiveSession as (sessionId: string) => void
      archive('session-two')
    })

    await waitFor(() => expect(harness.updateSessionMetadata).toHaveBeenCalledTimes(1))
    expect(harness.selectSession).not.toHaveBeenCalled()
  })

  it('归档响应迟到时不覆盖用户切换到的新会话草稿', async () => {
    const pending = deferred<AgentSession>()
    harness.updateSessionMetadata.mockReturnValueOnce(pending.promise)
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const archive = harness.workspaceProps?.onArchiveSession as (sessionId: string) => void
      archive('session-one')
    })
    await waitFor(() => expect(harness.updateSessionMetadata).toHaveBeenCalledTimes(1))
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
    expect(harness.startRun).toHaveBeenCalledWith('session-created', '保留的本地草稿', undefined)
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

  it('附件预建会话将自动标题交给 Core，首次发送只提交附件 ID', async () => {
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

    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({ auto_title_allowed: true }))
    expect(harness.updateSession).not.toHaveBeenCalled()
    expect(harness.updateSessionMetadata).not.toHaveBeenCalled()
    expect(harness.startRun).toHaveBeenCalledWith(
      'session-created', '检查生产连接', ['attachment-one'],
    )
    expect(harness.clearCommittedAttachments).toHaveBeenCalledWith('session-created', ['attachment-one'])
  })

  it('组内新会话只记录草稿分组，首发才携带 group_id 创建', async () => {
    harness.state = { ...harness.state, session_groups: [sessionGroupFixture()] }
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    act(() => {
      const create = harness.workspaceProps?.onCreateSession as (groupId?: string) => void
      create('group-ops')
    })
    expect(harness.createSession).not.toHaveBeenCalled()
    await act(async () => {
      const send = harness.workspaceProps?.onSend as (message: string) => Promise<void>
      await send('检查磁盘空间')
    })
    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({ group_id: 'group-ops', title: '检查磁盘空间' }))
    expect(harness.createSession.mock.calls[0]?.[0].auto_title_allowed).not.toBe(true)
  })

  it('组内附件草稿携带分组，人工命名为新会话后首发不覆盖标题', async () => {
    harness.state = { ...harness.state, session_groups: [sessionGroupFixture()] }
    renderPage()
    await waitFor(() => expect(harness.attachmentOptions).not.toBeNull())
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    act(() => {
      const create = harness.workspaceProps?.onCreateSession as (groupId?: string) => void
      create('group-ops')
    })
    await act(async () => { await harness.attachmentOptions!.ensureSession() })
    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({ group_id: 'group-ops', auto_title_allowed: true }))
    await act(async () => { await sessionManagement().onRename?.('session-created', '新会话') })
    expect(harness.updateSessionMetadata).toHaveBeenCalledWith('session-created', { title: '新会话', expected_revision: 1 })
    await act(async () => {
      const send = harness.workspaceProps?.onSend as (message: string, attachments: string[]) => Promise<void>
      await send('这条提示不能再改标题', ['attachment-one'])
    })
    expect(harness.updateSessionMetadata).toHaveBeenCalledTimes(1)
    expect(harness.updateSession).not.toHaveBeenCalled()
    expect((harness.state.sessions as AgentSession[]).find(({ id }) => id === 'session-created')?.title).toBe('新会话')
    expect(harness.startRun).toHaveBeenCalledWith('session-created', '这条提示不能再改标题', ['attachment-one'])
  })

  it('附件会话创建期间继续输入，完成后迁移最新草稿', async () => {
    const pending = deferred<AgentSession>()
    harness.createSession.mockImplementationOnce(() => pending.promise)
    renderPage()
    await waitFor(() => expect(harness.attachmentOptions).not.toBeNull())
    await waitFor(() => expect(harness.workspaceProps?.onCreateSession).toBeTypeOf('function'))
    act(() => {
      (harness.workspaceProps?.onCreateSession as () => void)()
      harness.updateDraft('new', '原始草稿')
    })
    let creating!: Promise<string>
    act(() => { creating = harness.attachmentOptions!.ensureSession() })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledOnce())
    act(() => { (harness.workspaceProps?.onDraftChange as (value: string) => void)('原始草稿，继续补充约束') })
    pending.resolve({ ...sessions[0], id: 'session-attachment' })
    await act(async () => { await creating })
    expect(harness.workspaceProps?.selected_session_id).toBe('session-attachment')
    expect(harness.updateDraft).toHaveBeenCalledWith('session-attachment', '原始草稿，继续补充约束')
    expect((harness.state.drafts as Record<string, unknown>).new).toBeUndefined()
  })

  it('附件创建迟到不抢选另一分组的新草稿，也不清除它的分组归属', async () => {
    const pending = deferred<AgentSession>()
    harness.state = { ...harness.state, session_groups: [sessionGroupFixture(), { ...sessionGroupFixture(), id: 'group-other', name: 'Other' }] }
    harness.createSession.mockImplementationOnce(() => pending.promise)
    renderPage()
    await waitFor(() => expect(harness.attachmentOptions).not.toBeNull())
    await waitFor(() => expect(harness.workspaceProps?.onCreateSession).toBeTypeOf('function'))
    act(() => {
      (harness.workspaceProps?.onCreateSession as (id: string) => void)('group-ops')
      harness.updateDraft('new', '原分组附件草稿')
    })
    let creating!: Promise<string>
    act(() => { creating = harness.attachmentOptions!.ensureSession() })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledOnce())
    act(() => {
      (harness.workspaceProps?.onCreateSession as (id: string) => void)('group-other')
      harness.updateDraft('new', '另一个分组的新草稿')
    })
    pending.resolve({ ...sessions[0], id: 'session-attachment', group_id: 'group-ops' })
    await act(async () => { await creating })
    expect(harness.workspaceProps?.selected_session_id).toBeUndefined()
    expect(harness.workspaceProps?.draft).toBe('另一个分组的新草稿')
    expect(harness.updateDraft).toHaveBeenCalledWith('session-attachment', '原分组附件草稿')
    expect(harness.selectSession).not.toHaveBeenCalledWith('session-attachment')
    await act(async () => {
      await (harness.workspaceProps?.onSend as (value: string) => Promise<void>)('另一个分组的新草稿')
    })
    expect(harness.createSession.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ group_id: 'group-other' }))
  })

  it('首发创建迟到仍提交原消息，但保留用户另开的新草稿', async () => {
    const pending = deferred<AgentSession>()
    harness.state = { ...harness.state, session_groups: [sessionGroupFixture()] }
    harness.createSession.mockImplementationOnce(() => pending.promise)
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    act(() => {
      (harness.workspaceProps?.onCreateSession as () => void)()
      harness.updateDraft('new', '已提交的原消息')
    })
    let sending!: Promise<void>
    act(() => { sending = (harness.workspaceProps?.onSend as (text: string) => Promise<void>)('已提交的原消息') })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledOnce())
    act(() => {
      (harness.workspaceProps?.onCreateSession as (id: string) => void)('group-ops')
      harness.updateDraft('new', '后开的草稿')
    })
    pending.resolve({ ...sessions[0], id: 'session-delayed' })
    await act(async () => { await sending })
    expect(harness.startRun).toHaveBeenCalledWith('session-delayed', '已提交的原消息', undefined)
    expect(harness.workspaceProps?.selected_session_id).toBeUndefined()
    expect(harness.workspaceProps?.draft).toBe('后开的草稿')
    await act(async () => {
      await (harness.workspaceProps?.onSend as (text: string) => Promise<void>)('后开的草稿')
    })
    expect(harness.createSession.mock.calls[1]?.[0]).toEqual(expect.objectContaining({ group_id: 'group-ops' }))
  })

  it('拖进分组头在一次元数据提交中取消置顶，菜单移组仍保留置顶归属', async () => {
    harness.state = { ...workspaceState(), session_groups: [sessionGroupFixture()] }
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    await act(async () => { await sessionManagement().onMoveToGroup('session-one', 'group-ops', true) })
    expect(harness.updateSessionMetadata).toHaveBeenNthCalledWith(1, 'session-one', { group_id: 'group-ops', pinned: false, expected_revision: 1 })
    await act(async () => { await sessionManagement().onMoveToGroup('session-two', 'group-ops') })
    expect(harness.updateSessionMetadata).toHaveBeenNthCalledWith(2, 'session-two', { group_id: 'group-ops', expected_revision: 1 })
    await act(async () => { await sessionManagement().onMoveSession('session-one', 'session-two', 'after') })
    expect(harness.moveSession).toHaveBeenCalledWith('session-one', { expected_revision: 2, target_id: 'session-two', target_expected_revision: 2, placement: 'after' })
    expect(harness.updateSession).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
  })

  it('运行中元数据保存只锁当前行，输入草稿与其他会话操作保持可用', async () => {
    const pending = deferred<AgentSession>()
    const run = runFixture()
    harness.state = { ...workspaceState(), active_run_id: run.id, runs: { [run.id]: run }, drafts: { 'session-one': { text: '尚未发送', updated_at: 1 } } }
    harness.updateSessionMetadata.mockReturnValueOnce(pending.promise)
    renderPage()
    await waitFor(() => expect(harness.workspaceProps?.draft).toBe('尚未发送'))
    let rename!: Promise<void>
    act(() => { rename = sessionManagement().onRename!('session-one', '正在排查') })
    await waitFor(() => expect(sessionManagement().pendingIds?.has('session-one')).toBe(true))
    expect(sessionManagement().pendingIds?.has('session-two')).toBe(false)
    expect(harness.workspaceProps?.busy).toBe(false)
    expect(sessionManagement().disabled).toBe(false)
    act(() => {
      const change = harness.workspaceProps?.onDraftChange as (value: string) => void
      change('保存标题期间继续输入')
    })
    pending.resolve({ ...sessions[0], title: '正在排查', revision: 2 })
    await act(async () => { await rename })
    expect(harness.workspaceProps?.draft).toBe('保存标题期间继续输入')
    expect(harness.selectSession).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
  })

  it('移组清空只发送窄字段，归档面板关闭后仍保留原会话草稿', async () => {
    harness.state = { ...workspaceState(), drafts: { 'session-one': { text: '保留主会话输入', updated_at: 1 } } }
    const view = renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    await act(async () => { await sessionManagement().onMoveToGroup?.('session-two', undefined) })
    expect(harness.updateSessionMetadata).toHaveBeenCalledWith('session-two', { group_id: '', expected_revision: 1 })
    expect(harness.updateSession).not.toHaveBeenCalled()
    act(() => sessionManagement().onOpenArchives?.())
    await waitFor(() => expect(harness.archiveProps?.open).toBe(true))
    view.rerenderPage({ active: false })
    await waitFor(() => expect(harness.archiveProps?.open).toBe(false))
    expect(harness.workspaceProps?.selected_session_id).toBe('session-one')
    expect(harness.workspaceProps?.draft).toBe('保留主会话输入')
    view.rerenderPage({ active: true })
    await waitFor(() => expect(harness.archiveProps?.open).toBe(true))
    act(() => (harness.archiveProps?.onClose as () => void)())
    await waitFor(() => expect(harness.archiveProps?.open).toBe(false))
    expect(harness.workspaceProps?.selected_session_id).toBe('session-one')
    expect(harness.workspaceProps?.draft).toBe('保留主会话输入')
    expect(harness.selectSession).not.toHaveBeenCalled()
  })

  it('无活跃会话时恢复归档会撤回 WS 自动选择并返回原本草稿', async () => {
    const archived = { ...sessions[0], id: 'session-archived', archived_at: '2026-08-29T03:00:00Z' }
    harness.state = {
      ...workspaceState(), sessions: [], selected_session_id: undefined, new_session_selected: false,
      drafts: { new: { text: '恢复前尚未发送的草稿', updated_at: 1 } },
    }
    harness.updateSessionMetadata.mockImplementationOnce(async () => {
      const restored = { ...archived, archived_at: undefined, revision: 2 }
      // 首个活跃会话由 WS 自动选中，不代表用户产生了新的选择意图。
      harness.state = { ...harness.state, sessions: [restored], selected_session_id: restored.id }
      publishState()
      return restored
    })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps?.draft).toBe('恢复前尚未发送的草稿'))
    act(() => sessionManagement().onOpenArchives?.())
    await waitFor(() => expect(harness.archiveProps?.open).toBe(true))
    await act(async () => {
      const restore = harness.archiveProps?.onRestore as (session: AgentSession) => Promise<void>
      await restore(archived)
    })
    expect(harness.updateSessionMetadata).toHaveBeenCalledWith(archived.id, { archived: false, expected_revision: 1 })
    expect(harness.selectSession).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(harness.workspaceProps?.selected_session_id).toBeUndefined()
    expect(harness.workspaceProps?.draft).toBe('恢复前尚未发送的草稿')
    expect(harness.createSession).not.toHaveBeenCalled()
  })

  it('恢复归档等待期间用户主动切换会话，迟到回执不会抢回旧选择', async () => {
    const archived = { ...sessions[0], id: 'session-archived', archived_at: '2026-08-29T03:00:00Z' }
    const pending = deferred<AgentSession>()
    harness.state = { ...workspaceState(), drafts: { 'session-two': { text: '新选择的会话草稿', updated_at: 1 } } }
    harness.updateSessionMetadata.mockImplementationOnce(async () => {
      const restored = await pending.promise
      harness.state = { ...harness.state, sessions: [...(harness.state.sessions as AgentSession[]), restored] }
      publishState()
      return restored
    })
    renderPage()
    await waitFor(() => expect(harness.workspaceProps?.selected_session_id).toBe('session-one'))
    act(() => sessionManagement().onOpenArchives?.())
    await waitFor(() => expect(harness.archiveProps?.open).toBe(true))
    let restoring!: Promise<void>
    act(() => {
      const restore = harness.archiveProps?.onRestore as (session: AgentSession) => Promise<void>
      restoring = restore(archived)
    })
    await waitFor(() => expect(harness.updateSessionMetadata).toHaveBeenCalledOnce())
    act(() => {
      const select = harness.workspaceProps?.onSelectSession as (id: string) => void
      select('session-two')
    })
    expect(harness.state.selection_intent_revision).toBe(1)
    pending.resolve({ ...archived, archived_at: undefined, revision: 2 })
    await act(async () => { await restoring })
    expect(harness.selectSession).toHaveBeenCalledExactlyOnceWith('session-two')
    expect(harness.workspaceProps?.selected_session_id).toBe('session-two')
    expect(harness.workspaceProps?.draft).toBe('新选择的会话草稿')
  })

  it('Run 已创建但 Runtime 启动失败时清理已提交附件', async () => {
    harness.startRun.mockRejectedValueOnce(new AgentRuntimeStartError(
      'AGENT_RUNTIME_START_REJECTED',
      { session_id: 'session-one' } as AgentRun,
    ))
    renderPage()
    await waitFor(() => expect(harness.workspaceProps?.run_blocked).toBe(false))

    await act(async () => {
      const send = harness.workspaceProps?.onSend as (
        message: string,
        attachmentIds: string[],
      ) => Promise<void>
      await send('检查生产连接', ['attachment-one'])
    })

    expect(harness.clearCommittedAttachments).toHaveBeenCalledWith('session-one', ['attachment-one'])
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
    expect(harness.clearCommittedAttachments).not.toHaveBeenCalled()
  })

  it('引用的精确 SSH 会话失效后不跟随同 Profile 新会话，并阻止发送且保留草稿', async () => {
    harness.state = {
      ...workspaceState(),
      sessions: [boundSession(), sessions[1]],
      drafts: { 'session-one': { text: '尚未发送的排查要求', updated_at: 1 } },
    }
    renderPage({ sshResourcesReady: true, sshResources: [sshResource('ssh-session-two')] })

    await waitFor(() => expect((harness.workspaceProps?.resource_contexts as Array<{ status: string }> | undefined)?.[0]).toMatchObject({ status: 'stale' }))
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

    await waitFor(() => expect((harness.workspaceProps?.resource_contexts as Array<{ status: string }> | undefined)?.[0])
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
    await waitFor(() => expect((harness.workspaceProps?.resource_contexts as Array<{ status: string }> | undefined)?.[0]).toBeDefined())

    await act(async () => {
      const replace = harness.workspaceProps?.onReplaceResourceBinding as (reference: { kind: 'ssh_session'; session_id: string }) => Promise<boolean>
      await replace({ kind: 'ssh_session', session_id: 'ssh-session-two' })
    })
    expect(harness.replaceResourceBinding).toHaveBeenCalledWith('session-one', {
      kind: 'ssh_session',
      session_id: 'ssh-session-two',
      expected_revision: 1,
    })

    await act(async () => {
      const remove = harness.workspaceProps?.onRemoveResourceBinding as (kind: 'ssh_session') => Promise<boolean>
      await remove('ssh_session')
    })
    expect(harness.removeResourceBinding).toHaveBeenCalledWith('session-one', 1, 'ssh_session')
  })

  it('恢复完成在右上角提示 2 秒，状态刷新不重置计时或再次弹出', async () => {
    const source = boundSession()
    const recovered = { ...source, revision: source.revision + 1,
      resource_bindings: source.resource_bindings!.map((binding) => ({ ...binding, session_id: 'ssh-recovered' })) }
    harness.state = { ...workspaceState(), sessions: [source, sessions[1]] }
    harness.acceptRecoveredResourceSession.mockImplementation((session: AgentSession) => {
      harness.state = { ...harness.state, sessions: [session, sessions[1]] }
      publishState()
    })
    harness.recoverResourceBinding.mockImplementation(async (_id: string, input: { client_request_id: string }) => {
      const view: AgentResourceRecoveryView = { instance_id: 'core-one', kind: 'ssh_session', can_recover: false, blocked_reason: 'ready', operation: {
        id: 'recovery-one', instance_id: 'core-one', session_id: source.id, kind: 'ssh_session', client_request_id: input.client_request_id,
        revision: 3, status: 'succeeded', source_binding: source.resource_bindings![0] as NonNullable<AgentResourceRecoveryView['operation']>['source_binding'],
        retryable: false, created_at: source.created_at, updated_at: source.updated_at, result_session: recovered,
      } }
      harness.resourceBindingRecovery.mockResolvedValue(view)
      return view
    })
    const page = renderPage({ sshResourcesReady: true })
    await waitFor(() => expect(harness.workspaceProps?.resource_recovery_disabled).toBe(false))
    vi.useFakeTimers()
    try {
      await act(async () => { await (harness.workspaceProps?.onRecoverResourceBinding as () => Promise<boolean>)() })
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
      expect(page.getByText('agent.resource.recovery.completed').closest('.ant-notification-topRight')).not.toBeNull()
      expect(document.querySelectorAll('.ant-notification-notice')).toHaveLength(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1700) })
      act(() => { harness.state = { ...harness.state, sessions: [...harness.state.sessions as AgentSession[]] }; publishState() })
      expect(page.getByText('agent.resource.recovery.completed')).toBeInTheDocument()
      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(page.queryByText('agent.resource.recovery.completed')).not.toBeInTheDocument()
      expect(harness.startRun).not.toHaveBeenCalled()
      expect(harness.updateDraft).not.toHaveBeenCalled()
    } finally { page.unmount(); vi.useRealTimers() }
  })

  it('待派发消息存在时允许恢复，只封锁当前会话的发送和继续队列并保留草稿', async () => {
    const source = boundSession()
    harness.state = { ...workspaceState(), sessions: [source, sessions[1]], drafts: { 'session-one': { text: '保留草稿', updated_at: 1 } },
      queued_turns: { 'session-one': [queuedTurnFixture({ editing: false })] },
      queue_states: { 'session-one': { session_id: 'session-one', state: 'paused', revision: 1 } } }
    const view: AgentResourceRecoveryView = { instance_id: 'core-one', kind: 'ssh_session', can_recover: false, blocked_reason: 'recovering', operation: {
      id: 'recovery-one', instance_id: 'core-one', session_id: source.id, kind: 'ssh_session', client_request_id: 'request',
      revision: 1, status: 'connecting', source_binding: source.resource_bindings![0] as NonNullable<AgentResourceRecoveryView['operation']>['source_binding'],
      retryable: true, created_at: source.created_at, updated_at: source.updated_at,
    } }
    harness.recoverResourceBinding.mockResolvedValue(view)
    renderPage({ sshResourcesReady: true })
    await waitFor(() => expect(harness.workspaceProps?.resource_recovery_disabled).toBe(false))
    await act(async () => { await (harness.workspaceProps?.onRecoverResourceBinding as () => Promise<boolean>)() })
    expect(harness.recoverResourceBinding).toHaveBeenCalledWith('session-one', {
      kind: 'ssh_session', expected_revision: source.revision, client_request_id: expect.any(String),
    })
    expect(harness.workspaceProps?.resource_recovery_blocked).toBe(true)
    expect(harness.workspaceProps?.busy).toBe(false)
    await act(async () => { await (harness.workspaceProps?.onQueueTurn as (text: string, ids: string[]) => Promise<void>)('不应排队', []) })
    expect(harness.enqueueTurn).not.toHaveBeenCalled()
    expect(harness.updateDraft).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
  })

  it('文件 profile 就绪不受 SSH 实时快照等待影响', async () => {
    const file: AgentFileResourceState = { file_access_profile_id: 'files', file_access_profile_name: '文件配置',
      host_id: 'host', host_name: '主机', ssh_profile_id: 'ssh-profile', engine: 'sftp', status: 'ready' }
    harness.state = { ...workspaceState(), sessions: [{ ...sessions[0]!, resource_bindings: [{ ...file, kind: 'file_profile', bound_at: sessions[0]!.created_at }] }] }
    renderPage({ sshResourcesReady: false, fileResources: [file], fileResourcesReady: true })
    await waitFor(() => expect(harness.workspaceProps?.resource_contexts).toEqual([expect.objectContaining({ status: 'ready' })]))
    expect(harness.workspaceProps?.resource_run_blocked).toBe(false)
    expect(harness.resourceBindingRecovery).not.toHaveBeenCalled()
  })

  it('文件引用接管后清除导航意图，异步完成仍使用文件目录的就绪状态', async () => {
    const file: AgentFileResourceState = { file_access_profile_id: 'files', file_access_profile_name: '文件配置',
      host_id: 'host', host_name: '主机', ssh_profile_id: 'ssh-profile', engine: 'sftp', status: 'ready' }
    const pending = deferred<AgentSession>()
    harness.createSession.mockImplementationOnce(() => pending.promise)
    const onLaunchIntentHandled = vi.fn()
    const page = renderPage({ sshResourcesReady: false, fileResources: [file], fileResourcesReady: true,
      onLaunchIntentHandled, launchIntent: { key: 35, source: 'connection_reference', target: { kind: 'new' },
        source_resource: file, resource_reference: { kind: 'file_profile', file_access_profile_id: file.file_access_profile_id } } })
    await waitFor(() => expect(harness.createSession).toHaveBeenCalledOnce())
    expect(onLaunchIntentHandled).toHaveBeenCalledWith(35)
    page.rerenderPage({ launchIntent: null })
    await act(async () => {
      pending.resolve({ ...sessions[0]!, id: 'session-file', resource_bindings: [
        { ...file, kind: 'file_profile', bound_at: sessions[0]!.created_at },
      ] })
      await pending.promise
    })
    await waitFor(() => expect(harness.workspaceProps?.composerFocusKey).toBe(1))
    expect(harness.workspaceProps?.resource_run_blocked).toBe(false)
    expect(harness.updateDraft).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
    expect(harness.addTerminalReference).not.toHaveBeenCalled()
  })

  it.each(['skills_bundle', 'mcp_runtime', 'mcp_client'] as const)('%s 未就绪时已有引用仍可访问，执行和新建入口保持关闭', async (component) => {
    const readiness = readinessFixture('needs_setup')
    readiness[component] = { status: 'missing', message: '尚未准备' }
    const source = boundSession()
    harness.state = { ...workspaceState(), sessions: [source, sessions[1]], drafts: { 'session-one': { text: '环境未就绪时的草稿', updated_at: 1 } } }
    harness.recoverResourceBinding.mockResolvedValue({ instance_id: 'core-one', kind: 'ssh_session', can_recover: true, operation: null })
    const page = renderPage({ readiness, sshResourcesReady: true })
    await waitFor(() => expect(harness.workspaceProps?.execution_blocked).toBe(true))
    expect(page.getByText('agent.resource.recovery.infrastructureUnavailable')).toBeInTheDocument()
    expect(harness.workspaceProps?.resource_contexts).toHaveLength(1)
    expect(harness.workspaceProps?.resource_recovery_disabled).toBe(false)
    expect(harness.workspaceProps?.busy).toBe(false)
    await act(async () => {
      const props = harness.workspaceProps as unknown as AgentWorkspaceProps
      props.onCreateSession()
      await props.onSend('不能执行', [])
      await props.onQueueTurn('不能追加', [])
      await props.onResumeQueue()
      props.onContextCompressionPendingChange(true)
      await props.onRecoverResourceBinding!()
    })
    expect(harness.selectSession).not.toHaveBeenCalled()
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
    expect(harness.enqueueTurn).not.toHaveBeenCalled()
    expect(harness.updateDraft).not.toHaveBeenCalled()
    expect(harness.recoverResourceBinding).toHaveBeenCalledOnce()
  })

  it('同页准备 MCP 环境成功后重新查询恢复能力，不依赖会话或配置目录变化', async () => {
    const readiness = readinessFixture('needs_setup')
    readiness.mcp_client = { status: 'missing', message: 'MCP 尚未准备' }
    harness.state = { ...workspaceState(), sessions: [boundSession()] }
    harness.resourceBindingRecovery.mockResolvedValue({ instance_id: 'core-one', kind: 'ssh_session',
      can_recover: false, blocked_reason: 'mcp_unavailable', operation: null })
    harness.setup.mockImplementationOnce(async () => {
      harness.resourceBindingRecovery.mockResolvedValue({ instance_id: 'core-one', kind: 'ssh_session', can_recover: true, operation: null })
      return readinessFixture()
    })
    const page = renderPage({ readiness, sshResourcesReady: true })
    const recovery = () => (harness.workspaceProps as unknown as AgentWorkspaceProps).resource_contexts?.[0]?.recovery
    await waitFor(() => expect(recovery()?.view?.blocked_reason).toBe('mcp_unavailable'))
    fireEvent.click(page.getByRole('button', { name: 'agent.readiness.prepare' }))
    await waitFor(() => expect(recovery()?.view?.can_recover).toBe(true))
    expect(harness.workspaceProps?.execution_blocked).toBe(false)
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(harness.recoverResourceBinding).not.toHaveBeenCalled()
  })

  it('没有已有 SSH 引用时仍显示首次准备界面', async () => {
    const readiness = readinessFixture('needs_setup')
    readiness.skills_bundle = { status: 'missing', message: '尚未准备' }
    const page = renderPage({ readiness })
    expect(await page.findByRole('button', { name: 'agent.readiness.prepare' })).toBeInTheDocument()
    expect(page.queryByTestId('agent-workspace')).not.toBeInTheDocument()
    expect(page.queryByText('agent.resource.recovery.infrastructureUnavailable')).not.toBeInTheDocument()
  })

  it.each(['new', 'session'] as const)('纯连接转交到 %s 会话仅关联连接，不添加文本或附件', async (targetKind) => {
    const source = sshResource('ssh-source')
    prepareTerminalReferenceMocks(source)
    harness.reloadSession.mockImplementation(async (id: string) =>
      (harness.state.sessions as AgentSession[]).find((session) => session.id === id))
    harness.state.drafts = { 'session-one': { text: '用户原有草稿', updated_at: 1 } }
    renderPage({ launchIntent: { key: 31, source: 'connection_reference', source_resource: source,
      resource_reference: { kind: 'ssh_session', session_id: source.session_id },
      target: targetKind === 'new' ? { kind: 'new' } : { kind: 'session', session_id: 'session-one' },
    }, sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(targetKind === 'new' ? harness.createSession : harness.replaceResourceBinding).toHaveBeenCalledOnce())
    await waitFor(() => expect(harness.workspaceProps?.resource_contexts).toHaveLength(1))
    expect(harness.updateDraft).not.toHaveBeenCalled()
    expect(harness.addTerminalReference).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
    expect((harness.state.drafts as Record<string, { text: string }>)['session-one']?.text).toBe('用户原有草稿')
    if (targetKind === 'new') expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({ auto_title_allowed: true }))
  })

  it.each([false, true])('SSH 恢复 revision 冲突后加载权威会话，加载失败=%s 时保留原冲突且不自动重试', async (reloadFailed) => {
    const source = boundSession()
    const latest = { ...source, revision: source.revision + 1 }
    harness.state = { ...workspaceState(), sessions: [source, sessions[1]] }
    harness.recoverResourceBinding.mockRejectedValueOnce(new TermousApiError('会话版本已变化', 'AGENT_REVISION_CONFLICT', 409))
      .mockResolvedValue({ instance_id: 'core-one', kind: 'ssh_session', can_recover: false, blocked_reason: 'ready', operation: null })
    harness.reloadSession.mockImplementationOnce(async () => {
      if (reloadFailed) throw new TypeError('session refresh failed')
      harness.state = { ...harness.state, sessions: [latest, sessions[1]] }
      publishState()
      return latest
    })
    renderPage({ sshResourcesReady: true })
    await waitFor(() => expect(harness.workspaceProps?.resource_recovery_disabled).toBe(false))
    let result = true
    await act(async () => { result = await (harness.workspaceProps as unknown as AgentWorkspaceProps).onRecoverResourceBinding!() })
    expect(result).toBe(false)
    expect(harness.reloadSession).toHaveBeenCalledWith(source.id)
    expect(harness.recoverResourceBinding).toHaveBeenCalledOnce()
    expect((harness.workspaceProps as unknown as AgentWorkspaceProps).resource_contexts?.[0]?.recovery?.error_code).toBe('AGENT_REVISION_CONFLICT')
    if (!reloadFailed) {
      await act(async () => { await (harness.workspaceProps as unknown as AgentWorkspaceProps).onRecoverResourceBinding!() })
      expect(harness.recoverResourceBinding.mock.calls[1]?.[1]).toMatchObject({ expected_revision: latest.revision })
      expect(harness.recoverResourceBinding.mock.calls[1]?.[1].client_request_id).not.toBe(harness.recoverResourceBinding.mock.calls[0]?.[1].client_request_id)
    }
  })

  it('资源绑定 revision 冲突后主动恢复权威会话并保留失败结果', async () => {
    harness.state = { ...workspaceState(), sessions: [boundSession(), sessions[1]] }
    harness.replaceResourceBinding.mockRejectedValueOnce({ code: 'AGENT_REVISION_CONFLICT' })
    renderPage({ sshResourcesReady: true, sshResources: [sshResource('ssh-session-two')] })
    await waitFor(() => expect((harness.workspaceProps?.resource_contexts as Array<{ status: string }> | undefined)?.[0]).toBeDefined())

    let result = true
    await act(async () => {
      const replace = harness.workspaceProps?.onReplaceResourceBinding as (reference: { kind: 'ssh_session'; session_id: string }) => Promise<boolean>
      result = await replace({ kind: 'ssh_session', session_id: 'ssh-session-two' })
    })

    expect(result).toBe(false)
    expect(harness.reloadSession).toHaveBeenCalledWith('session-one')
  })

  it('默认模型不可用时保留连接引用，选择可运行模型后创建引用会话', async () => {
    const source = sshResource('ssh-source')
    prepareTerminalReferenceMocks(source)
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
      launchIntent: connectionReferenceIntent(source),
      sshResources: [source],
      sshResourcesReady: true,
      onLaunchIntentHandled,
      readiness: readinessFixture('needs_setup', 'missing'),
    })

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(onLaunchIntentHandled).toHaveBeenCalledWith(7)

    act(() => {
      const selectModel = harness.workspaceProps?.onModelChange as (modelId: string) => void
      selectModel('model-two')
    })

    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onLaunchIntentHandled).toHaveBeenCalledWith(7))
    expect(harness.createSession).toHaveBeenCalledWith(expect.objectContaining({
      resource_reference: { kind: 'ssh_session', session_id: source.session_id },
      auto_title_allowed: true,
    }))
    expect(harness.updateDraft).not.toHaveBeenCalled()
    expect(harness.startRun).not.toHaveBeenCalled()
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

  it('准备只调用 setup 并采用服务端返回的就绪状态和审批策略', async () => {
    const missing = readinessFixture('needs_setup')
    missing.mcp_client = { status: 'missing', message: '' }
    missing.mcp_policy = { ...missing.mcp_policy!, scope_sync_required: true, required_scope_count: 30 }
    const freshSetup = { ...readinessFixture(), mcp_policy: { ...readinessFixture().mcp_policy!, revision: 7, approval_bypass: true } }
    harness.setup.mockResolvedValueOnce(freshSetup)
    const page = renderPage({ readiness: missing })
    const prepare = await page.findByRole('button', { name: 'agent.readiness.prepare' })
    await waitFor(() => expect(prepare).toBeEnabled())
    expect(harness.setup).not.toHaveBeenCalled()
    expect(harness.updateMcpPolicy).not.toHaveBeenCalled()

    fireEvent.click(prepare)

    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())
    const signal = harness.setup.mock.calls[0][0] as AbortSignal
    expect(signal.aborted).toBe(false)
    expect(harness.updateMcpPolicy).not.toHaveBeenCalled()
    expect(harness.readiness).toHaveBeenCalledTimes(1)
    expect(harness.workspaceProps?.approval_policy).toEqual({ status: 'ready', mode: 'bypass' })
  })

  it.each(['success', 'failure'] as const)('重新进入页面后旧审批策略请求 %s 不覆盖新模式或发起旧对账', async (outcome) => {
    const pending = deferred<NonNullable<AgentReadiness['mcp_policy']> | Error>()
    harness.updateMcpPolicy.mockReturnValueOnce(pending.promise.then((value) => {
      if (value instanceof Error) throw value
      return value
    }))
    const page = renderPage()
    await waitFor(() => expect(harness.workspaceProps?.approval_policy).toEqual({ status: 'ready', mode: 'review' }))
    let operation!: Promise<void>
    act(() => {
      const changeMode = harness.workspaceProps?.onApprovalModeChange as (mode: 'bypass') => Promise<void>
      operation = changeMode('bypass')
    })
    // 先接住失败回执，以便独立断言离页后的状态保护。
    const settled = operation.catch(() => undefined)
    page.rerenderPage({ active: false })
    const latest = readinessFixture()
    latest.mcp_policy = { ...latest.mcp_policy!, revision: 5, approval_bypass: false }
    harness.readiness.mockResolvedValue(latest)
    page.rerenderPage({ active: true })
    await waitFor(() => expect(harness.readiness).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(harness.workspaceProps?.approval_policy).toEqual({ status: 'ready', mode: 'review' }))

    await act(async () => {
      pending.resolve(outcome === 'success'
        ? { ...latest.mcp_policy!, revision: 2, approval_bypass: true }
        : new Error('旧请求响应丢失'))
      await settled
    })

    expect(harness.workspaceProps?.approval_policy).toEqual({ status: 'ready', mode: 'review' })
    expect(harness.readiness).toHaveBeenCalledTimes(2)
    expect(harness.updateMcpPolicy).toHaveBeenCalledTimes(1)
    expect(page.queryByText('agent.error.operation')).not.toBeInTheDocument()
  })

  it('服务端仍报告未就绪时保留准备入口，不自行补权限或标为就绪', async () => {
    const missing = readinessFixture('needs_setup')
    missing.mcp_client = { status: 'missing', message: '' }
    harness.setup.mockResolvedValueOnce({ ...missing, mcp_policy: { ...missing.mcp_policy!, scope_sync_required: true } })
    const page = renderPage({ readiness: missing })
    const prepare = await page.findByRole('button', { name: 'agent.readiness.prepare' })
    await waitFor(() => expect(prepare).toBeEnabled())

    fireEvent.click(prepare)

    await waitFor(() => expect(harness.setup).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(harness.models).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(page.getByRole('button', { name: 'agent.readiness.prepare' })).toBeEnabled())
    expect(harness.workspaceProps).toBeNull()
    expect(harness.updateMcpPolicy).not.toHaveBeenCalled()
  })

  it.each(['setup', 'catalog'] as const)('离页取消准备，%s 迟到不会显示工作区', async (boundary) => {
    const missing = readinessFixture('needs_setup')
    missing.mcp_client = { status: 'missing', message: '' }
    missing.mcp_policy = { ...missing.mcp_policy!, scope_sync_required: true }
    const pendingSetup = deferred<AgentReadiness>()
    const pendingModels = deferred<{ items: AgentModel[] }>()
    const page = renderPage({ readiness: missing })
    const prepare = await page.findByRole('button', { name: 'agent.readiness.prepare' })
    await waitFor(() => expect(prepare).toBeEnabled())
    harness.setup.mockReturnValueOnce(boundary === 'setup' ? pendingSetup.promise : Promise.resolve(readinessFixture()))
    if (boundary === 'catalog') harness.models.mockReturnValueOnce(pendingModels.promise)
    fireEvent.click(prepare)
    await waitFor(() => expect(harness.setup).toHaveBeenCalledTimes(1))
    if (boundary === 'catalog') await waitFor(() => expect(harness.models).toHaveBeenCalledTimes(2))
    const signal = harness.setup.mock.calls[0][0] as AbortSignal

    page.rerenderPage({ active: false })
    expect(signal.aborted).toBe(true)
    await act(async () => {
      pendingSetup.resolve(readinessFixture())
      pendingModels.resolve({ items: [modelFixture()] })
      await Promise.all([pendingSetup.promise, pendingModels.promise])
    })

    expect(harness.updateMcpPolicy).not.toHaveBeenCalled()
    expect(harness.workspaceProps).toBeNull()
    expect(page.queryByText('agent.error.operation')).not.toBeInTheDocument()
  })

  it('重新激活时等待当前模型目录水合后再处理连接引用', async () => {
    const source = sshResource('ssh-source')
    prepareTerminalReferenceMocks(source)
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
    const page = renderPage({ sshResources: [source], sshResourcesReady: true })
    await waitFor(() => expect(harness.reloadContext).toHaveBeenCalledWith('session-one'))

    act(() => {
      harness.state = { ...harness.state, selected_session_id: undefined }
      publishState()
    })
    page.rerenderPage({ active: false })
    page.rerenderPage({
      active: true,
      launchIntent: connectionReferenceIntent(source),
      onLaunchIntentHandled,
    })
    await waitFor(() => expect(harness.modelProviders).toHaveBeenCalledTimes(2))
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(onLaunchIntentHandled).toHaveBeenCalledWith(7)

    await act(async () => {
      pendingProviders.resolve({ items: [disabledProvider, runnableProvider] })
      await pendingProviders.promise
    })
    await waitFor(() => expect((harness.workspaceProps?.models as Array<{ id: string }>))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: 'model-two' })])))
    expect(harness.createSession).not.toHaveBeenCalled()
    expect(onLaunchIntentHandled).toHaveBeenCalledWith(7)

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

  it('归档会话时丢弃未绑定附件，删除会话时释放本地附件记录', async () => {
    harness.updateSessionMetadata.mockResolvedValue({ ...sessions[0], archived_at: '2026-08-29T03:00:00Z' })
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
    session_groups: [],
    runs: {},
    messages: {},
    run_events: {},
    run_event_sequences: {},
    run_part_overlays: {},
    drafts: {},
    queued_turns: {},
    queue_states: {},
    queued_turn_edits: {},
    session_contexts: {},
    session_usages: {},
    selected_session_id: 'session-one',
    new_session_selected: false,
    selection_intent_revision: 0,
  }
}

function sessionManagement() {
  return harness.workspaceProps?.session_management as NonNullable<AgentWorkspaceProps['session_management']>
}

function sessionGroupFixture() {
  return { id: 'group-ops', name: 'Ops', sort_order: 0, revision: 1, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z' }
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
  fileResources = [],
  fileResourcesReady = sshResourcesReady,
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
  fileResources?: AgentFileResourceState[]
  fileResourcesReady?: boolean
} = {}) {
  harness.readiness.mockResolvedValue(readiness)
  const setupGateway = {
    readiness: harness.readiness,
    setup: harness.setup,
    updateMcpPolicy: harness.updateMcpPolicy,
    modelProviders: harness.modelProviders,
    models: harness.models,
  } as unknown as AgentSetupGateway
  const gateway = {
    recoverResourceBinding: harness.recoverResourceBinding,
    resourceBindingRecovery: harness.resourceBindingRecovery,
    cancelResourceBindingRecovery: harness.cancelResourceBindingRecovery,
    updateMcpPolicy: harness.updateMcpPolicy,
    sessions: vi.fn().mockResolvedValue({ items: [] }),
    messages: vi.fn().mockResolvedValue({ items: [] }),
    session: vi.fn(async (id: string) => (harness.state.sessions as AgentSession[]).find((session) => session.id === id)),
  } as unknown as AgentWorkspaceGateway
  const element = (next: {
    launchIntent?: AgentLaunchIntent | null
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
        fileResources={fileResources}
        fileResourcesReady={fileResourcesReady}
        launchIntent={next.launchIntent === undefined ? launchIntent : next.launchIntent}
        onLaunchIntentHandled={next.onLaunchIntentHandled ?? onLaunchIntentHandled}
        onRuntimeSummaryChange={onRuntimeSummaryChange}
      />
    </AntdApp>
  )
  const view = render(element(), {
    wrapper: ({ children }) => <ConfigProvider theme={{ token: { motion: false } }}>{children}</ConfigProvider>,
  })
  return {
    ...view,
    rerenderPage: (next: {
      launchIntent?: AgentLaunchIntent | null
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
    resource_bindings: [{
      kind: 'ssh_session',
      session_id: 'ssh-session-one',
      host_id: 'host-one',
      ssh_profile_id: 'ssh-one',
      host_name: 'Production',
      platform: 'linux',
      bound_at: '2026-08-31T08:00:00Z',
    }],
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
      context_compaction_threshold_percent: 80,
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
      context_compaction_threshold_percent: 80,
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

function prepareTerminalReferenceMocks(source: AgentSSHResourceState) {
  const withBinding = (session: AgentSession): AgentSession => ({ ...session, resource_bindings: [{
    kind: 'ssh_session', session_id: source.session_id, host_id: source.host_id, ssh_profile_id: source.ssh_profile_id,
    host_name: source.host_name, platform: 'linux', bound_at: '2026-09-08T08:00:00Z',
  }] })
  harness.createSession.mockImplementation(async (input: AgentSessionInput) => withBinding({ ...sessions[0], ...input, id: 'session-created' }))
  harness.replaceResourceBinding.mockImplementation(async (id: string) => {
    const current = (harness.state.sessions as AgentSession[]).find((session) => session.id === id)!
    const updated = withBinding(current)
    harness.state.sessions = (harness.state.sessions as AgentSession[]).map((session) => session.id === id ? updated : session)
    publishState()
    return updated
  })
}

function terminalReferenceIntent(source: AgentSSHResourceState): Extract<AgentLaunchIntent, { source: 'terminal_selection' }> {
  return {
    key: 30, source: 'terminal_selection', target: { kind: 'session', session_id: 'session-one' },
    text: '  first\nsecond', source_resource: source,
    resource_reference: { kind: 'ssh_session', session_id: source.session_id },
    origin: { kind: 'terminal_selection', source_session_id: source.session_id, host_name: source.host_name, captured_at: '2026-09-08T08:00:00Z', line_count: 2 },
  }
}

function connectionReferenceIntent(source: AgentSSHResourceState): Extract<AgentLaunchIntent, { source: 'connection_reference' }> {
  return {
    key: 7,
    source: 'connection_reference',
    target: { kind: 'new' },
    resource_reference: { kind: 'ssh_session', session_id: source.session_id },
    source_resource: source,
  }
}
