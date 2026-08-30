import { App as AntdApp } from 'antd'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contextActionMenuPopupClassName, customSelectStyles } from '#shared/ui'
import type { AgentWorkspaceProps } from '../model/types.ts'
import { AgentWorkspace } from './AgentWorkspace.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en-US' } }),
}))

vi.mock('#shared/bridge', () => ({ getTermousBridge: () => null }))

const originalMatchMedia = window.matchMedia

describe('AgentWorkspace', () => {
  beforeEach(() => setViewport(false, false))
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: originalMatchMedia })
    vi.unstubAllGlobals()
  })

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
    expect(screen.getByRole('combobox', { name: 'agent.header.model' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'agent.composer.steer' }))
    expect(props.onSteer).toHaveBeenCalledWith('adjust')
    await user.click(screen.getByRole('button', { name: 'agent.composer.stop' }))
    expect(props.onStop).toHaveBeenCalledTimes(1)
  })

  it('模型不可用时向键盘用户展示原因并禁止启动新 Run', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      models: [{
        id: 'model-1', name: 'Local model', provider_name: 'Local Provider',
        remote_model_id: 'local-model', supports_reasoning: true, runnable: false,
        unavailable_reason: 'provider_disabled',
      }],
      model_runnable: false,
    }))

    const warning = screen.getByRole('button', {
      name: 'agent.header.modelUnavailableReason.provider_disabled',
    })
    expect(warning).toBeEnabled()
    await user.click(screen.getByRole('combobox', { name: 'agent.header.model' }))
    expect(await screen.findByRole('option', {
      name: /agent.header.modelUnavailableReason.provider_disabled/,
    })).toBeInTheDocument()
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

  it('模型目录非空但全部不可用时仍提供进入 Agent 设置的入口', async () => {
    const user = userEvent.setup()
    const onOpenSettings = vi.fn()
    renderWorkspace(fixtureProps({
      models: [{
        id: 'model-disabled', name: 'Disabled model', provider_name: 'Disabled Provider',
        remote_model_id: 'disabled-model', supports_reasoning: false, runnable: false,
        unavailable_reason: 'provider_disabled',
      }],
      selected_model_id: undefined,
      model_runnable: false,
      onOpenSettings,
    }))

    expect(screen.getByRole('combobox', { name: 'agent.header.model' })).toBeEnabled()
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
    expect(screen.getByText('Local model')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'agent.header.model' })).toBeDisabled()
    await user.click(steer)
    expect(onSteer).toHaveBeenCalledWith('继续检查')
  })

  it('模型目录可用但尚未选择时只展示选择提示，不误报模型不可用', () => {
    renderWorkspace(fixtureProps({ selected_model_id: undefined, model_runnable: false }))

    expect(screen.getByRole('combobox', { name: 'agent.header.model' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'agent.header.modelUnavailable' })).not.toBeInTheDocument()
  })

  it('模型目录可按 Provider 和远端模型 ID 搜索', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    renderWorkspace(fixtureProps({
      models: [
        ...fixtureProps().models,
        {
          id: 'model-2', name: 'Secondary model', provider_name: 'Remote Provider',
          remote_model_id: 'remote-model-v2', supports_reasoning: false, runnable: true,
        },
      ],
      onModelChange,
    }))

    const modelSelect = screen.getByRole('combobox', { name: 'agent.header.model' })
    const workspaceHeader = screen.getByRole('button', { name: 'agent.inspector.title' }).closest('header')
    expect(workspaceHeader).not.toBeNull()
    expect(within(workspaceHeader!).queryByRole('combobox')).not.toBeInTheDocument()
    expect(modelSelect).not.toHaveAttribute('readonly')
    await user.click(modelSelect)
    expect(document.querySelector(`.${customSelectStyles['select-popup']}`)).toBeInTheDocument()
    await user.type(modelSelect, 'remote-model-v2')
    await user.click(await screen.findByText('Secondary model'))
    expect(onModelChange).toHaveBeenCalledWith('model-2')
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
    expect(screen.getByRole('combobox', { name: 'agent.header.model' })).toBeDisabled()
    expect(screen.queryByText('agent.status.running')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'agent.header.returnToActiveRun' }))
    expect(props.onReturnToActiveRun).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'agent.composer.stop' }))
    expect(props.onStop).toHaveBeenCalledOnce()
  })

  it('空闲时按需打开检查器并展示 MCP 权威状态', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        skills: [],
        mcp: { connection: 'on_demand', scope_count: 29, approval_bypass: false },
      },
    }))

    expect(screen.queryByText('agent.inspector.onDemand')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    expect(screen.getByText('agent.inspector.onDemand')).toBeInTheDocument()
    expect(screen.queryByText('agent.inspector.tools')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.inspector.skills')).not.toBeInTheDocument()
  })

  it('为会话选择、搜索和流式消息提供稳定的无障碍语义', () => {
    const view = renderWorkspace(fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
    }))

    expect(screen.getByRole('textbox', { name: 'agent.sessions.search' })).toBeInTheDocument()
    expect(view.container.querySelector('button[aria-current="page"]')).toHaveTextContent('Deploy review')
    expect(view.container.querySelector('[role="log"]')).toHaveAttribute('aria-busy', 'true')
  })

  it('将低频会话操作收进单一更多菜单', async () => {
    const user = userEvent.setup()
    const onArchiveSession = vi.fn()
    const onDeleteSession = vi.fn()
    renderWorkspace(fixtureProps({ onArchiveSession, onDeleteSession }))

    await user.click(screen.getByRole('button', { name: 'agent.sessions.more' }))
    expect(document.querySelector(`.${contextActionMenuPopupClassName}`)).toBeInTheDocument()
    await user.click(await screen.findByRole('menuitem', { name: 'agent.sessions.archive' }))
    expect(onArchiveSession).toHaveBeenCalledWith('session-1')

    await user.click(screen.getByRole('button', { name: 'agent.sessions.more' }))
    await user.click(await screen.findByRole('menuitem', { name: 'app.delete' }))
    await user.click(screen.getByRole('button', { name: 'app.delete' }))
    expect(onDeleteSession).toHaveBeenCalledWith('session-1')
  })

  it('无需确认策略必须二次确认，运行期间禁止切换', async () => {
    const user = userEvent.setup()
    const onApprovalBypassChange = vi.fn(async () => undefined)
    const view = renderWorkspace(fixtureProps({ onApprovalBypassChange }))
    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
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

  it('确认无需审批期间启动 Run 时关闭失效的确认窗口', async () => {
    const user = userEvent.setup()
    const onApprovalBypassChange = vi.fn(async () => undefined)
    const view = renderWorkspace(fixtureProps({ onApprovalBypassChange }))
    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    await user.click(screen.getByRole('switch', { name: 'agent.inspector.approval' }))
    expect(screen.getByText('agent.inspector.confirmBypassTitle')).toBeInTheDocument()

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
      onApprovalBypassChange,
    })} /></AntdApp>)
    fireEvent.click(screen.getByRole('button', { name: 'agent.inspector.confirmBypass', hidden: true }))
    expect(onApprovalBypassChange).not.toHaveBeenCalled()
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

    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
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

  it('展示当前会话 Token 总计、组成和部分统计语义', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        usage: {
          phase: 'ready', has_snapshot: true, run_count: 3,
          input_tokens: 1_200, output_tokens: 800, reasoning_tokens: 125,
          total_tokens: 2_000, estimated: true,
        },
      },
    }))

    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    const usage = screen.getByRole('region', { name: 'agent.inspector.tokenUsage' })
    expect(within(usage).getByText('2,000')).toBeInTheDocument()
    expect(within(usage).getByText('1,200')).toBeInTheDocument()
    expect(within(usage).getByText('800')).toBeInTheDocument()
    expect(within(usage).getByText('125')).toBeInTheDocument()
    expect(within(usage).getByText('agent.inspector.partialUsage')).toBeInTheDocument()
    expect(within(usage).getByText('agent.inspector.usageScopeHint')).toBeInTheDocument()
  })

  it('区分 Provider 未返回与无运行，不把缺失统计显示为精确零值', async () => {
    const user = userEvent.setup()
    const view = renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        usage: {
          phase: 'ready', has_snapshot: true, run_count: 2,
          input_tokens: 0, output_tokens: 0, reasoning_tokens: 0,
          total_tokens: 0, estimated: true,
        },
      },
    }))

    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    let usage = screen.getByRole('region', { name: 'agent.inspector.tokenUsage' })
    expect(within(usage).getByText('agent.inspector.usageNotReported')).toBeInTheDocument()
    expect(within(usage).queryByText('0')).not.toBeInTheDocument()

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        usage: {
          phase: 'ready', has_snapshot: true, run_count: 0,
          input_tokens: 0, output_tokens: 0, reasoning_tokens: 0,
          total_tokens: 0, estimated: false,
        },
      },
    })} /></AntdApp>)
    usage = screen.getByRole('region', { name: 'agent.inspector.tokenUsage' })
    expect(within(usage).getByText('agent.inspector.usageEmpty')).toBeInTheDocument()
  })

  it('Token 用量刷新失败时保留旧快照并路由独立重试', async () => {
    const user = userEvent.setup()
    const onRetryUsage = vi.fn()
    renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        usage: {
          phase: 'error', has_snapshot: true, run_count: 1,
          input_tokens: 900, output_tokens: 300, reasoning_tokens: 80,
          total_tokens: 1_200, estimated: false, error_code: 'NETWORK_ERROR',
        },
      },
      onRetryUsage,
    }))

    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    const usage = screen.getByRole('region', { name: 'agent.inspector.tokenUsage' })
    expect(within(usage).getByText('1,200')).toBeInTheDocument()
    expect(within(usage).getByText('agent.inspector.usageLoadFailed')).toBeInTheDocument()
    await user.click(within(usage).getByRole('button', { name: 'app.retry' }))
    expect(onRetryUsage).toHaveBeenCalledOnce()
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
    expect(await screen.findByRole('dialog', { name: 'agent.sessions.title' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'agent.sessions.new' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'app.close' }))
    await user.click(inspectorButton)
    expect(await screen.findByRole('dialog', { name: 'agent.inspector.title' })).toBeInTheDocument()
  })

  it('检查器跨响应式断点时保留用户的打开意图', async () => {
    let notifyResize: ((width: number) => void) | undefined
    class ResizeObserverMock {
      constructor(callback: ResizeObserverCallback) {
        notifyResize = (width) => callback([{
          contentRect: { width } as DOMRectReadOnly,
        } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }

      observe() {}
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    const user = userEvent.setup()
    renderWorkspace(fixtureProps())

    act(() => notifyResize?.(1_000))
    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    expect(screen.getByRole('dialog', { name: 'agent.inspector.title' })).toBeInTheDocument()

    act(() => notifyResize?.(1_100))
    expect(screen.getByRole('button', { name: 'agent.inspector.title' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(
      screen.getAllByRole('complementary', { name: 'agent.inspector.title' })
        .some((element) => !element.closest('[role="dialog"]')),
    ).toBe(true))
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
    expect(screen.getByRole('combobox', { name: 'agent.header.model' })).toBeDisabled()
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
      usage: {
        phase: 'ready', has_snapshot: true, run_count: 1,
        input_tokens: 80, output_tokens: 40, reasoning_tokens: 10,
        total_tokens: 120, estimated: false,
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
    onRetryUsage: vi.fn(),
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
