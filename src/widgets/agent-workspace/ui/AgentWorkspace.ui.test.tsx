import { App as AntdApp } from 'antd'
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contextActionMenuPopupClassName } from '#shared/ui'
import type { AgentQueuedTurn } from '#entities/agent'
import type { AgentWorkspaceModelOption, AgentWorkspaceProps } from '../model/types.ts'
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

  it('展示真实 reasoning 与 Tool 时间线并路由发送、排队和停止', async () => {
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
      onQueueTurn: props.onQueueTurn,
      onStop: props.onStop,
    })} /></AntdApp>)
    expect(screen.getByRole('button', { name: 'agent.composer.responseOptions' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'agent.composer.queue' }))
    expect(props.onQueueTurn).toHaveBeenCalledWith('adjust', [], undefined)
    await user.click(screen.getByRole('button', { name: 'agent.composer.stop' }))
    expect(props.onStop).toHaveBeenCalledTimes(1)
  })

  it('排队或普通请求在途时仍可独立停止活动 Run', async () => {
    const user = userEvent.setup()
    const props = fixtureProps({
      draft: '继续检查',
      busy: true,
      queue_busy: true,
      stop_busy: false,
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
    })
    renderWorkspace(props)

    expect(screen.getByRole('button', { name: 'agent.composer.queue' })).toBeDisabled()
    const stop = screen.getByRole('button', { name: 'agent.composer.stop' })
    expect(stop).toBeEnabled()
    await user.click(stop)
    expect(props.onStop).toHaveBeenCalledOnce()
  })

  it('模型不可用时向键盘用户展示原因并禁止启动新 Run', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      models: [workspaceModel({
        runnable: false,
        unavailable_reason: 'provider_disabled',
      })],
      model_runnable: false,
    }))

    await openResponseOptions(user)
    await user.click(screen.getByRole('menuitem', { name: 'agent.header.model' }))
    expect(await screen.findByRole('menuitemradio', {
      name: /agent.header.modelUnavailableReason.provider_disabled/,
    })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'agent.composer.reasoning' })).toBeDisabled()
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
      models: [workspaceModel({
        id: 'model-disabled', display_name: 'Disabled model', provider_name: 'Disabled Provider',
        remote_model_id: 'disabled-model', reasoning_control: 'none',
        supported_reasoning_levels: ['off'], effective_default_reasoning_level: 'off', runnable: false,
        unavailable_reason: 'provider_disabled',
      })],
      selected_model_id: undefined,
      model_runnable: false,
      onOpenSettings,
    }))

    await openResponseOptions(user)
    await user.click(screen.getByRole('menuitem', { name: 'agent.header.configureProvider' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()
  })

  it('活动 Run 使用启动快照，模型目录不可用时仍允许排队', async () => {
    const user = userEvent.setup()
    const onQueueTurn = vi.fn(async () => undefined)
    renderWorkspace(fixtureProps({
      draft: '继续检查',
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
      models: [],
      model_runnable: false,
      onQueueTurn,
    }))

    const queue = screen.getByRole('button', { name: 'agent.composer.queue' })
    expect(queue).toBeEnabled()
    expect(screen.getByText('Local model')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.composer.responseOptions' })).toBeDisabled()
    await user.click(queue)
    expect(onQueueTurn).toHaveBeenCalledWith('继续检查', [], undefined)
  })

  it('排队消息提供编辑、立即执行、删除与继续入口', async () => {
    const user = userEvent.setup()
    const onBeginQueuedTurnEdit = vi.fn(async () => undefined)
    const onSteerQueuedTurn = vi.fn(async () => undefined)
    const onDeleteQueuedTurn = vi.fn(async () => undefined)
    const onResumeQueue = vi.fn(async () => undefined)
    renderWorkspace(fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
      queued_turns: [{
        id: 'queued-1', session_id: 'session-1', client_request_id: 'request-1',
        queue_sequence: 1, prompt: '检查磁盘空间', model_id: 'model-1', reasoning_level: 'medium',
        force_context_compression: false, state: 'queued', editing: false, revision: 1,
        created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', attachments: [],
      }],
      queue_state: { session_id: 'session-1', state: 'paused', revision: 1 },
      onBeginQueuedTurnEdit,
      onSteerQueuedTurn,
      onDeleteQueuedTurn,
      onResumeQueue,
    }))

    await user.click(screen.getByRole('button', { name: 'agent.queue.executeNow' }))
    expect(onSteerQueuedTurn).toHaveBeenCalledWith('queued-1')
    await user.click(screen.getByRole('button', { name: 'agent.queue.resume' }))
    expect(onResumeQueue).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'agent.queue.actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'agent.queue.editMessage' }))
    expect(onBeginQueuedTurnEdit).toHaveBeenCalledWith('queued-1')
    await user.click(screen.getByRole('button', { name: 'app.delete' }))
    expect(onDeleteQueuedTurn).toHaveBeenCalledWith('queued-1')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('排队消息仅通过左侧手柄拖动，并按目标行上半区或下半区移动', async () => {
    const onMoveQueuedTurn = vi.fn(async () => true)
    const view = renderWorkspace(fixtureProps({
      queued_turns: [queuedTurn('queued-1', 1), queuedTurn('queued-2', 2), queuedTurn('queued-3', 3)],
      onMoveQueuedTurn,
    }))
    const rows = () => Array.from(view.container.querySelectorAll<HTMLElement>('[data-agent-queued-turn-id]'))
    const handles = screen.getAllByRole('button', { name: 'agent.queue.reorderMessage' })
    const transfer = dragDataTransfer()

    expect(handles[0]).toHaveAttribute('draggable', 'true')
    expect(rows()[0]).not.toHaveAttribute('draggable')
    vi.spyOn(rows()[0]!, 'getBoundingClientRect').mockReturnValue(domRect(100, 36))
    fireEvent.dragStart(handles[2]!, { dataTransfer: transfer })
    fireDragOver(rows()[0]!, 104, transfer)
    expect(rows()[0]).toHaveAttribute('data-drop-placement', 'before')
    fireDragOver(rows()[2]!, 104, transfer)
    expect(rows()[0]).not.toHaveAttribute('data-drop-placement')
    fireDragOver(rows()[0]!, 104, transfer)
    fireDrop(rows()[0]!, 104, transfer)

    await waitFor(() => expect(onMoveQueuedTurn).toHaveBeenCalledWith(
      'queued-3', 'queued-1', 'before',
    ))

    const nextTransfer = dragDataTransfer()
    vi.spyOn(rows()[2]!, 'getBoundingClientRect').mockReturnValue(domRect(100, 36))
    fireEvent.dragStart(handles[0]!, { dataTransfer: nextTransfer })
    fireDragOver(rows()[2]!, 132, nextTransfer)
    expect(rows()[2]).toHaveAttribute('data-drop-placement', 'after')
    fireDrop(rows()[2]!, 132, nextTransfer)

    await waitFor(() => expect(onMoveQueuedTurn).toHaveBeenLastCalledWith(
      'queued-1', 'queued-3', 'after',
    ))
  })

  it('排队消息拖拽期间使用乐观顺序，并在移动未被接受时恢复', async () => {
    const pending = deferred<boolean>()
    const onMoveQueuedTurn = vi.fn(() => pending.promise)
    const view = renderWorkspace(fixtureProps({
      queued_turns: [queuedTurn('queued-1', 1), queuedTurn('queued-2', 2)],
      onMoveQueuedTurn,
    }))
    const order = () => Array.from(
      view.container.querySelectorAll<HTMLElement>('[data-agent-queued-turn-id]'),
      (row) => row.dataset.agentQueuedTurnId,
    )
    const rows = Array.from(view.container.querySelectorAll<HTMLElement>('[data-agent-queued-turn-id]'))
    const transfer = dragDataTransfer()
    vi.spyOn(rows[1]!, 'getBoundingClientRect').mockReturnValue(domRect(100, 36))

    fireEvent.dragStart(screen.getAllByRole('button', { name: 'agent.queue.reorderMessage' })[0]!, {
      dataTransfer: transfer,
    })
    fireDrop(rows[1]!, 132, transfer)

    await waitFor(() => expect(order()).toEqual(['queued-2', 'queued-1']))
    await act(async () => pending.resolve(false))
    await waitFor(() => expect(order()).toEqual(['queued-1', 'queued-2']))
  })

  it('排队消息支持方向键相邻移动，并在编辑、Steer 或单条队列时禁用排序', async () => {
    const onMoveQueuedTurn = vi.fn(async () => true)
    const view = renderWorkspace(fixtureProps({
      queued_turns: [queuedTurn('queued-1', 1), queuedTurn('queued-2', 2), queuedTurn('queued-3', 3)],
      onMoveQueuedTurn,
    }))
    const handles = screen.getAllByRole('button', { name: 'agent.queue.reorderMessage' })

    fireEvent.keyDown(handles[1]!, { key: 'ArrowUp' })
    await waitFor(() => expect(onMoveQueuedTurn).toHaveBeenCalledWith(
      'queued-2', 'queued-1', 'before',
    ))
    fireEvent.keyDown(handles[1]!, { key: 'ArrowDown' })
    await waitFor(() => expect(onMoveQueuedTurn).toHaveBeenLastCalledWith(
      'queued-2', 'queued-3', 'after',
    ))

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      queued_turns: [
        queuedTurn('queued-1', 1, { editing: true }),
        queuedTurn('queued-2', 2),
      ],
      queued_turn_edit: { turn_id: 'queued-1', text: 'first', retained_attachment_ids: [] },
      onMoveQueuedTurn,
    })} /></AntdApp>)
    for (const handle of screen.getAllByRole('button', { name: 'agent.queue.reorderMessage' })) {
      expect(handle).toBeDisabled()
      expect(handle).toHaveAttribute('draggable', 'false')
      fireEvent.keyDown(handle, { key: 'ArrowDown' })
    }
    expect(onMoveQueuedTurn).toHaveBeenCalledTimes(2)

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      queued_turns: [
        queuedTurn('queued-1', 1, { interrupt_target_run_id: 'agr-active' }),
        queuedTurn('queued-2', 2),
      ],
      onMoveQueuedTurn,
    })} /></AntdApp>)
    for (const handle of screen.getAllByRole('button', { name: 'agent.queue.reorderMessage' })) {
      expect(handle).toBeDisabled()
      expect(handle).toHaveAttribute('draggable', 'false')
    }

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      queued_turns: [queuedTurn('queued-1', 1)],
      onMoveQueuedTurn,
    })} /></AntdApp>)
    expect(screen.getByRole('button', { name: 'agent.queue.reorderMessage' })).toBeDisabled()
  })

  it('当前 Run 正在停止时禁用排队消息的立即执行入口', () => {
    renderWorkspace(fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'stopping' }],
      queued_turns: [{
        id: 'queued-stopping', session_id: 'session-1', client_request_id: 'request-stopping',
        queue_sequence: 1, prompt: '继续检查', model_id: 'model-1', reasoning_level: 'medium',
        force_context_compression: false, state: 'queued', editing: false, revision: 1,
        created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', attachments: [],
      }],
    }))

    expect(screen.getByRole('button', { name: 'agent.queue.executeNow' })).toBeDisabled()
  })

  it('编辑排队消息时使用原来源并按保留附件总数锁定新增入口', () => {
    const retained = Array.from({ length: 8 }, (_, index) => attachment({
      id: `retained-${index}`,
      original_name: index === 0 ? 'screen.png' : `config-${index}.txt`,
      kind: index === 0 ? 'image' : 'text',
    }))
    const onAttachFiles = vi.fn(async () => undefined)
    renderWorkspace(fixtureProps({
      draft_source_context: { kind: 'host_profile', entity_id: 'draft-host', title: '普通草稿来源', summary: 'draft' },
      queued_turns: [{
        id: 'queued-edit', session_id: 'session-1', client_request_id: 'request-edit',
        queue_sequence: 1, prompt: '检查配置', model_id: 'model-1', reasoning_level: 'medium',
        force_context_compression: false, state: 'queued', editing: true, revision: 2,
        source_context: { kind: 'host_profile', entity_id: 'queued-host', title: '排队消息来源', summary: 'queued' },
        created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', attachments: retained,
      }],
      queued_turn_edit: {
        turn_id: 'queued-edit', text: '检查配置', retained_attachment_ids: retained.map(({ id }) => id),
      },
      onAttachFiles,
    }))

    expect(screen.getByText('排队消息来源')).toBeInTheDocument()
    expect(screen.queryByText('普通草稿来源')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.attachments.add' })).toBeDisabled()
    expect(screen.getAllByTitle('screen.png')).toHaveLength(2)
    const paste = createEvent.paste(screen.getByPlaceholderText('agent.composer.queuePlaceholder'), {
      clipboardData: { files: [new File(['x'], 'extra.txt', { type: 'text/plain' })], items: [] },
    })
    fireEvent(screen.getByPlaceholderText('agent.composer.queuePlaceholder'), paste)
    expect(paste.defaultPrevented).toBe(false)
    expect(onAttachFiles).not.toHaveBeenCalled()
  })

  it('活动 Run 中保存排队消息编辑时锁定编辑框并展示编辑状态', () => {
    renderWorkspace(fixtureProps({
      busy: true,
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
      queued_turns: [{
        id: 'queued-editing', session_id: 'session-1', client_request_id: 'request-editing',
        queue_sequence: 1, prompt: '调整检查范围', model_id: 'model-1', reasoning_level: 'medium',
        force_context_compression: false, state: 'queued', editing: true, revision: 2,
        created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', attachments: [],
      }],
      queued_turn_edit: {
        turn_id: 'queued-editing', text: '调整检查范围', retained_attachment_ids: [],
      },
    }))

    expect(screen.getByText('agent.queue.editing')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('agent.composer.queuePlaceholder')).toBeDisabled()
  })

  it('删除会话时提示其中尚未执行的消息数量', async () => {
    const user = userEvent.setup()
    const view = renderWorkspace(fixtureProps())

    await user.click(screen.getByRole('button', { name: 'agent.sessions.more' }))
    await user.click(screen.getByRole('menuitem', { name: 'app.delete' }))
    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      queued_turn_counts: { 'session-1': 1 },
      queued_turns: [{
        id: 'queued-1', session_id: 'session-1', client_request_id: 'request-1',
        queue_sequence: 1, prompt: '检查磁盘空间', model_id: 'model-1', reasoning_level: 'medium',
        force_context_compression: false, state: 'queued', editing: false, revision: 1,
        created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z', attachments: [],
      }],
    })} /></AntdApp>)

    expect(screen.getByText('agent.sessions.deleteDescriptionWithQueue')).toBeInTheDocument()
  })

  it('查看其他会话时仍保护并正确提示队列所属会话', async () => {
    const user = userEvent.setup()
    const props = fixtureProps({
      sessions: [
        fixtureProps().sessions[0]!,
        { ...fixtureProps().sessions[0]!, id: 'session-2', title: 'Queued session' },
      ],
      queued_turn_counts: { 'session-2': 2 },
    })
    renderWorkspace(props)

    const composer = screen.getByPlaceholderText('agent.composer.placeholder')
    expect(composer).toBeEnabled()
    fireEvent.change(composer, { target: { value: '只保留为草稿' } })
    expect(props.onDraftChange).toHaveBeenCalledWith('只保留为草稿')
    expect(screen.getByRole('button', { name: 'agent.composer.send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.composer.responseOptions' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'agent.header.returnToQueuedSession' }))
    expect(props.onSelectSession).toHaveBeenCalledWith('session-2')

    await user.click(screen.getAllByRole('button', { name: 'agent.sessions.more' })[1]!)
    expect(screen.getByRole('menuitem', { name: 'agent.sessions.archive' })).toHaveAttribute('aria-disabled', 'true')
    await user.click(screen.getByRole('menuitem', { name: 'app.delete' }))

    expect(screen.getByText('agent.sessions.deleteDescriptionWithQueue')).toBeInTheDocument()
  })

  it('模型目录可用但尚未选择时只展示选择提示，不误报模型不可用', () => {
    renderWorkspace(fixtureProps({ selected_model_id: undefined, model_runnable: false }))

    expect(screen.getByRole('button', { name: 'agent.composer.responseOptions' })).toBeEnabled()
    expect(screen.queryByRole('menuitem', { name: 'agent.header.configureProvider' })).not.toBeInTheDocument()
  })

  it('模型目录可按 Provider 和远端模型 ID 搜索', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()
    renderWorkspace(fixtureProps({
      models: [
        ...fixtureProps().models,
        ...Array.from({ length: 7 }, (_, index) => workspaceModel({
          id: `model-extra-${index}`,
          remote_model_id: `extra-model-${index}`,
          display_name: `Extra model ${index}`,
        })),
        workspaceModel({
          id: 'model-2', display_name: 'Secondary model', provider_name: 'Remote Provider',
          remote_model_id: 'remote-model-v2', reasoning_control: 'none',
          supported_reasoning_levels: ['off'], effective_default_reasoning_level: 'off',
        }),
      ],
      onModelChange,
    }))

    const workspaceHeader = screen.getByRole('button', { name: 'agent.inspector.title' }).closest('header')
    expect(workspaceHeader).not.toBeNull()
    expect(within(workspaceHeader!).queryByRole('button', { name: 'agent.composer.responseOptions' }))
      .not.toBeInTheDocument()
    await openModelPane(user)
    const search = screen.getByRole('textbox', { name: 'agent.composer.modelSearch' })
    await user.type(search, 'Remote Provider remote-model-v2')
    fireEvent.keyDown(search, { key: 'ArrowLeft' })
    expect(search).toBeInTheDocument()
    await user.click(await screen.findByRole('menuitemradio', { name: 'remote-model-v2' }))
    expect(onModelChange).toHaveBeenCalledWith('model-2')
  })

  it('长模型目录只渲染可视窗口并可滚动到末尾', async () => {
    const user = userEvent.setup()
    const models = Array.from({ length: 1_000 }, (_, index) => workspaceModel({
      id: `catalog-model-${index}`,
      display_name: `Catalog model ${index}`,
      remote_model_id: `catalog-model-${String(index).padStart(4, '0')}`,
    }))
    renderWorkspace(fixtureProps({
      models,
      selected_model_id: models[0].id,
      default_model_id: models[0].id,
    }))

    await openModelPane(user)
    const menu = screen.getByRole('menu', { name: 'agent.header.model' })
    const virtualList = menu.querySelector<HTMLElement>('[data-virtual-model-list]')
    if (!virtualList) throw new Error('未找到模型虚拟列表')
    expect(within(menu).getAllByRole('menuitemradio').length).toBeLessThan(30)

    fireEvent.scroll(virtualList, { target: { scrollTop: 33_700 } })
    expect(await screen.findByRole('menuitemradio', { name: 'catalog-model-0999' }))
      .toBeInTheDocument()
  })

  it('已选模型保持简洁名称并通过 hover 与 focus 展示完整详情', async () => {
    const user = userEvent.setup()
    const view = renderWorkspace(fixtureProps())

    await openModelPane(user)
    const selectedModel = screen.getByRole('menuitemradio', { name: 'local-model' })
    await user.hover(selectedModel)

    const hoverDetails = await screen.findByRole('group', { name: 'agent.composer.modelDetails' })
    expect(within(hoverDetails).getByText('Local Provider')).toBeInTheDocument()
    expect(within(hoverDetails).getByText('Local model')).toBeInTheDocument()
    expect(within(hoverDetails).getByText('8,192')).toBeInTheDocument()
    expect(hoverDetails.closest('.ant-tooltip')).toHaveStyle({ zIndex: '3500' })
    view.unmount()
    renderWorkspace(fixtureProps())
    await openModelPane(user)
    fireEvent.focus(screen.getByRole('menuitemradio', { name: 'local-model' }))
    expect(await screen.findByRole('group', { name: 'agent.composer.modelDetails' })).toBeInTheDocument()
  })

  it('推理选择只展示当前模型支持的档位并路由下一轮配置', async () => {
    const user = userEvent.setup()
    const onReasoningChange = vi.fn()
    renderWorkspace(fixtureProps({ onReasoningChange }))

    await openReasoningPane(user)
    expect(screen.queryByRole('menuitemradio', { name: 'settings.agent.reasoning.minimal' }))
      .not.toBeInTheDocument()
    await user.click(await screen.findByRole('menuitemradio', { name: 'settings.agent.reasoning.high' }))
    expect(onReasoningChange).toHaveBeenCalledWith('high')
  })

  it('当前推理档位失效时展示本地化禁用项并允许切回支持档位', async () => {
    const user = userEvent.setup()
    const onReasoningChange = vi.fn()
    renderWorkspace(fixtureProps({
      selected_reasoning_level: 'max',
      models: [workspaceModel({
        supported_reasoning_levels: ['off', 'low'],
        effective_default_reasoning_level: 'low',
      })],
      onReasoningChange,
    }))

    await openReasoningPane(user)
    expect(await screen.findByRole('menuitemradio', { name: 'settings.agent.reasoning.max' }))
      .toBeDisabled()
    await user.click(screen.getByRole('menuitemradio', { name: 'settings.agent.reasoning.low' }))
    expect(onReasoningChange).toHaveBeenCalledWith('low')
  })

  it('集中配置菜单可恢复默认模型与推理设置', async () => {
    const user = userEvent.setup()
    const onResetResponseOptions = vi.fn()
    renderWorkspace(fixtureProps({
      selected_reasoning_level: 'high',
      onResetResponseOptions,
    }))

    await openResponseOptions(user)
    const trigger = screen.getByRole('button', { name: 'agent.composer.responseOptions' })
    expect(trigger).toHaveAccessibleDescription(
      'local-model · settings.agent.reasoning.high',
    )
    expect(screen.getByRole('menuitem', { name: 'agent.header.model' }))
      .toHaveAttribute('aria-haspopup', 'menu')
    expect(screen.getByRole('menuitem', { name: 'agent.header.model' }))
      .toHaveAccessibleDescription('local-model')
    await user.click(screen.getByRole('menuitem', { name: 'agent.composer.resetResponseOptions' }))
    expect(onResetResponseOptions).toHaveBeenCalledOnce()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('同名 Provider 仍按稳定 ID 分成独立模型分组', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      models: [
        workspaceModel({ provider_id: 'provider-a', provider_name: '同名 Provider' }),
        workspaceModel({
          id: 'model-2', provider_id: 'provider-b', provider_name: '同名 Provider',
          remote_model_id: 'other-model', display_name: 'Other model',
        }),
      ],
    }))

    await openModelPane(user)
    expect(await screen.findAllByText('同名 Provider')).toHaveLength(2)
  })

  it('历史目录缺失模型只显示真实远端 ID，别名保留在 hover 详情', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      sessions: [{
        ...fixtureProps().sessions[0]!,
        model_name: 'remote-snapshot-id',
        model_alias: '历史显示名称',
      }],
      models: [],
      model_runnable: false,
    }))

    const selector = screen.getByRole('button', { name: 'agent.composer.responseOptions' })
    expect(selector).toHaveTextContent('remote-snapshot-id')
    expect(selector).not.toHaveTextContent('历史显示名称')
    await openModelPane(user)
    const option = await screen.findByRole('menuitemradio', { name: /remote-snapshot-id/u })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    const trigger = option.parentElement
    if (!(trigger instanceof HTMLElement)) throw new Error('未找到模型详情触发区域')
    await user.hover(trigger)
    expect(await screen.findByText('历史显示名称')).toBeInTheDocument()
  })

  it('非当前已移除模型不进入选择器候选', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      selected_model_id: 'model-active',
      sessions: [{
        ...fixtureProps().sessions[0]!,
        model_id: 'model-active',
        model_name: 'active-model',
      }],
      models: [
        workspaceModel({
          remote_model_id: 'removed-model',
          runnable: false,
          unavailable_reason: 'removed',
        }),
        workspaceModel({
          id: 'model-active',
          remote_model_id: 'active-model',
          display_name: 'Active model',
        }),
      ],
    }))

    await openModelPane(user)
    expect((await screen.findAllByText('active-model')).length).toBeGreaterThan(0)
    expect(screen.queryByText('removed-model')).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'agent.composer.responseOptions' })).toBeDisabled()
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
        mcp: { connection: 'on_demand', scope_count: 29 },
      },
    }))

    expect(screen.queryByText('agent.inspector.onDemand')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    expect(screen.getByText('agent.inspector.onDemand')).toBeInTheDocument()
    expect(screen.queryByText('agent.inspector.tools')).not.toBeInTheDocument()
    expect(screen.queryByText('agent.inspector.skills')).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'agent.inspector.approval' })).not.toBeInTheDocument()
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
    const onApprovalModeChange = vi.fn(async () => undefined)
    const view = renderWorkspace(fixtureProps({ onApprovalModeChange }))
    const trigger = screen.getByRole('button', { name: 'agent.approvalMode.label' })
    await user.click(trigger)
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.review/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('menuitemradio', { name: /agent\.approvalMode\.bypass/ }))
    expect(screen.getByText('agent.approvalMode.confirmBypassTitle')).toBeInTheDocument()
    expect(onApprovalModeChange).not.toHaveBeenCalled()
    const retryConfirm = screen.getByRole('button', { name: /agent\.approvalMode\.confirmBypass/ })
    await waitFor(() => expect(retryConfirm).not.toBeDisabled())
    await user.click(retryConfirm)
    await waitFor(() => expect(onApprovalModeChange).toHaveBeenCalledWith('bypass'))

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
    })} /></AntdApp>)
    expect(screen.getByRole('button', { name: 'agent.approvalMode.label' })).toBeDisabled()
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
          input_tokens: 1_200, output_tokens: 800,
          cache_read_tokens: 125, cache_write_tokens: 25,
          reasoning_tokens: 100,
          total_tokens: 2_150, estimated: true,
        },
      },
    }))

    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    const usage = screen.getByRole('region', { name: 'agent.inspector.tokenUsage' })
    expect(within(usage).getByText('2,150')).toBeInTheDocument()
    expect(within(usage).getByText('1,200')).toBeInTheDocument()
    expect(within(usage).getByText('800')).toBeInTheDocument()
    expect(within(usage).getByText('125')).toBeInTheDocument()
    expect(within(usage).getByText('agent.inspector.partialUsage')).toBeInTheDocument()

    const cacheDetails = within(usage).getByRole('button', { name: 'agent.inspector.cacheDetails' })
    await user.hover(cacheDetails)
    const details = await screen.findByRole('group', { name: 'agent.inspector.cacheDetailsTitle' })
    expect(within(details).getByText('agent.inspector.cacheWriteTokens')).toBeInTheDocument()
    expect(within(details).getByText('25')).toBeInTheDocument()
    expect(within(details).getByText('agent.inspector.cacheReadTokens')).toBeInTheDocument()
    expect(within(details).getByText('125')).toBeInTheDocument()

  })

  it('缓存详情支持通过键盘焦点打开', async () => {
    const user = userEvent.setup()
    renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        usage: {
          phase: 'ready', has_snapshot: true, run_count: 1,
          input_tokens: 100, output_tokens: 40,
          cache_read_tokens: 20, cache_write_tokens: 5,
          reasoning_tokens: 10,
          total_tokens: 165, estimated: false,
        },
      },
    }))

    await user.click(screen.getByRole('button', { name: 'agent.inspector.title' }))
    const usage = screen.getByRole('region', { name: 'agent.inspector.tokenUsage' })
    const cacheDetails = within(usage).getByRole('button', { name: 'agent.inspector.cacheDetails' })
    cacheDetails.focus()
    expect(cacheDetails).toHaveFocus()
    expect(await screen.findByRole('group', { name: 'agent.inspector.cacheDetailsTitle' })).toBeInTheDocument()
  })

  it('区分 Provider 未返回与无运行，不把缺失统计显示为精确零值', async () => {
    const user = userEvent.setup()
    const view = renderWorkspace(fixtureProps({
      inspector: {
        ...fixtureProps().inspector,
        usage: {
          phase: 'ready', has_snapshot: true, run_count: 2,
          input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          reasoning_tokens: 0,
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
          input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
          reasoning_tokens: 0,
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
          input_tokens: 900, output_tokens: 300, cache_read_tokens: 0, cache_write_tokens: 0,
          reasoning_tokens: 50,
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
    await waitFor(() => {
      const inlineInspector = screen.getAllByRole('complementary', { name: 'agent.inspector.title' })
        .find((element) => !element.closest('[role="dialog"]'))
      expect(inlineInspector).toBeDefined()
      expect(within(inlineInspector!).getByRole('button', { name: 'app.collapse' }))
        .toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'agent.inspector.title' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'app.collapse' }))
    expect(screen.getByRole('button', { name: 'agent.inspector.title' })).toBeInTheDocument()
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
        file: new File(['image'], 'screen.png', { type: 'image/png' }),
        phase: 'ready',
        attachment: attachment({ kind: 'image', original_name: 'screen.png', mime_type: 'image/png' }),
      }],
    })
    renderWorkspace(props)

    expect(screen.getByText('agent.attachments.imageModelUnsupported')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'screen.png' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'agent.composer.send' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.composer.responseOptions' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.attachments.previewName' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'agent.attachments.removeName' })).toBeDisabled()
  })

  it('通过粘贴事件添加剪贴板图片且不干扰普通文本粘贴', () => {
    const onAttachFiles = vi.fn(async () => undefined)
    renderWorkspace(fixtureProps({ onAttachFiles }))
    const textarea = screen.getByPlaceholderText('agent.composer.placeholder')
    const image = new File([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], '', { type: 'image/png', lastModified: 42 })
    const imagePaste = createEvent.paste(textarea, {
      clipboardData: {
        files: [],
        items: [
          { kind: 'string', type: 'text/plain', getAsFile: () => null },
          { kind: 'file', type: 'image/png', getAsFile: () => image },
        ],
      },
    })

    fireEvent(textarea, imagePaste)

    expect(imagePaste.defaultPrevented).toBe(true)
    expect(onAttachFiles).toHaveBeenCalledOnce()
    expect(onAttachFiles).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'pasted-image.png', type: 'image/png', lastModified: 42 }),
    ])

    const imageWithoutMIME = new File([
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ], 'clipboard-capture', { type: '' })
    const imageWithoutMIMEPaste = createEvent.paste(textarea, {
      clipboardData: {
        files: [],
        items: [{ kind: 'file', type: '', getAsFile: () => imageWithoutMIME }],
      },
    })
    fireEvent(textarea, imageWithoutMIMEPaste)

    expect(imageWithoutMIMEPaste.defaultPrevented).toBe(true)
    expect(onAttachFiles).toHaveBeenLastCalledWith([imageWithoutMIME])

    const textPaste = createEvent.paste(textarea, {
      clipboardData: {
        files: [],
        items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
      },
    })
    fireEvent(textarea, textPaste)

    expect(textPaste.defaultPrevented).toBe(false)
    expect(onAttachFiles).toHaveBeenCalledTimes(2)
  })

  it('从 clipboard files 回退读取图片，并在活动 Run 或附件已满时保持入口关闭', () => {
    const image = new File([
      new Uint8Array([0xff, 0xd8, 0xff]),
    ], 'clipboard.jpg', { type: 'image/jpeg' })
    const onAttachFiles = vi.fn(async () => undefined)
    const view = renderWorkspace(fixtureProps({ onAttachFiles }))
    let textarea = screen.getByPlaceholderText('agent.composer.placeholder')
    const fallbackPaste = createEvent.paste(textarea, {
      clipboardData: { files: [image], items: [] },
    })

    fireEvent(textarea, fallbackPaste)

    expect(fallbackPaste.defaultPrevented).toBe(true)
    expect(onAttachFiles).toHaveBeenCalledWith([image])

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      sessions: [{ ...fixtureProps().sessions[0]!, run_status: 'running' }],
      onAttachFiles,
    })} /></AntdApp>)
    textarea = screen.getByPlaceholderText('agent.composer.queuePlaceholder')
    const activePaste = createEvent.paste(textarea, {
      clipboardData: { files: [image], items: [] },
    })
    fireEvent(textarea, activePaste)

    expect(activePaste.defaultPrevented).toBe(true)
    expect(onAttachFiles).toHaveBeenCalledTimes(2)

    view.rerender(<AntdApp><AgentWorkspace {...fixtureProps({
      draft_attachments: Array.from({ length: 8 }, (_, index) => ({
        client_id: `draft-${index}`,
        name: `attachment-${index}.txt`,
        size_bytes: 16,
        kind: 'text',
        file: new File(['text'], `attachment-${index}.txt`, { type: 'text/plain' }),
        phase: 'ready',
        attachment: attachment({
          id: `attachment-${index}`,
          original_name: `attachment-${index}.txt`,
        }),
      })),
      onAttachFiles,
    })} /></AntdApp>)
    textarea = screen.getByPlaceholderText('agent.composer.placeholder')
    const fullPaste = createEvent.paste(textarea, {
      clipboardData: { files: [image], items: [] },
    })
    fireEvent(textarea, fullPaste)

    expect(fullPaste.defaultPrevented).toBe(false)
    expect(onAttachFiles).toHaveBeenCalledTimes(2)
  })

  it('不限制 UTF-8 代码扩展名，并在附件删除期间锁定发送与重复删除', () => {
    const view = renderWorkspace(fixtureProps({
      draft: '检查配置',
      draft_attachments: [{
        client_id: 'draft-text',
        name: 'service.conf',
        size_bytes: 128,
        kind: 'text',
        file: new File(['text'], 'service.conf', { type: 'text/plain' }),
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

async function openResponseOptions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'agent.composer.responseOptions' }))
}

async function openModelPane(user: ReturnType<typeof userEvent.setup>) {
  await openResponseOptions(user)
  await user.click(screen.getByRole('menuitem', { name: 'agent.header.model' }))
}

async function openReasoningPane(user: ReturnType<typeof userEvent.setup>) {
  await openResponseOptions(user)
  await user.click(screen.getByRole('menuitem', { name: 'agent.composer.reasoning' }))
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
    models: [workspaceModel()],
    selected_model_id: 'model-1',
    default_model_id: 'model-1',
    selected_reasoning_level: 'medium',
    approval_policy: { status: 'ready', mode: 'review' },
    inspector: {
      context: {
        phase: 'ready', has_snapshot: true, used_tokens: 120, context_window_tokens: 8_000,
        estimated: true, warning: false, compression_available: false, compression_pending: false,
      },
      usage: {
        phase: 'ready', has_snapshot: true, run_count: 1,
        input_tokens: 80, output_tokens: 40, cache_read_tokens: 0, cache_write_tokens: 0,
        reasoning_tokens: 10,
        total_tokens: 120, estimated: false,
      },
      skills: [],
      mcp: { connection: 'connected', tool_count: 76, scope_count: 29 },
    },
    draft: '', draft_attachments: [], queued_turns: [], queued_turn_counts: {}, supports_images: false, model_runnable: true,
    show_turn_token_usage: true,
    loading: false, busy: false, queue_busy: false, stop_busy: false,
    run_blocked: false, resource_run_blocked: false,
    onCreateSession: vi.fn(), onSelectSession: vi.fn(), onReturnToActiveRun: vi.fn(),
    onArchiveSession: vi.fn(), onDeleteSession: vi.fn(),
    onModelChange: vi.fn(), onReasoningChange: vi.fn(), onResetResponseOptions: vi.fn(),
    onOpenSettings: vi.fn(), onDraftChange: vi.fn(),
    onSend: vi.fn(async () => undefined),
    onAttachFiles: vi.fn(async () => undefined), onRemoveAttachment: vi.fn(async () => undefined),
    onRetryAttachment: vi.fn(async () => undefined), onLoadAttachmentContent: vi.fn(async () => new Blob()),
    onStop: vi.fn(async () => undefined),
    onQueueTurn: vi.fn(async () => undefined),
    onBeginQueuedTurnEdit: vi.fn(async () => undefined), onQueuedTurnEditChange: vi.fn(),
    onRemoveQueuedTurnEditAttachment: vi.fn(),
    onSaveQueuedTurnEdit: vi.fn(async () => undefined), onCancelQueuedTurnEdit: vi.fn(async () => undefined),
    onDeleteQueuedTurn: vi.fn(async () => undefined), onMoveQueuedTurn: vi.fn(async () => true),
    onSteerQueuedTurn: vi.fn(async () => undefined),
    onResumeQueue: vi.fn(async () => undefined),
    onContextCompressionPendingChange: vi.fn(), onRetryContext: vi.fn(),
    onRetryUsage: vi.fn(),
    onApprovalModeChange: vi.fn(async () => undefined),
    onReplaceResourceBinding: vi.fn(async () => true),
    onRemoveResourceBinding: vi.fn(async () => true),
    ...overrides,
  }
}

function workspaceModel(
  overrides: Partial<AgentWorkspaceModelOption> = {},
): AgentWorkspaceModelOption {
  return {
    id: 'model-1',
    display_name: 'Local model',
    provider_id: 'provider-local',
    provider_name: 'Local Provider',
    remote_model_id: 'local-model',
    source: 'sync',
    supports_images: false,
    reasoning_control: 'openai_effort',
    supported_reasoning_levels: ['off', 'low', 'medium', 'high'],
    effective_default_reasoning_level: 'medium',
    effective_context_window_tokens: 8_192,
    effective_max_output_tokens: 1_024,
    runnable: true,
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

function queuedTurn(
  id: string,
  queueSequence: number,
  overrides: Partial<AgentQueuedTurn> = {},
): AgentQueuedTurn {
  return {
    id,
    session_id: 'session-1',
    client_request_id: `request-${id}`,
    queue_sequence: queueSequence,
    prompt: id,
    model_id: 'model-1',
    reasoning_level: 'medium',
    force_context_compression: false,
    state: 'queued',
    editing: false,
    revision: 1,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    attachments: [],
    ...overrides,
  }
}

function dragDataTransfer() {
  const values = new Map<string, string>()
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (type: string, value: string) => values.set(type, value),
    getData: (type: string) => values.get(type) ?? '',
    setDragImage: vi.fn(),
  }
}

function domRect(top: number, height: number): DOMRect {
  return {
    x: 0, y: top, top, bottom: top + height, left: 0, right: 720,
    width: 720, height, toJSON: () => ({}),
  }
}

function fireDragOver(target: HTMLElement, clientY: number, dataTransfer: ReturnType<typeof dragDataTransfer>) {
  const event = createEvent.dragOver(target, { dataTransfer })
  Object.defineProperty(event, 'clientY', { configurable: true, value: clientY })
  fireEvent(target, event)
}

function fireDrop(target: HTMLElement, clientY: number, dataTransfer: ReturnType<typeof dragDataTransfer>) {
  const event = createEvent.drop(target, { dataTransfer })
  Object.defineProperty(event, 'clientY', { configurable: true, value: clientY })
  fireEvent(target, event)
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
