import { App as AntdApp } from 'antd'
import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Host } from '#entities/host'
import type { Session } from '#entities/session'

const runtime = vi.hoisted(() => ({
  start: vi.fn(),
  interruptTask: vi.fn(),
  interruptTarget: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; code?: number; max?: number }) => {
      const value = options?.count ?? options?.code ?? options?.max
      return value === undefined ? key : `${key}:${value}`
    },
  }),
}))

vi.mock('../runtime/commandDispatchContext', () => ({
  useCommandDispatchRuntime: () => ({
    state: {
      task: null,
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
    truncated: false,
  }),
}))

import { CommandDispatchDock } from './CommandDispatchDock'

describe('会话命令台输入与指定目标交互', () => {
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

  it('按 UTF-8 8 KiB 与 64 个目标限制发送', () => {
    renderDock()
    const input = screen.getByLabelText('commandDispatch.commandInput')
    fireEvent.change(input, { target: { value: '中'.repeat(2731) } })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('commandDispatch.commandTooLarge:8')).toBeInTheDocument()
    expect(screen.getByRole('button', {
      name: 'commandDispatch.sendToCount:1',
    })).toBeDisabled()

    renderDock(65)
    const allScopes = document.querySelectorAll('[data-command-dispatch-scope="all"]')
    fireEvent.click(allScopes[allScopes.length - 1]!)
    expect(screen.getByText('commandDispatch.tooManyTargets:65')).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'commandDispatch.selectAll' }))
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByText('commandDispatch.selectedCount:2')).toBeInTheDocument()
  })

  it('默认会话名与主机名相同时不重复显示', async () => {
    renderDock(2, (item) => item.host_id === 'host-1' ? '阿里云-上海' : '测试会话')
    fireEvent.click(document.querySelector('[data-command-dispatch-scope="selected"]')!)
    fireEvent.click(document.querySelector('[data-command-dispatch-target-picker]')!)

    await screen.findByLabelText('commandDispatch.searchTargets')
    expect(screen.getAllByText('阿里云-上海')).toHaveLength(1)
    expect(screen.getByText('root@203.0.113.7:22')).toBeInTheDocument()
  })
})

function renderDock(
  sessionCount = 2,
  resolveSessionTitle: (session: Session) => string = (item) => `会话 ${item.id.slice(-1)}`,
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
        onJumpToSession={vi.fn()}
      />
    </AntdApp>,
  )
}

function session(id: string, hostId: string): Session {
  return {
    id,
    host_id: hostId,
    kind: 'ssh',
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
