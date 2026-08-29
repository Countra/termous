import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentWorkspaceProps } from '../model/types.ts'
import { AgentWorkspace } from './AgentWorkspace.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en-US' } }),
}))

vi.mock('#shared/bridge', () => ({ getTermousBridge: () => null }))

const originalMatchMedia = window.matchMedia

describe('AgentWorkspace', () => {
  beforeEach(() => setViewport(false, false))
  afterEach(() => Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia }))

  it('展示真实 reasoning 与 Tool 时间线并路由发送、steer 和停止', async () => {
    const user = userEvent.setup()
    const props = fixtureProps({ draft: 'hello' })
    const view = renderWorkspace(props)
    expect(screen.getByText('reasoning text')).toBeInTheDocument()
    expect(screen.getByText('mcp.tool')).toBeInTheDocument()
    expect(screen.getByText('agent.tool.status.completed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'agent.composer.send' }))
    expect(props.onSend).toHaveBeenCalledWith('hello', [], undefined)

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      draft: 'adjust',
      sessions: [{ ...props.sessions[0]!, run_status: 'running' }],
      onSteer: props.onSteer,
      onStop: props.onStop,
    })} /></AntdApp>)
    await user.click(screen.getByRole('button', { name: 'agent.composer.steer' }))
    expect(props.onSteer).toHaveBeenCalledWith('adjust')
    await user.click(screen.getByRole('button', { name: 'agent.composer.stop' }))
    expect(props.onStop).toHaveBeenCalledTimes(1)
  })

  it('模型不可用时展示可操作原因并禁止启动新 Run', () => {
    renderWorkspace(fixtureProps({
      models: [{
        id: 'model-1', name: 'Local model', provider_name: 'Local Provider',
        remote_model_id: 'local-model', supports_reasoning: true, runnable: false,
        unavailable_reason: 'provider_disabled',
      }],
      model_runnable: false,
    }))

    expect(screen.getByText('agent.header.modelUnavailableReason.provider_disabled')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.composer.send' })).toBeDisabled()
  })

  it('没有可用模型时提供直接进入 Agent 设置的入口', async () => {
    const user = userEvent.setup()
    const onOpenSettings = vi.fn()
    renderWorkspace(fixtureProps({
      models: [],
      selected_model_id: undefined,
      model_runnable: false,
      onOpenSettings,
    }))

    await user.click(screen.getByRole('button', { name: 'agent.header.configureProvider' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('活动 Run 使用启动快照，模型目录不可用时仍允许 steer', async () => {
    const user = userEvent.setup()
    const onSteer = vi.fn(async () => undefined)
    renderWorkspace(fixtureProps({
      draft: '继续检查',
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
      models: [],
      model_runnable: false,
      onSteer,
    }))

    const steer = screen.getByRole('button', { name: 'agent.composer.steer' })
    expect(steer).toBeEnabled()
    await user.click(steer)
    expect(onSteer).toHaveBeenCalledWith('继续检查')
  })

  it('模型目录可按 Provider 和远端模型 ID 搜索', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      models: [
        ...fixtureProps().models,
        {
          id: 'model-2', name: 'Secondary model', provider_name: 'Remote Provider',
          remote_model_id: 'remote-model-v2', supports_reasoning: false, runnable: true,
        },
      ],
    }))

    const modelSelect = screen.getByRole('combobox', { name: 'agent.header.model' })
    expect(modelSelect).not.toHaveAttribute('readonly')
    await user.click(modelSelect)
    await user.type(modelSelect, 'remote-model-v2')
    expect(await screen.findByText(/Secondary model/)).toBeInTheDocument()
  })

  it('其他会话有活动 Run 时仍可保存草稿但不能启动第二个 Run', () => {
    const props = fixtureProps({
      active_run: { session_id: 'session-2', status: 'running' },
      run_blocked: true,
    })
    renderWorkspace(props)
    const composer = screen.getByPlaceholderText('agent.composer.placeholder')
    expect(composer).not.toBeDisabled()
    fireEvent.change(composer, { target: { value: 'draft remains editable' } })
    expect(props.onDraftChange).toHaveBeenCalledWith('draft remains editable')
    expect(screen.getByRole('button', { name: 'agent.composer.send' })).toBeDisabled()
    expect(screen.getByText('agent.status.running')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'agent.header.returnToActiveRun' }))
    expect(props.onReturnToActiveRun).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'agent.composer.stop' }))
    expect(props.onStop).toHaveBeenCalledOnce()
  })

  it('空闲时展示 MCP 按需连接且不展示无权威来源的数量', () => {
    renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        skills: [],
        mcp: { connection: 'on_demand', scope_count: 29, approval_bypass: false },
      },
    }))

    expect(screen.getByText('agent.inspector.onDemand')).toBeInTheDocument()
    expect(screen.queryByText('agent.inspector.tools')).not.toBeInTheDocument()
    expect(screen.getByText('agent.inspector.skillsReady')).toBeInTheDocument()
  })

  it('为会话选择、搜索和流式消息提供稳定的无障碍语义', () => {
    const view = renderWorkspace(fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
    }))

    expect(screen.getByRole('textbox', { name: 'agent.sessions.search' })).toBeInTheDocument()
    expect(view.container.querySelector('button[aria-current="page"]')).toHaveTextContent('Deploy review')
    expect(view.container.querySelector('[role="log"]')).toHaveAttribute('aria-busy', 'true')
  })

  it('无需确认策略必须二次确认，运行期间禁止切换', async () => {
    const user = userEvent.setup()
    const onApprovalBypassChange = vi.fn(async () => undefined)
    const view = renderWorkspace(fixtureProps({ onApprovalBypassChange }))
    await user.click(screen.getByRole('switch', { name: 'agent.inspector.approval' }))
    expect(screen.getByText('agent.inspector.confirmBypassTitle')).toBeInTheDocument()
    expect(onApprovalBypassChange).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'agent.inspector.confirmBypass' }))
    await waitFor(() => expect(onApprovalBypassChange).toHaveBeenCalledWith(true))

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
    })} /></AntdApp>)
    expect(screen.getByRole('switch', { name: 'agent.inspector.approval' })).toBeDisabled()
  })

  it('展示权威上下文预警和 Checkpoint，并将整理安排到下一次发送', async () => {
    const user = userEvent.setup()
    const onContextCompressionPendingChange = vi.fn()
    const onRetryContext = vi.fn()
    const view = renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        context: {
          phase: 'ready',
          has_snapshot: true,
          used_tokens: 6_000,
          context_window_tokens: 8_000,
          estimated: true,
          warning: true,
          compression_available: true,
          compression_pending: false,
          checkpoint: { estimated_tokens: 4_200, created_at: '2026-08-29T08:00:00Z' },
        },
      },
      onContextCompressionPendingChange,
      onRetryContext,
    }))

    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('agent.inspector.contextWarning')).toBeInTheDocument()
    expect(screen.getByText('agent.inspector.checkpoint')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'agent.inspector.compressNext' }))
    expect(onContextCompressionPendingChange).toHaveBeenCalledWith(true)

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        context: {
          phase: 'error', has_snapshot: false, used_tokens: 0, context_window_tokens: 0,
          estimated: true, warning: false, compression_available: false,
          compression_pending: false, error_code: 'NETWORK_ERROR',
        },
      },
      onRetryContext,
    })} /></AntdApp>)
    await user.click(screen.getByRole('button', { name: 'app.retry' }))
    expect(onRetryContext).toHaveBeenCalledOnce()
  })

  it('窄窗口将会话栏和检查器切换为按需抽屉', async () => {
    setViewport(true, true)
    const user = userEvent.setup()
    renderWorkspace(fixtureProps())
    const sessionButton = screen.getByRole('button', { name: 'agent.sessions.title' })
    const inspectorButton = screen.getByRole('button', { name: 'agent.inspector.title' })
    expect(sessionButton).toBeInTheDocument()
    expect(inspectorButton).toBeInTheDocument()
    await user.click(sessionButton)
    expect(await screen.findAllByText('agent.sessions.new')).not.toHaveLength(0)
  })

  it('模型不支持图片时阻止提交，并在忙碌期间锁定附件操作', () => {
    const props = fixtureProps({
      draft: '检查图片',
      supports_images: false,
      busy: true,
      draft_attachments: [{
        client_id: 'draft-image',
        name: 'screen.png',
        size_bytes: 128,
        kind: 'image',
        phase: 'ready',
        attachment: attachment({ kind: 'image', original_name: 'screen.png', mime_type: 'image/png' }),
      }],
    })
    renderWorkspace(props)

    expect(screen.getByText('agent.attachments.imageModelUnsupported')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.composer.send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.attachments.previewName' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.attachments.removeName' })).toBeDisabled()
  })

  it('不限制 UTF-8 代码扩展名，并在附件删除期间锁定发送与重复删除', () => {
    const view = renderWorkspace(fixtureProps({
      draft: '检查配置',
      draft_attachments: [{
        client_id: 'draft-text',
        name: 'service.conf',
        size_bytes: 128,
        kind: 'text',
        phase: 'deleting',
        attachment: attachment({ original_name: 'service.conf' }),
      }],
    }))

    expect(view.container.querySelector('input[type="file"]')).not.toHaveAttribute('accept')
    expect(screen.getByText('agent.attachments.deleting')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.composer.send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.attachments.removeName' })).toBeDisabled()
  })

  it('通过受鉴权的 Blob 加载器预览历史文本附件', async () => {
    const user = userEvent.setup()
    const onLoadAttachmentContent = vi.fn(async () => new Blob(['preview contents'], { type: 'text/plain' }))
    const props = fixtureProps({
      messages: [{
        id: 'message-attachment', role: 'user', status: 'completed', created_at: '2026-08-29T08:00:00Z',
        parts: [{ id: 'text', kind: 'text', text: '请检查' }],
        attachments: [attachment()],
      }],
      onLoadAttachmentContent,
    })
    renderWorkspace(props)

    await user.click(screen.getByRole('button', { name: 'diagnostic.txt' }))
    expect(await screen.findByText('preview contents')).toBeInTheDocument()
    expect(onLoadAttachmentContent).toHaveBeenCalledWith(expect.objectContaining({ id: 'attachment-one' }), expect.any(AbortSignal))
  })
})

function renderWorkspace(props: AgentWorkspaceProps) {
  return render(<AntdApp><AgentWorkspace {...props} /></AntdApp>)
}

function fixtureProps(overrides: Partial<AgentWorkspaceProps> = {}): AgentWorkspaceProps {
  return {
    sessions: [{
      id: 'session-1', title: 'Deploy review', model_id: 'model-1', model_name: 'Local model',
      provider_name: 'Local Provider',
      updated_at: '2026-08-29T08:00:00Z', archived: false, run_status: 'idle',
    }],
    selected_session_id: 'session-1',
    messages: [{
      id: 'message-1', role: 'assistant', status: 'completed', created_at: '2026-08-29T08:00:00Z',
      parts: [
        { id: 'reasoning-1', kind: 'reasoning', text: 'reasoning text', streaming: false },
        { id: 'tool-1', kind: 'tool', name: 'mcp.tool', status: 'completed', duration_ms: 24, detail: '{}' },
        { id: 'text-1', kind: 'text', text: 'done' },
      ],
      attachments: [],
    }],
    models: [{
      id: 'model-1', name: 'Local model', provider_name: 'Local Provider',
      remote_model_id: 'local-model', supports_reasoning: true, runnable: true,
    }],
    selected_model_id: 'model-1',
    inspector: {
      context: {
        phase: 'ready', has_snapshot: true, used_tokens: 120, context_window_tokens: 8_000,
        estimated: true, warning: false, compression_available: false, compression_pending: false,
      },
      skills: [],
      mcp: { connection: 'connected', tool_count: 76, scope_count: 29, approval_bypass: false },
    },
    draft: '', draft_attachments: [], supports_images: false, model_runnable: true,
    loading: false, busy: false, run_blocked: false,
    onCreateSession: vi.fn(), onSelectSession: vi.fn(), onReturnToActiveRun: vi.fn(),
    onArchiveSession: vi.fn(), onDeleteSession: vi.fn(),
    onModelChange: vi.fn(), onOpenSettings: vi.fn(), onDraftChange: vi.fn(),
    onSend: vi.fn(async () => undefined),
    onAttachFiles: vi.fn(async () => undefined), onRemoveAttachment: vi.fn(async () => undefined),
    onRetryAttachment: vi.fn(async () => undefined), onLoadAttachmentContent: vi.fn(async () => new Blob()),
    onSteer: vi.fn(async () => undefined), onStop: vi.fn(async () => undefined),
    onContextCompressionPendingChange: vi.fn(), onRetryContext: vi.fn(),
    onApprovalBypassChange: vi.fn(async () => undefined),
    ...overrides,
  }
}

function setViewport(inspector: boolean, sessions: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes('960') ? sessions : inspector,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

function attachment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attachment-one',
    session_id: 'session-1',
    original_name: 'diagnostic.txt',
    mime_type: 'text/plain',
    kind: 'text' as const,
    size_bytes: 16,
    state: 'bound' as const,
    revision: 1,
    created_at: '2026-08-29T08:00:00Z',
    updated_at: '2026-08-29T08:00:00Z',
    ...overrides,
  }
}
