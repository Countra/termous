import { App as AntdApp } from 'antd'
import { fireEvent, render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { VncCredentialDialog } from './RemoteDesktopWorkspace'

const runtimeMock = vi.hoisted(() => ({
  value: {
    viewerStates: {} as Record<string, {
      connection: string
      credentialTypes: Array<'username' | 'password' | 'target'>
    }>,
    submitCredentials: vi.fn(),
    closeSession: vi.fn(async () => undefined),
  },
}))

vi.mock('#features/remote-desktop', () => ({
  RemoteDesktopLauncher: () => null,
  RemoteDesktopViewport: () => null,
  useRemoteDesktopRuntime: () => runtimeMock.value,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

afterEach(() => {
  runtimeMock.value.viewerStates = {}
  runtimeMock.value.submitCredentials.mockReset()
  runtimeMock.value.closeSession.mockReset()
  runtimeMock.value.closeSession.mockResolvedValue(undefined)
})

test('VNC 凭据弹窗断开失败时显示错误且不产生未处理拒绝', async () => {
  const user = userEvent.setup()
  const session = remoteDesktopSession('rds_close_failure')
  runtimeMock.value.viewerStates = {
    [session.id]: { connection: 'credentials_required', credentialTypes: ['password'] },
  }
  runtimeMock.value.closeSession.mockRejectedValueOnce(new Error('close failed'))

  render(
    <AntdApp>
      <VncCredentialDialog session={session} />
    </AntdApp>,
  )

  await user.click(await findButton('remoteDesktop.disconnect'))

  expect(runtimeMock.value.closeSession).toHaveBeenCalledWith(session.id)
  await waitFor(() => {
    expect(document.body).toHaveTextContent('remoteDesktop.disconnectFailed')
    expect(document.body).toHaveTextContent('close failed')
  })
})

test('切换到另一远程桌面会话时清空未提交的 VNC 凭据', async () => {
  const first = remoteDesktopSession('rds_first')
  const second = remoteDesktopSession('rds_second')
  runtimeMock.value.viewerStates = {
    [first.id]: { connection: 'credentials_required', credentialTypes: ['password'] },
    [second.id]: { connection: 'credentials_required', credentialTypes: ['password'] },
  }
  const tree = (session: RemoteDesktopSession) => (
    <AntdApp>
      <VncCredentialDialog session={session} />
    </AntdApp>
  )
  const view = render(tree(first))
  const firstInput = await passwordInput()
  fireEvent.change(firstInput, { target: { value: 'session-a-secret' } })
  expect(firstInput.value).toBe('session-a-secret')

  view.rerender(tree(second))

  await waitFor(async () => {
    expect((await passwordInput()).value).toBe('')
  })
  expect(runtimeMock.value.submitCredentials).not.toHaveBeenCalled()
})

async function passwordInput() {
  let input: HTMLInputElement | null = null
  await waitFor(() => {
    input = document.querySelector('input[type="password"]')
    expect(input).not.toBeNull()
  })
  return input!
}

async function findButton(name: string) {
  let button: HTMLButtonElement | null = null
  await waitFor(() => {
    button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent?.trim() === name) ?? null
    expect(button).not.toBeNull()
  })
  return button!
}

function remoteDesktopSession(id: string): RemoteDesktopSession {
  return {
    id,
    profile_id: `profile_${id}`,
    profile_name: id,
    ssh_host_id: 'hst_test',
    ssh_host_name: 'Test host',
    protocol: 'vnc',
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    status: 'streaming',
    phase: 'streaming',
    status_message: 'streaming',
    connection_generation: 1,
    viewer_attached: true,
    reconnect_attempt: 0,
    reconnect_max_attempts: 3,
    created_at: '2026-08-23T12:00:00Z',
    updated_at: '2026-08-23T12:00:00Z',
  }
}
