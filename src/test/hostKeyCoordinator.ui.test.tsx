import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HostKeyChallenge,
  HostKeyChallengeSnapshot,
  HostKeyEvent,
  HostKeyResolution,
} from '#entities/host-key'
import { HostKeyCoordinator, type HostKeyGateway } from '#features/hosts'
import { TermousApiError } from '#shared/api'

const notifications = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string) => key,
  }),
}))

vi.mock('antd', () => ({
  Alert: ({ message, description }: { message?: ReactNode; description?: ReactNode }) => (
    <div>{message}{description}</div>
  ),
  App: {
    useApp: () => ({ notification: notifications }),
  },
  Button: ({
    children,
    disabled,
    loading,
    onClick,
  }: {
    children?: ReactNode
    disabled?: boolean
    loading?: boolean
    onClick?: () => void
  }) => (
    <button type="button" disabled={disabled || loading} onClick={onClick}>
      {children}
    </button>
  ),
  Modal: ({ open, children }: { open?: boolean; children?: ReactNode }) => (
    open ? <div role="dialog">{children}</div> : null
  ),
  Tag: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Typography: {
    Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  },
}))

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  closeCalls = 0
  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string | URL) {
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.onopen?.()
  }

  message(event: HostKeyEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>)
  }

  close() {
    this.closeCalls += 1
  }
}

function challenge(
  id: string,
  instanceId = 'core-a',
  createdAt = '2026-08-06T12:00:00.000Z',
): HostKeyChallenge {
  return {
    id,
    instance_id: instanceId,
    endpoint: { canonical_host: `${id}.example.com`, port: 22 },
    reason: 'unknown',
    observed_key: {
      algorithm: 'ssh-ed25519',
      fingerprint_sha256: `SHA256:${id}`,
    },
    contexts: [{ consumer_type: 'session', consumer_id: `session-${id}`, role: 'target' }],
    context_count: 1,
    state: 'pending',
    created_at: createdAt,
    expires_at: '2026-08-06T12:10:00.000Z',
  }
}

function snapshot(
  revision: number,
  challenges: HostKeyChallenge[],
  instanceId = 'core-a',
): HostKeyChallengeSnapshot {
  return {
    instance_id: instanceId,
    snapshot_revision: revision,
    challenges,
  }
}

function resolution(challengeId: string): HostKeyResolution {
  return {
    challenge_id: challengeId,
    state: 'trusted',
    resolved_at: '2026-08-06T12:01:00.000Z',
  }
}

function gateway(overrides: Partial<HostKeyGateway> = {}): HostKeyGateway {
  return {
    hostKeyChallenges: vi.fn(async () => snapshot(0, [])),
    decideHostKeyChallenge: vi.fn(async (id) => resolution(id)),
    hostKeyEventsUrl: vi.fn(() => 'ws://127.0.0.1:8122/api/v1/host-key/events'),
    ...overrides,
  }
}

describe('HostKeyCoordinator 行为合同', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.clearAllMocks()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('连续事件直接应用，revision 缺口和 Core 实例切换重新对账', async () => {
    const first = challenge('first')
    const second = challenge('second', 'core-a', '2026-08-06T12:01:00.000Z')
    const afterGap = challenge('after-gap', 'core-a', '2026-08-06T12:02:00.000Z')
    const afterRestart = challenge('after-restart', 'core-b', '2026-08-06T12:03:00.000Z')
    const hostKeyChallenges = vi.fn()
      .mockResolvedValueOnce(snapshot(1, [first]))
      .mockResolvedValueOnce(snapshot(5, [afterGap]))
      .mockResolvedValueOnce(snapshot(1, [afterRestart], 'core-b'))
    const api = gateway({ hostKeyChallenges })

    render(<HostKeyCoordinator api={api} enabled hosts={[]} />)

    expect(await screen.findByText('SHA256:first')).toBeInTheDocument()
    expect(FakeWebSocket.instances).toHaveLength(1)
    const socket = FakeWebSocket.instances[0]

    await act(async () => {
      socket.message({
        instance_id: 'core-a',
        snapshot_revision: 2,
        type: 'challenge_resolved',
        resolution: resolution(first.id),
      })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await act(async () => {
      socket.message({
        instance_id: 'core-a',
        snapshot_revision: 3,
        type: 'challenge_upsert',
        challenge: second,
      })
    })
    expect(await screen.findByText('SHA256:second')).toBeInTheDocument()
    expect(hostKeyChallenges).toHaveBeenCalledTimes(1)

    await act(async () => {
      socket.message({
        instance_id: 'core-a',
        snapshot_revision: 5,
        type: 'challenge_upsert',
        challenge: afterGap,
      })
    })
    expect(await screen.findByText('SHA256:after-gap')).toBeInTheDocument()
    expect(hostKeyChallenges).toHaveBeenCalledTimes(2)

    await act(async () => {
      socket.message({
        instance_id: 'core-b',
        snapshot_revision: 1,
        type: 'challenge_upsert',
        challenge: afterRestart,
      })
    })
    expect(await screen.findByText('SHA256:after-restart')).toBeInTheDocument()
    expect(hostKeyChallenges).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['HOST_KEY_CHALLENGE_STALE', 409],
    ['HOST_KEY_CHALLENGE_EXPIRED', 409],
    ['HTTP_ERROR', 404],
    ['HTTP_ERROR', 410],
  ])('决策冲突 %s/%i 显示过期提示并重新对账', async (code, status) => {
    const user = userEvent.setup()
    const current = challenge('current')
    const hostKeyChallenges = vi.fn(async () => snapshot(1, [current]))
    const decideHostKeyChallenge = vi.fn(async () => {
      throw new TermousApiError('expired', code, status)
    })
    const api = gateway({ hostKeyChallenges, decideHostKeyChallenge })

    render(<HostKeyCoordinator api={api} enabled hosts={[]} />)
    await user.click(await screen.findByRole('button', { name: 'hostKey.trust' }))

    await waitFor(() => expect(notifications.warning).toHaveBeenCalledTimes(1))
    expect(notifications.error).not.toHaveBeenCalled()
    expect(hostKeyChallenges).toHaveBeenCalledTimes(2)
  })

  it('普通决策失败显示错误且不触发额外对账', async () => {
    const user = userEvent.setup()
    const current = challenge('current')
    const hostKeyChallenges = vi.fn(async () => snapshot(1, [current]))
    const decideHostKeyChallenge = vi.fn(async () => {
      throw new TermousApiError('failed', 'HOST_KEY_DECISION_FAILED', 500)
    })
    const api = gateway({ hostKeyChallenges, decideHostKeyChallenge })

    render(<HostKeyCoordinator api={api} enabled hosts={[]} />)
    await user.click(await screen.findByRole('button', { name: 'hostKey.trust' }))

    await waitFor(() => expect(notifications.error).toHaveBeenCalledTimes(1))
    expect(notifications.warning).not.toHaveBeenCalled()
    expect(hostKeyChallenges).toHaveBeenCalledTimes(1)
  })

  it('本地决策完成不抢占 WebSocket revision 顺序', async () => {
    const user = userEvent.setup()
    const current = challenge('current')
    const next = challenge('next', 'core-a', '2026-08-06T12:01:00.000Z')
    const hostKeyChallenges = vi.fn(async () => snapshot(1, [current]))
    const decideHostKeyChallenge = vi.fn(async () => resolution(current.id))
    const api = gateway({ hostKeyChallenges, decideHostKeyChallenge })

    render(<HostKeyCoordinator api={api} enabled hosts={[]} />)
    await user.click(await screen.findByRole('button', { name: 'hostKey.trust' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const socket = FakeWebSocket.instances[0]
    await act(async () => {
      socket.message({
        instance_id: 'core-a',
        snapshot_revision: 2,
        type: 'challenge_resolved',
        resolution: resolution(current.id),
      })
    })
    await act(async () => {
      socket.message({
        instance_id: 'core-a',
        snapshot_revision: 3,
        type: 'challenge_upsert',
        challenge: next,
      })
    })

    expect(await screen.findByText('SHA256:next')).toBeInTheDocument()
    expect(hostKeyChallenges).toHaveBeenCalledTimes(1)
  })
})
