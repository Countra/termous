import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostReachability } from '#entities/host'
import type { SSHProfileReachabilityGateway } from './types.ts'
import { useSSHProfileReachability } from './useSSHProfileReachability.ts'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  onopen: (() => void) | null = null
  onmessage: ((event: MessageEvent<string>) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = false

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }

  close() {
    this.closed = true
    this.onclose?.()
  }

  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) } as MessageEvent<string>)
  }
}

function state(profileId: string, status: HostReachability['status']): HostReachability {
  return {
    host_id: 'host-a',
    ssh_profile_id: profileId,
    address: `${profileId}.example.com`,
    status,
    packet_loss: status === 'online' ? 0 : 1,
  }
}

function Harness({
  gateway,
  enabled = true,
}: {
  gateway: SSHProfileReachabilityGateway
  enabled?: boolean
}) {
  const reachability = useSSHProfileReachability(gateway, enabled)
  return (
    <div>
      <output data-testid="primary">{reachability.states['ssh-primary']?.status ?? 'missing'}</output>
      <output data-testid="secondary">{reachability.states['ssh-secondary']?.status ?? 'missing'}</output>
      <button type="button" onClick={() => void reachability.refresh('ssh-secondary')}>refresh</button>
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve })
  return { promise, resolve }
}

describe('SSH Profile 可达性订阅', () => {
  afterEach(() => {
    FakeWebSocket.instances = []
    vi.unstubAllGlobals()
  })

  it('加载全量快照、接收增量事件并精确刷新指定 Profile', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const gateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockResolvedValue([
        state('ssh-primary', 'online'),
        state('ssh-secondary', 'unknown'),
      ]),
      refreshSSHProfileReachability: vi.fn().mockResolvedValue([
        state('ssh-primary', 'online'),
        state('ssh-secondary', 'checking'),
      ]),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability',
    }
    render(<Harness gateway={gateway} />)

    await waitFor(() => expect(screen.getByTestId('primary')).toHaveTextContent('online'))
    expect(FakeWebSocket.instances[0]?.url).toBe('ws://termous.test/ssh-profiles/reachability')

    act(() => {
      FakeWebSocket.instances[0]?.receive({
        type: 'updated',
        state: state('ssh-secondary', 'offline'),
      })
    })
    expect(screen.getByTestId('primary')).toHaveTextContent('online')
    expect(screen.getByTestId('secondary')).toHaveTextContent('offline')

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(gateway.refreshSSHProfileReachability).toHaveBeenCalledWith(
      ['ssh-secondary'],
      true,
    ))
  })

  it('不允许迟到的 HTTP 快照覆盖更新的 WebSocket 事件', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const pending = deferred<HostReachability[]>()
    const gateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockReturnValue(pending.promise),
      refreshSSHProfileReachability: vi.fn(),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability',
    }
    render(<Harness gateway={gateway} />)

    act(() => {
      FakeWebSocket.instances[0]?.receive({
        type: 'updated',
        state: state('ssh-secondary', 'offline'),
      })
    })
    expect(screen.getByTestId('secondary')).toHaveTextContent('offline')

    await act(async () => {
      pending.resolve([state('ssh-secondary', 'online')])
    })
    expect(screen.getByTestId('secondary')).toHaveTextContent('offline')
  })

  it('目录不可见时不加载或维持可达性订阅', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const gateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockResolvedValue([]),
      refreshSSHProfileReachability: vi.fn(),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability',
    }

    render(<Harness gateway={gateway} enabled={false} />)

    expect(gateway.loadSSHProfileReachability).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0)
  })

  it('重新进入目录后拒绝上一生命周期的迟到刷新结果', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const pending = deferred<HostReachability[]>()
    const gateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockResolvedValue([]),
      refreshSSHProfileReachability: vi.fn().mockReturnValue(pending.promise),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability',
    }
    const view = render(<Harness gateway={gateway} />)

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(gateway.refreshSSHProfileReachability).toHaveBeenCalledTimes(1))
    view.rerender(<Harness gateway={gateway} enabled={false} />)
    expect(FakeWebSocket.instances[0]?.closed).toBe(true)
    view.rerender(<Harness gateway={gateway} />)

    await act(async () => {
      pending.resolve([state('ssh-secondary', 'online')])
    })
    expect(screen.getByTestId('secondary')).toHaveTextContent('missing')
  })
})
