import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { agentDetachedCommands, isAgentDetachedCommand, type AgentDetachedCommandName, type DetachedPacket } from '#common/contracts'
import { DetachedClient, DetachedRequestPeer } from '#shared/detached-window'
import { AgentWorkspace } from '#widgets/agent-workspace'
import { AgentFeedbackStore } from './agentFeedback.ts'
import { AgentRemoteAdapter } from './agentRemoteAdapter.ts'
import { AgentSurfaceAdapter } from './agentSurfaceAdapter.ts'
import { agentSurfaceActions, projectAgentSurface, restoreAgentSurface } from './agentSurfaceProjection.ts'
import type { AgentSurfaceModel } from './agentSurfaceModel.ts'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en-US' } }) }))
vi.mock('#shared/bridge', () => ({ getTermousBridge: () => null }))

function fixture() {
  const connection = { module: 'agent', instance: 'workspace', generation: 'test' }
  const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
  const host = new AgentSurfaceAdapter(new AgentFeedbackStore(), () => '附件失败')
  host.model = { workspace: {
    selected_session_id: 'one', sessions: [{ id: 'one', title: '合成会话', run_status: 'running' }],
    messages: [], models: [], draft: '', draft_attachments: [], queued_turns: [], queued_turn_counts: {},
    selected_reasoning_level: 'off', approval_policy: { status: 'ready', mode: 'review' },
    inspector: { context: { phase: 'loading' }, usage: { phase: 'loading' }, skills: [], mcp: { connection: 'connected', tool_count: 0, scope_count: 0 } },
    session_management: {},
  }, archive: { open: false }, readiness: { busy: false }, reference: { busy: false } } as unknown as AgentSurfaceModel
  const groups = { workspace: host.model.workspace, management: host.model.workspace!.session_management,
    archive: host.model.archive, readiness: host.model.readiness, reference: host.model.reference, surface: host.model }
  for (const name of agentDetachedCommands) {
    const [group, key] = name.split('.')
    const target = groups[group as keyof typeof groups] as Record<string, unknown> | undefined
    if (target) target[key] = vi.fn()
  }
  const report = vi.fn()
  const hostPeer = new DetachedRequestPeer(connection, packet => client.accept(structuredClone(packet)))
  // 模拟 Electron 的克隆边界及 Main 的严格命令校验，不能直接把回调转交宿主。
  const send = vi.fn((packet: DetachedPacket) => {
    const copy = structuredClone(packet)
    if (copy.operation === 'command' && !isAgentDetachedCommand(copy.payload)) throw new Error('invalid_command')
    hostPeer.accept(copy, request => host.handle(request))
  })
  const client = new DetachedClient(bootstrap, { bootstrap: async () => bootstrap, send, subscribe: () => () => undefined })
  const remote = new AgentRemoteAdapter(client, report)
  const connect = (adapter = remote) => adapter.connect(restoreAgentSurface(projectAgentSurface(host.model)), [...agentSurfaceActions(host.model).keys()], host.inputSequence)
  return { host, client, remote, connect, report, send, dispose: () => { client.dispose(); hostPeer.dispose() } }
}

describe('助手独立窗口业务命令', () => {
  it.each(['queued', 'running'] as const)('实际点击 %s 任务的停止按钮只调用一次宿主取消操作', async status => {
    const f = fixture()
    f.host.model.workspace!.sessions[0]!.run_status = status
    try {
      render(<AntdApp><AgentWorkspace {...f.connect().workspace!} /></AntdApp>)
      fireEvent.click(screen.getByRole('button', { name: 'agent.composer.stop' }))
      await waitFor(() => expect(f.host.model.workspace!.onStop).toHaveBeenCalledExactlyOnceWith())
      expect(f.report).not.toHaveBeenCalled()
    } finally { f.dispose() }
  })

  it.each([
    'workspace.onRetryContext', 'workspace.onResumeQueue', 'workspace.onCancelQueuedTurnEdit',
    'workspace.onOpenSettings', 'workspace.onDismissProfileConnection', 'archive.onClose',
    'archive.onReload', 'readiness.onPrepare', 'reference.onDismiss', 'management.onSearchRetry',
    'management.onOpenArchives', 'surface.onRetry',
  ] satisfies AgentDetachedCommandName[])('%s 不携带 React 点击事件', async name => {
    const f = fixture()
    try {
      const action = agentSurfaceActions(f.connect()).get(name)!
      render(<button onClick={action}>执行</button>)
      fireEvent.click(screen.getByRole('button', { name: '执行' }))
      await waitFor(() => expect(agentSurfaceActions(f.host.model).get(name)).toHaveBeenCalledExactlyOnceWith())
      expect(f.report).not.toHaveBeenCalled()
    } finally { f.dispose() }
  })

  it('保留可选参数、文本、附件、布尔值及排序参数', async () => {
    const f = fixture()
    try {
      const actions = agentSurfaceActions(f.connect())
      const cases: [AgentDetachedCommandName, unknown[]][] = [
        ['workspace.onCreateSession', ['group-one']], ['workspace.onSend', ['问题', ['attachment-one']]],
        ['workspace.onContextCompressionPendingChange', [false]],
        ['workspace.onMoveQueuedTurn', ['turn-one', 'turn-two', 'before']],
      ]
      for (const [name, args] of cases) {
        await actions.get(name)!(...args)
        expect(agentSurfaceActions(f.host.model).get(name)).toHaveBeenCalledExactlyOnceWith(...args)
      }
      expect(f.report).not.toHaveBeenCalled()
    } finally { f.dispose() }
  })

  it('小窗适配器重建后从宿主已确认序号继续输入，不丢失后续草稿', async () => {
    const f = fixture()
    try {
      await f.connect().workspace!.onDraftChange('旧窗口草稿')
      const replacement = new AgentRemoteAdapter(f.client, f.report)
      await f.connect(replacement).workspace!.onDraftChange('重建后新草稿')
      expect(f.host.model.workspace!.onDraftChange).toHaveBeenLastCalledWith('重建后新草稿')
      expect(f.host.inputSequence).toBe(2)
      await replacement.flush()
    } finally { f.dispose() }
  })

  it('非法输入在本地拒绝，不污染草稿回显或阻塞后续交接', async () => {
    const f = fixture()
    try {
      const change = agentSurfaceActions(f.connect()).get('workspace.onDraftChange')!
      await expect(change({ type: 'input' })).rejects.toThrow('agent_command_invalid')
      expect(f.send).not.toHaveBeenCalled()
      expect(f.connect().workspace!.draft).toBe('')
      await expect(f.remote.flush()).resolves.toBeUndefined()
      await change('有效草稿')
      expect(f.host.model.workspace!.onDraftChange).toHaveBeenCalledExactlyOnceWith('有效草稿')
      expect(f.report).toHaveBeenCalledOnce()
    } finally { f.dispose() }
  })

  it('草稿发送失败仍允许停止任务，但不能越过未确认输入发送新问题', async () => {
    const f = fixture()
    try {
      const workspace = f.connect().workspace!
      f.send.mockImplementationOnce(() => { throw new Error('合成输入发送失败') })
      await expect(workspace.onDraftChange('尚未确认的草稿')).rejects.toThrow('合成输入发送失败')
      await workspace.onStop()
      expect(f.host.model.workspace!.onStop).toHaveBeenCalledExactlyOnceWith()
      await expect(workspace.onSend('新问题', [])).rejects.toThrow('detached_receipt_unconfirmed')
      expect(f.host.model.workspace!.onSend).not.toHaveBeenCalled()
      expect(f.host.model.workspace!.onDraftChange).not.toHaveBeenCalled()
    } finally { f.dispose() }
  })

  it('会话切换后拒绝旧视图的停止命令，不操作新会话', async () => {
    const f = fixture()
    try {
      const workspace = f.connect().workspace!
      f.host.model.workspace!.selected_session_id = 'two'
      await expect(workspace.onStop()).rejects.toThrow('detached_operation_failed')
      expect(f.host.model.workspace!.onStop).not.toHaveBeenCalled()
      expect(f.report).toHaveBeenCalledOnce()
    } finally { f.dispose() }
  })

  it('窗口释放后，微任务中尚未发出的停止命令不会送达宿主', async () => {
    const f = fixture()
    try {
      const operation = f.connect().workspace!.onStop()
      f.client.dispose()
      await expect(operation).rejects.toThrow('detached_disconnected')
      expect(f.send).not.toHaveBeenCalled()
      expect(f.host.model.workspace!.onStop).not.toHaveBeenCalled()
    } finally { f.dispose() }
  })

  it('结果不确定时反馈失败，同步输入回执不会重发停止命令', async () => {
    const f = fixture()
    const stop = vi.fn(() => { throw new Error('合成业务失败') })
    f.host.model.workspace!.onStop = stop
    try {
      await expect(f.connect().workspace!.onStop()).rejects.toThrow('detached_operation_failed')
      await f.remote.flush()
      f.connect()
      expect(stop).toHaveBeenCalledExactlyOnceWith()
      expect(f.report).toHaveBeenCalledOnce()
    } finally { f.dispose() }
  })
})
