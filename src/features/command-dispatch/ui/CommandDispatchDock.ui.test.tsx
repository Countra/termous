import { App as AntdApp } from 'antd'
import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeyboardEventHandler } from 'react'
import type { CommandDispatchTargetStatus, CommandDispatchTask } from '#entities/command-dispatch'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'

const runtime = vi.hoisted(() => ({
  start: vi.fn(),
  interruptTask: vi.fn(),
  interruptTarget: vi.fn(),
  selectTask: vi.fn(),
  truncated: false,
  task: null as CommandDispatchTask | null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string, options?: { count?: number; code?: number; max?: number }) => {
      const value = options?.count ?? options?.code ?? options?.max
      return value === undefined ? key : `${key}:${value}`
    },
  }),
}))

vi.mock('../runtime/commandDispatchContext', () => ({
  useCommandDispatchRuntime: () => ({
    tasks: runtime.task ? [runtime.task] : [],
    state: {
      task: runtime.task,
      recovering: false,
      starting: false,
      interruptingTask: false,
      interruptingSessionIds: new Set(),
      errorCode: '',
      errorMessage: '',
    },
    ...runtime,
  }),
  useCommandDispatchTargetOutput: () => ({
    taskId: '',
    sessionId: '',
    revision: 0,
    data: new Uint8Array(),
    chunk: new Uint8Array(),
    resetRevision: 0,
    connected: false,
    ended: false,
    truncated: runtime.truncated,
  }),
}))

import { CommandDispatchDock } from './CommandDispatchDock'

describe('会话命令台输入与指定目标交互', () => {
  beforeEach(() => {
    // jsdom 没有滚动接口，标签定位在真实浏览器中另行验证。
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
    vi.clearAllMocks()
    runtime.task = null
    runtime.truncated = false
    runtime.start.mockResolvedValue(dispatchTask())
    runtime.interruptTask.mockResolvedValue(null)
    runtime.interruptTarget.mockResolvedValue(null)
  })

  it('输入上限与多行粘贴约束保持在界面边界', () => {
    renderDock()
    const input = screen.getByLabelText('commandDispatch.commandInput')
    expect(input).toHaveAttribute('maxlength', '8192')
    expect(screen.getByRole('button', {
      name: 'commandDispatch.sendToCount:1',
    })).toBeInTheDocument()

    const paste = createEvent.paste(input, {
      clipboardData: { getData: () => 'printf one\nprintf two' },
    })
    fireEvent(input, paste)
    expect(paste.defaultPrevented).toBe(true)
  })

  it('无任务时保留独立编辑器与统一结果空态', () => {
    const { container } = renderDock()
    const resultsEmpty = container.querySelector('[data-command-dispatch-empty="results"]')
    expect(screen.getByRole('region', { name: 'commandDispatch.editor' })).toBeInTheDocument()
    expect(resultsEmpty).toHaveTextContent('commandDispatch.ready')
    expect(resultsEmpty).toHaveTextContent('commandDispatch.noResults')
    expect(screen.queryByRole('tablist', { name: 'commandDispatch.results' })).not.toBeInTheDocument()
  })

  it('按 UTF-8 8 KiB 与 64 个目标限制发送', () => {
    renderDock()
    const input = screen.getByLabelText('commandDispatch.commandInput')
    fireEvent.change(input, { target: { value: '中'.repeat(2731) } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('commandDispatch.commandTooLarge:8')
    expect(screen.getByRole('alert')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('button', {
      name: 'commandDispatch.sendToCount:1',
    })).toBeDisabled()

    renderDock(65)
    const allScopes = document.querySelectorAll('[data-command-dispatch-scope="all"]')
    fireEvent.click(allScopes[allScopes.length - 1]!)
    const alerts = screen.getAllByRole('alert')
    expect(alerts[alerts.length - 1]).toHaveTextContent('commandDispatch.tooManyTargets:65')
    expect(screen.getByRole('button', {
      name: 'commandDispatch.sendToCount:65',
    })).toBeDisabled()
  })

  it('指定目标 Popover 展示会话、主机与端点并支持搜索和全选', async () => {
    renderDock()
    fireEvent.click(document.querySelector('[data-command-dispatch-scope="selected"]')!)
    fireEvent.click(document.querySelector('[data-command-dispatch-target-picker]')!)

    const search = await screen.findByLabelText('commandDispatch.searchTargets')
    expect(screen.getByText('阿里云-上海')).toBeInTheDocument()
    expect(screen.getByText('root@203.0.113.7:22')).toBeInTheDocument()
    expect(screen.getByText('测试2')).toBeInTheDocument()
    expect(screen.getByText('tester@198.51.100.9:2222')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: '198.51.100.9' } })
    await waitFor(() => expect(screen.queryByText('阿里云-上海')).not.toBeInTheDocument())
    expect(screen.getByText('测试2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'commandDispatch.selectAll' }))
    expect(screen.getByRole('checkbox', { name: /测试2/ })).toBeChecked()
    expect(screen.getByText('commandDispatch.selectedCount:2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'commandDispatch.selectAll' }))
    expect(screen.getByRole('checkbox', { name: /测试2/ })).not.toBeChecked()
    expect(screen.getByText('commandDispatch.selectedCount:0')).toBeInTheDocument()
  })

  it('默认会话名与主机名相同时不重复显示', async () => {
    renderDock(2, (item) => item.host_id === 'host-1' ? '阿里云-上海' : '测试会话')
    fireEvent.click(document.querySelector('[data-command-dispatch-scope="selected"]')!)
    fireEvent.click(document.querySelector('[data-command-dispatch-target-picker]')!)

    await screen.findByLabelText('commandDispatch.searchTargets')
    expect(screen.getAllByText('阿里云-上海')).toHaveLength(1)
    expect(screen.getByText('root@203.0.113.7:22')).toBeInTheDocument()
  })

  it('指定会话通过 Escape 收起并归还焦点，不将按键传给外层', async () => {
    const outerKeyDown = vi.fn()
    renderDock(2, undefined, undefined, outerKeyDown)
    fireEvent.click(document.querySelector('[data-command-dispatch-scope="selected"]')!)
    const trigger = screen.getByRole('button', { name: 'commandDispatch.selectedCount:1' })
    fireEvent.click(trigger)
    const search = await screen.findByLabelText('commandDispatch.searchTargets')
    search.focus()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    expect(outerKeyDown).not.toHaveBeenCalled()
    expect(runtime.start).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(outerKeyDown).not.toHaveBeenCalled()
  })

  it('退出码徽标区分成功、失败和不可用状态', () => {
    runtime.task = dispatchTask()
    const { container } = renderDock(4)

    const resultList = screen.getByRole('tablist', { name: 'commandDispatch.results' })
    expect(resultList).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(4)

    const badges = container.querySelectorAll<HTMLElement>('[data-exit-code-status]')
    const [success, failure, unknown] = badges
    expect(success).toHaveAttribute('data-exit-code-status', 'success')
    expect(success.querySelector('[aria-hidden="true"]')).toHaveTextContent('0')
    expect(success).toHaveTextContent('commandDispatch.exitCode:0')
    expect(failure).toHaveAttribute('data-exit-code-status', 'failure')
    expect(failure.querySelector('[aria-hidden="true"]')).toHaveTextContent('7')
    expect(failure).toHaveTextContent('commandDispatch.exitCode:7')
    expect(unknown).toHaveAttribute('data-exit-code-status', 'unknown')
    expect(unknown.querySelector('[aria-hidden="true"]')).toHaveTextContent('—')
    expect(unknown).toHaveTextContent('commandDispatch.exitCodeUnavailable')
    expect(badges).toHaveLength(3)
  })

  it('历史任务留在工具栏内，不挤占编辑与结果工作区', () => {
    runtime.task = dispatchTask()
    const { container } = renderDock(4)
    const dock = container.querySelector('[data-command-dispatch-dock]')!
    expect(dock.children).toHaveLength(2)
    expect(dock.querySelector('header')).toContainElement(
      screen.getByRole('button', { name: 'commandDispatch.taskList' }),
    )
  })

  it('输出截断警告保持可读并支持键盘聚焦', () => {
    runtime.task = dispatchTask()
    runtime.truncated = true
    renderDock(4)
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent('commandDispatch.outputTruncated')
    expect(warning).toHaveAttribute('tabindex', '0')
  })

  it('历史命令只填入并聚焦编辑器，不直接执行或修改目标范围', () => {
    runtime.task = dispatchTask()
    renderDock(4)
    fireEvent.click(screen.getByRole('button', { name: 'commandDispatch.reuseCommand' }))
    const input = screen.getByLabelText('commandDispatch.commandInput')
    expect(input).toHaveValue('example')
    expect(input).toHaveFocus()
    expect(document.querySelector('[data-command-dispatch-scope="current"]')).toHaveAttribute('aria-pressed', 'true')
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('回车按当前目标执行，输入法确认不触发命令提交', async () => {
    renderDock()
    const input = screen.getByLabelText('commandDispatch.commandInput')
    fireEvent.change(input, { target: { value: 'printf hello' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(runtime.start).not.toHaveBeenCalled()
    const enter = createEvent.keyDown(input, { key: 'Enter' })
    fireEvent(input, enter)
    expect(enter.defaultPrevented).toBe(true)
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith(expect.objectContaining({
      command: 'printf hello', scope: 'current', target_session_ids: ['session-1'],
    })))
    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    expect(runtime.start).toHaveBeenCalledTimes(1)
  })

  it('输入变更中的真实换行被拒绝，保留原有单行命令', () => {
    renderDock()
    const input = screen.getByLabelText('commandDispatch.commandInput')
    fireEvent.change(input, { target: { value: 'uptime' } })
    fireEvent.change(input, { target: { value: 'uptime\nwhoami' } })
    expect(input).toHaveValue('uptime')
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('会话标签支持键盘切换，回显与原终端跳转跟随当前结果', () => {
    runtime.task = dispatchTask()
    const onJump = vi.fn()
    renderDock(4, undefined, onJump)
    const tabs = screen.getAllByRole('tab')
    fireEvent.keyDown(tabs[0]!, { key: 'ArrowRight' })
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tabs[1]!.id)
    fireEvent.click(screen.getByRole('button', { name: 'commandDispatch.openOriginalTerminal' }))
    expect(onJump).toHaveBeenCalledWith('session-2')
    fireEvent.keyDown(tabs[1]!, { key: 'End' })
    expect(tabs[3]).toHaveAttribute('aria-selected', 'true')
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('任务记录支持搜索，查看记录只切换任务而不重新执行', async () => {
    runtime.task = dispatchTask()
    renderDock(4)
    fireEvent.click(screen.getByRole('button', { name: 'commandDispatch.taskList' }))
    const search = await screen.findByLabelText('commandDispatch.searchHistory')
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(screen.getByText('commandDispatch.noHistoryMatches')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'example' } })
    const record = screen.getByRole('button', { name: /example.*commandDispatch.targetCount:4/ })
    record.focus()
    fireEvent.click(record)
    expect(runtime.selectTask).toHaveBeenCalledWith('task-1')
    expect(runtime.start).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'commandDispatch.taskList' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'commandDispatch.taskList' })).toHaveFocus()
  })

  it('任务记录通过 Escape 收起并归还焦点，不触发外层抽屉或执行动作', async () => {
    runtime.task = dispatchTask()
    const outerKeyDown = vi.fn()
    renderDock(4, undefined, undefined, outerKeyDown)
    const trigger = screen.getByRole('button', { name: 'commandDispatch.taskList' })
    fireEvent.click(trigger)
    const search = await screen.findByLabelText('commandDispatch.searchHistory')
    search.focus()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
    expect(outerKeyDown).not.toHaveBeenCalled()
    expect(runtime.selectTask).not.toHaveBeenCalled()
    expect(runtime.start).not.toHaveBeenCalled()
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(outerKeyDown).not.toHaveBeenCalled()
  })

  it('中断单个目标与整个任务保持独立入口', () => {
    runtime.task = {
      ...dispatchTask(), status: 'running', interruptible: true,
      targets: [dispatchTarget('session-1', 'running', false), dispatchTarget('session-2', 'queued', false)],
    }
    renderDock()
    fireEvent.click(screen.getByRole('button', { name: 'commandDispatch.interruptTarget' }))
    expect(runtime.interruptTarget).toHaveBeenCalledWith('session-1')
    expect(runtime.interruptTask).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'commandDispatch.interruptAll' }))
    expect(runtime.interruptTask).toHaveBeenCalledOnce()
  })
})

function renderDock(
  sessionCount = 2,
  resolveSessionTitle: (session: Session) => string = (item) => `会话 ${item.id.slice(-1)}`,
  onJumpToSession = vi.fn(),
  onOuterKeyDown?: KeyboardEventHandler<HTMLDivElement>,
) {
  const sessions: Session[] = Array.from({ length: sessionCount }, (_, index) => (
    session(`session-${index + 1}`, `host-${index + 1}`)
  ))
  const hosts: Host[] = Array.from({ length: sessionCount }, (_, index) => {
    if (index === 0) return host('host-1', '阿里云-上海', 'root', '203.0.113.7', 22)
    if (index === 1) return host('host-2', '测试2', 'tester', '198.51.100.9', 2222)
    return host(`host-${index + 1}`, `测试${index + 1}`, 'root', `192.0.2.${index + 1}`, 22)
  })
  return render(
    <AntdApp>
      <div onKeyDown={onOuterKeyDown}>
        <CommandDispatchDock
          sessions={sessions}
          hosts={hosts}
          activeSession={sessions[0]!}
          terminalSettings={{
            font_size: 14,
            line_height: 1.2,
            letter_spacing: 0,
            scrollback: 5_000,
          } as never}
          theme="dark"
          resolveSessionTitle={resolveSessionTitle}
          onJumpToSession={onJumpToSession}
        />
      </div>
    </AntdApp>,
  )
}

function session(id: string, hostId: string): Session {
  return {
    id,
    host_id: hostId,
    kind: 'ssh',
    origin: 'app',
    status: 'connected',
    started_at: '2026-08-12T00:00:00Z',
    pty_cols: 120,
    pty_rows: 32,
  }
}

function host(
  id: string,
  name: string,
  username: string,
  address: string,
  port: number,
): Host {
  return {
    id,
    name,
    username,
    address,
    port,
    platform: 'linux',
    group_id: 'group-1',
    auth_method: 'password',
    credential_id: 'credential-1',
    tags: [],
    favorite: false,
    fingerprint_policy: 'strict',
  }
}

function dispatchTask(): CommandDispatchTask {
  return {
    id: 'task-1',
    client_request_id: 'request-1',
    revision: 1,
    scope: 'selected',
    status: 'partial_failed',
    command: 'example',
    target_session_ids: ['session-1', 'session-2', 'session-3', 'session-4'],
    targets: [
      dispatchTarget('session-1', 'succeeded', true, 0),
      dispatchTarget('session-2', 'failed', true, 7),
      dispatchTarget('session-3', 'completed_unknown', false),
      dispatchTarget('session-4', 'rejected', false),
    ],
    total_targets: 4,
    completed_targets: 4,
    succeeded_targets: 1,
    failed_targets: 1,
    interrupted_targets: 0,
    rejected_targets: 1,
    unknown_targets: 1,
    interruptible: false,
    created_at: '2026-08-12T00:00:00Z',
  }
}

function dispatchTarget(
  sessionId: string,
  status: CommandDispatchTargetStatus,
  exitCodeKnown: boolean,
  exitCode?: number,
) {
  return {
    session_id: sessionId,
    index: Number(sessionId.slice(-1)) - 1,
    status,
    status_message: status,
    input_lock: { locked: false },
    exit_code_known: exitCodeKnown,
    ...(exitCode === undefined ? {} : { exit_code: exitCode }),
    output_stream: {
      epoch: '00000000000000000000000000000000',
      oldest_offset: '0',
      next_offset: '0',
      resume_offset: '0',
      truncated: false,
    },
  }
}
