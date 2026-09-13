import { useEffect, useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AgentSlashCandidateCatalog } from '#entities/agent'
import type {
  AgentWorkspaceSlashAvailability,
  AgentWorkspaceSlashExecution,
} from '../model/types.ts'
import { useAgentSlashCommands } from '../model/useAgentSlashCommands.ts'
import { AgentSlashCommandMenu } from './AgentSlashCommandMenu.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'zh-CN', resolvedLanguage: 'zh-CN' },
  }),
}))

const availability: AgentWorkspaceSlashAvailability = {
  session: { enabled: true },
  profile: { enabled: true },
  compact: { enabled: true },
}

const catalog: AgentSlashCandidateCatalog = {
  session: {
    ssh: [sshSession('ssh-one', 'Production'), sshSession('ssh-disabled', 'Offline', 'session_not_ready')],
    file: [{
      id: 'file-one', kind: 'file_session', resource_kind: 'file', host_id: 'local', host_name: 'Local Files',
      profile_id: 'file-profile', profile_name: 'Workspace', file_access_profile_id: 'file-profile',
      representative_session_id: 'file-session', session_count: 2, status: 'connected', current: false,
    }],
  },
  profile: { ssh: [{
    id: 'ssh-profile-one', kind: 'ssh_profile', resource_kind: 'ssh', host_id: 'host-profile',
    host_name: 'Profile Host', profile_id: 'profile-one', profile_name: 'Primary',
    ssh_profile_id: 'profile-one', sort_order: 0, status: 'ready', current: false,
  }], file: [] },
}

function SlashHarness({
  owner = 'session-a',
  active = true,
  editing = false,
  initialValue = '',
  slashAvailability = availability,
  onExecute = vi.fn(async () => true),
  onFallbackKey,
}: {
  owner?: string
  active?: boolean
  editing?: boolean
  initialValue?: string
  slashAvailability?: AgentWorkspaceSlashAvailability
  onExecute?: (execution: AgentWorkspaceSlashExecution) => Promise<boolean>
  onFallbackKey?: (key: string) => void
}) {
  const [value, setValue] = useState(initialValue)
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const controller = useAgentSlashCommands({
    value,
    owner,
    editing,
    active,
    containerRef,
    catalog,
    availability: slashAvailability,
    onChange: setValue,
    onExecute,
  })
  const onNativeBeforeInput = controller.onNativeBeforeInput
  useEffect(() => {
    const container = containerRef.current
    const handleBeforeInput = (event: Event) => onNativeBeforeInput(event as InputEvent)
    container?.addEventListener('beforeinput', handleBeforeInput)
    return () => container?.removeEventListener('beforeinput', handleBeforeInput)
  }, [onNativeBeforeInput])
  return (
    <div ref={containerRef}>
      <AgentSlashCommandMenu
        controller={controller}
        onFocusComposer={() => textareaRef.current?.focus()}
      />
      <textarea
        ref={textareaRef}
        aria-label="composer"
        value={value}
        aria-expanded={controller.state.level !== 'closed'}
        aria-controls={controller.state.level === 'closed' ? undefined : `${controller.menuId}-list`}
        aria-activedescendant={controller.state.level === 'root' ? controller.activeOptionId : undefined}
        onChange={(event) => controller.onInputValueChange(event.currentTarget.value)}
        onCompositionStart={controller.suppressActivation}
        onPaste={controller.suppressActivation}
        onKeyDown={(event) => {
          if (controller.onTextareaKeyDown(event)) return
          onFallbackKey?.(event.key)
        }}
      />
    </div>
  )
}

describe('Agent Slash 上拉菜单', () => {
  it('只由直接键入激活，粘贴同样的命令不会打开菜单', async () => {
    const user = userEvent.setup()
    const view = render(<SlashHarness />)
    const textarea = composer()
    await user.type(textarea, '/')
    expect(screen.getByRole('listbox', { name: 'agent.slash.commands.title' })).toBeInTheDocument()
    expect(textarea).toHaveAttribute('aria-expanded', 'true')

    view.unmount()
    render(<SlashHarness />)
    fireEvent.paste(composer(), {
      clipboardData: { files: [], items: [], getData: () => '/session' },
    })
    fireEvent.change(composer(), { target: { value: '/session' } })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.type(composer(), 'x')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('根层优先消费方向键和 Enter，并把焦点逐层交给类型与搜索', async () => {
    const user = userEvent.setup()
    const onFallbackKey = vi.fn()
    render(<SlashHarness onFallbackKey={onFallbackKey} />)
    const textarea = composer()
    await user.type(textarea, '/session')
    expect(textarea).toHaveFocus()
    expect(textarea.getAttribute('aria-activedescendant')).toContain('session')
    await user.keyboard('{ArrowDown}{ArrowUp}{Shift>}{Enter}{/Shift}')
    const fallbackKeys = onFallbackKey.mock.calls.map(([key]) => key)
    expect(fallbackKeys.filter((key) => key === 'Enter')).toHaveLength(1)
    expect(fallbackKeys).not.toContain('ArrowDown')
    expect(fallbackKeys).not.toContain('ArrowUp')

    await user.keyboard('{Enter}')
    const kindList = screen.getByRole('listbox', { name: 'agent.slash.resourceKind.title' })
    expect(kindList).toHaveFocus()
    expect(kindList).toHaveAttribute('aria-activedescendant', expect.stringContaining('ssh'))
    await user.keyboard('{ArrowDown}{Enter}')
    const search = screen.getByRole('textbox', { name: 'agent.slash.search' })
    expect(search).toHaveFocus()
    expect(screen.getByText('Local Files')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('listbox', { name: 'agent.slash.resourceKind.title' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(textarea).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('搜索候选、跳过禁用项并在成功受理后精确消费命令片段', async () => {
    const user = userEvent.setup()
    const onExecute = vi.fn(async () => true)
    render(<SlashHarness onExecute={onExecute} />)
    const textarea = composer()
    await user.type(textarea, '/session followed')
    await user.keyboard('{Enter}{Enter}')
    const search = screen.getByRole('textbox', { name: 'agent.slash.search' })
    await user.type(search, 'prod')
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByText(/ssh-one/)).toBeInTheDocument()
    expect(screen.queryByText('Offline')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(onExecute).toHaveBeenCalledOnce())
    expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({
      command_id: 'session',
      resource_kind: 'ssh',
      candidate: expect.objectContaining({ id: 'ssh-one' }),
      capture: { owner: 'session-a', start: 0, end: 9, raw_fragment: '/session ' },
    }))
    await waitFor(() => expect(textarea).toHaveValue('followed'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(textarea).toHaveFocus()
  })

  it('资源搜索无结果时保持稳定且不触发循环更新', async () => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<SlashHarness />)

      await user.type(composer(), '/session')
      await user.keyboard('{Enter}{Enter}')
      const search = screen.getByRole('textbox', { name: 'agent.slash.search' })
      await user.type(search, 'missing-candidate')

      expect(screen.getByText('agent.slash.searchEmpty')).toBeInTheDocument()
      expect(screen.getByRole('listbox', { name: 'agent.slash.resources.title' }))
        .not.toHaveAttribute('aria-activedescendant')
      expect(consoleError.mock.calls.some(([message]) => (
        String(message).includes('Maximum update depth exceeded')
      ))).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('SSH 操作忙碌时禁用 SSH 类型和候选，但文件类型仍可进入', async () => {
    const user = userEvent.setup()
    const busyAvailability: AgentWorkspaceSlashAvailability = {
      ...availability,
      session: {
        enabled: true,
        resource_kinds: {
          ssh: { enabled: false, disabled_reason: 'resource_busy' },
          file: { enabled: true },
        },
      },
    }
    const view = render(<SlashHarness />)
    await user.type(composer(), '/session')
    await user.keyboard('{Enter}{Enter}')
    expect(screen.getByText('Production')).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Offline/ }))
      .toHaveTextContent('agent.slash.disabled.session_not_ready')

    view.rerender(<SlashHarness slashAvailability={busyAvailability} />)
    const sshCandidate = screen.getByRole('option', { name: /Production/ })
    expect(sshCandidate).toHaveAttribute('aria-disabled', 'true')
    expect(sshCandidate).not.toHaveTextContent('agent.slash.disabled.resource_busy')
    expect(screen.getByRole('status')).toHaveTextContent('agent.slash.disabled.resource_busy')

    await user.keyboard('{Escape}')
    const sshKind = screen.getByRole('option', { name: /agent.slash.resourceKind.ssh.title/ })
    const fileKind = screen.getByRole('option', { name: /agent.slash.resourceKind.file.title/ })
    expect(sshKind).toHaveAttribute('aria-disabled', 'true')
    expect(sshKind).toHaveTextContent('agent.slash.disabled.resource_busy')
    expect(fileKind).toHaveAttribute('aria-disabled', 'false')
    expect(screen.getByRole('listbox', { name: 'agent.slash.resourceKind.title' }))
      .toHaveAttribute('aria-activedescendant', expect.stringContaining('file'))

    await user.keyboard('{Enter}')
    expect(screen.getByText('Local Files')).toBeInTheDocument()
    expect(screen.getByText(/agent\.slash\.sessionCount.*agent\.slash\.status\.connected/)).toBeInTheDocument()
  })

  it('鼠标选择命令时优先聚焦当前可用的资源类型', async () => {
    const user = userEvent.setup()
    render(<SlashHarness slashAvailability={{
      session: {
        enabled: true,
        resource_kinds: {
          ssh: { enabled: false, disabled_reason: 'resource_busy' },
          file: { enabled: true },
        },
      },
      profile: { enabled: false, disabled_reason: 'workspace_unavailable' },
      compact: { enabled: false, disabled_reason: 'workspace_unavailable' },
    }} />)

    await user.type(composer(), '/')
    await user.click(screen.getByRole('option', { name: /\/session/ }))

    const kindList = screen.getByRole('listbox', { name: 'agent.slash.resourceKind.title' })
    expect(kindList).toHaveAttribute('aria-activedescendant', expect.stringContaining('-kind-file'))
    expect(screen.getByRole('option', { name: /agent.slash.resourceKind.file.title/ }))
      .toHaveAttribute('aria-selected', 'true')
  })

  it('当前资源选择提交期间只显示一条非候选错误状态', async () => {
    const user = userEvent.setup()
    const pending = deferred<boolean>()
    const onExecute = vi.fn(() => pending.promise)
    const submittingAvailability: AgentWorkspaceSlashAvailability = {
      ...availability,
      session: {
        enabled: false,
        disabled_reason: 'mutation_busy',
        resource_kinds: {
          ssh: { enabled: false, disabled_reason: 'mutation_busy' },
          file: { enabled: false, disabled_reason: 'mutation_busy' },
        },
      },
    }
    const view = render(<SlashHarness onExecute={onExecute} />)
    await user.type(composer(), '/session')
    await user.keyboard('{Enter}{Enter}{Enter}')

    await waitFor(() => expect(onExecute).toHaveBeenCalledOnce())
    view.rerender(<SlashHarness slashAvailability={submittingAvailability} onExecute={onExecute} />)
    const candidate = screen.getByRole('option', { name: /Production/ })
    expect(candidate).toHaveAttribute('aria-disabled', 'true')
    expect(candidate).not.toHaveTextContent('agent.slash.disabled.mutation_busy')
    expect(screen.getByRole('status')).toHaveTextContent('agent.slash.processing')

    pending.resolve(false)
    await waitFor(() => expect(screen.getByRole('status'))
      .toHaveTextContent('agent.slash.disabled.mutation_busy'))
    expect(candidate).not.toHaveTextContent('agent.slash.disabled.mutation_busy')

    view.rerender(<SlashHarness onExecute={onExecute} />)
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
  })

  it('业务拒绝或等待期间草稿已变化时不消费命令', async () => {
    const user = userEvent.setup()
    const pending = deferred<boolean>()
    const view = render(<SlashHarness initialValue="" onExecute={() => pending.promise} />)
    const textarea = composer()
    await user.type(textarea, '/compact original')
    await user.keyboard('{Enter}')
    fireEvent.change(textarea, { target: { value: '/compact changed' } })
    pending.resolve(true)
    await waitFor(() => expect(textarea).toHaveValue('/compact changed'))

    view.unmount()
    const rejected = vi.fn(async () => false)
    render(<SlashHarness onExecute={rejected} />)
    await user.type(composer(), '/compact text')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(rejected).toHaveBeenCalledOnce())
    expect(composer()).toHaveValue('/compact text')
  })

  it('业务回执返回前只受理一次命令执行', async () => {
    const user = userEvent.setup()
    const pending = deferred<boolean>()
    const onExecute = vi.fn(() => pending.promise)
    render(<SlashHarness onExecute={onExecute} />)
    const textarea = composer()
    await user.type(textarea, '/compact text')
    const compact = screen.getByRole('option', { name: /\/compact/ })

    fireEvent.click(compact)
    fireEvent.click(compact)
    expect(onExecute).toHaveBeenCalledOnce()

    pending.resolve(true)
    await waitFor(() => expect(textarea).toHaveValue('text'))
  })

  it('首次静止 pointermove 不覆盖键盘选择，真实移动后才更新活动项', async () => {
    const user = userEvent.setup()
    render(<SlashHarness />)
    await user.type(composer(), '/')
    const textarea = composer()
    expect(textarea.getAttribute('aria-activedescendant')).toContain('session')
    const profile = screen.getByRole('option', { name: /\/profile/ })
    fireEvent.pointerMove(profile, { clientX: 10, clientY: 10 })
    expect(textarea.getAttribute('aria-activedescendant')).toContain('session')
    fireEvent.pointerMove(profile, { clientX: 11, clientY: 10 })
    expect(textarea.getAttribute('aria-activedescendant')).toContain('profile')
  })

  it('切换草稿 owner、隐藏面板或进入队列编辑时关闭菜单', async () => {
    const user = userEvent.setup()
    const view = render(<SlashHarness owner="session-a" />)
    await user.type(composer(), '/')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    view.rerender(<SlashHarness owner="session-b" />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    await user.clear(composer())
    await user.type(composer(), '/')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    view.rerender(<SlashHarness owner="session-b" active={false} />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    view.rerender(<SlashHarness owner="session-b" editing />)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

function composer() {
  return screen.getByRole('textbox', { name: 'composer' }) as HTMLTextAreaElement
}

function sshSession(id: string, hostName: string, disabledReason?: 'session_not_ready') {
  return {
    id,
    kind: 'ssh_session' as const,
    resource_kind: 'ssh' as const,
    session_id: id,
    host_id: `host-${id}`,
    host_name: hostName,
    profile_id: `profile-${id}`,
    profile_name: 'Primary',
    ssh_profile_id: `profile-${id}`,
    started_at: '2026-09-12T00:00:00Z',
    status: disabledReason ? 'disconnected' as const : 'ready' as const,
    current: false,
    disabled_reason: disabledReason,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
