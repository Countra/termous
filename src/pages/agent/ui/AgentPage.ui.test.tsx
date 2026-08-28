import { App as AntdApp } from 'antd'
import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentLaunchIntent, AgentReadiness, AgentSession } from '#entities/agent'
import type { AgentSetupGateway } from '#features/agent-setup'
import type { AgentWorkspaceGateway } from '#features/agent-runtime'

const harness = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  listeners: new Set<() => void>(),
  workspaceProps: null as Record<string, unknown> | null,
  createSession: vi.fn(),
  startRun: vi.fn(),
  steerActiveRun: vi.fn(),
  updateDraft: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  selectSession: vi.fn(),
  attachmentOptions: null as null | { ensureSession: () => Promise<string> },
  attachmentRecords: {} as Record<string, unknown[]>,
  addAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  retryAttachment: vi.fn(),
  clearAttachments: vi.fn(),
  discardAttachments: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('#features/agent-runtime', () => ({
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
    harness.workspaceProps = props
    return <div data-testid="agent-workspace" />
  },
}))

import { AgentPage } from './AgentPage.tsx'

describe('AgentPage', () => {
  beforeEach(() => {
    harness.listeners.clear()
    harness.workspaceProps = null
    harness.createSession.mockReset()
    harness.startRun.mockReset()
    harness.steerActiveRun.mockReset()
    harness.updateDraft.mockReset()
    harness.updateSession.mockReset()
    harness.deleteSession.mockReset().mockResolvedValue(undefined)
    harness.selectSession.mockReset()
    harness.attachmentOptions = null
    harness.attachmentRecords = {}
    harness.addAttachment.mockReset()
    harness.removeAttachment.mockReset()
    harness.retryAttachment.mockReset()
    harness.clearAttachments.mockReset()
    harness.discardAttachments.mockReset().mockResolvedValue(undefined)
    harness.state = workspaceState()
    harness.selectSession.mockImplementation((sessionId?: string) => {
      harness.state = { ...harness.state, selected_session_id: sessionId }
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

  it('新会话草稿跨会话保留，并在首次发送时才持久化会话', async () => {
    renderPage()
    await waitFor(() => expect(harness.workspaceProps).not.toBeNull())

    act(() => {
      const create = harness.workspaceProps?.onCreateSession as () => void
      create()
    })
    await waitFor(() => expect(harness.workspaceProps?.selected_session_id).toBeUndefined())
    expect((harness.workspaceProps?.inspector as {
      context: { context_window_tokens: number }
    }).context.context_window_tokens).toBe(8_192)
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

  it('业务来源创建失败时释放 pending intent，允许用户重新发起', async () => {
    const onLaunchIntentHandled = vi.fn()
    harness.createSession.mockRejectedValueOnce(new Error('failed'))
    renderPage({ launchIntent: launchIntent(), onLaunchIntentHandled })

    await waitFor(() => expect(harness.createSession).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onLaunchIntentHandled).toHaveBeenCalledWith(7))
    expect(harness.startRun).not.toHaveBeenCalled()
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
})

const sessions: AgentSession[] = [
  {
    id: 'session-one',
    title: 'First',
    model_profile_id: 'model-one',
    reasoning_level: 'off',
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T02:00:00Z',
  },
  {
    id: 'session-two',
    title: 'Second',
    model_profile_id: 'model-one',
    reasoning_level: 'off',
    revision: 1,
    created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T01:00:00Z',
  },
]

function workspaceState() {
  return {
    phase: 'ready',
    revision: 1,
    sessions,
    runs: {},
    messages: {},
    run_events: {},
    run_event_sequences: {},
    drafts: {},
    selected_session_id: 'session-one',
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
}: {
  launchIntent?: AgentLaunchIntent
  onLaunchIntentHandled?: (key: number) => void
} = {}) {
  const readiness: AgentReadiness = {
    status: 'ready',
    mcp_runtime: { status: 'ready', message: '' },
    mcp_client: { status: 'ready', message: '' },
    skills_bundle: { status: 'ready', message: '' },
    default_model: { status: 'ready', message: '' },
    mcp_policy: {
      client_id: 'mcp-one',
      approval_bypass: false,
      scope_count: 29,
      required_scope_count: 29,
      scope_sync_required: false,
      revision: 1,
    },
    settings: {
      default_model_profile_id: 'model-one',
      default_reasoning_level: 'off',
      revision: 1,
      created_at: '2026-08-29T00:00:00Z',
      updated_at: '2026-08-29T00:00:00Z',
    },
  }
  const setupGateway = {
    readiness: vi.fn(async () => readiness),
  } as unknown as AgentSetupGateway
  const gateway = {
    modelProfiles: vi.fn(async () => ({
      items: [{
        id: 'model-one',
        name: 'Model',
        api_mode: 'responses',
        base_url: 'http://127.0.0.1:11434/v1',
        model_id: 'model',
        context_window_tokens: 8_192,
        max_output_tokens: 1_024,
        supports_images: false,
        supports_reasoning: false,
        api_key_configured: false,
        revision: 1,
        created_at: '2026-08-29T00:00:00Z',
        updated_at: '2026-08-29T00:00:00Z',
      }],
    })),
  } as unknown as AgentWorkspaceGateway
  return render(
    <AntdApp>
      <AgentPage
        gateway={gateway}
        setupGateway={setupGateway}
        enabled
        active
        launchIntent={launchIntent}
        onLaunchIntentHandled={onLaunchIntentHandled}
      />
    </AntdApp>,
  )
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
