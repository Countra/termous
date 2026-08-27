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
      <output data-testid="pending">{[...reachability.pendingProfileIds].sort().join(',')}</output>
      <output data-testid="error">{reachability.error?.message ?? ''}</output>
      <button
        type="button"
        onClick={() => void reachability.refreshMany([
          'ssh-primary',
          'ssh-secondary',
          'ssh-secondary',
        ])}
      >
        refresh
      </button>
      <button type="button" onClick={() => void reachability.refreshMany([])}>refresh-empty</button>
    </div>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe('SSH Profile 可达性订阅', () => {
  afterEach(() => {
    FakeWebSocket.instances = []
    vi.unstubAllGlobals()
  })

  it('加载全量快照、接收增量事件并批量刷新去重后的 Profile', async () => {
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
      ['ssh-primary', 'ssh-secondary'],
      true,
    ))
    fireEvent.click(screen.getByRole('button', { name: 'refresh-empty' }))
    expect(gateway.refreshSSHProfileReachability).toHaveBeenCalledOnce()
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

  it('不允许迟到的 HTTP 失败覆盖更新的 WebSocket 状态', async () => {
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
        state: state('ssh-primary', 'online'),
      })
    })
    await act(async () => {
      pending.reject(new Error('stale snapshot failure'))
      await pending.promise.catch(() => undefined)
    })

    expect(screen.getByTestId('primary')).toHaveTextContent('online')
    expect(screen.getByTestId('error')).toBeEmptyDOMElement()
  })

  it('WebSocket 更新后忽略迟到的批量刷新失败并释放本地请求锁', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const pending = deferred<HostReachability[]>()
    const gateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockResolvedValue([]),
      refreshSSHProfileReachability: vi.fn().mockReturnValue(pending.promise),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability',
    }
    render(<Harness gateway={gateway} />)

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(screen.getByTestId('pending')).toHaveTextContent('ssh-primary,ssh-secondary')
    act(() => {
      FakeWebSocket.instances[0]?.receive({
        type: 'updated',
        state: state('ssh-primary', 'online'),
      })
    })
    await act(async () => {
      pending.reject(new Error('stale refresh failure'))
      await pending.promise.catch(() => undefined)
    })

    expect(screen.getByTestId('primary')).toHaveTextContent('online')
    expect(screen.getByTestId('pending')).toBeEmptyDOMElement()
    expect(screen.getByTestId('error')).toBeEmptyDOMElement()
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
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(gateway.refreshSSHProfileReachability).not.toHaveBeenCalled()
    expect(screen.getByTestId('pending')).toBeEmptyDOMElement()
  })

  it('批量刷新失败后释放请求锁，并在重试开始时清理旧错误', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const retry = deferred<HostReachability[]>()
    const gateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockResolvedValue([]),
      refreshSSHProfileReachability: vi.fn()
        .mockRejectedValueOnce(new Error('refresh failed'))
        .mockReturnValueOnce(retry.promise),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability',
    }
    render(<Harness gateway={gateway} />)

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('refresh failed'))
    expect(screen.getByTestId('pending')).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(screen.getByTestId('error')).toBeEmptyDOMElement()
    expect(screen.getByTestId('pending')).toHaveTextContent('ssh-primary,ssh-secondary')

    await act(async () => {
      retry.resolve([])
    })
    expect(screen.getByTestId('pending')).toBeEmptyDOMElement()
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

  it('数据网关切换时清除上一生命周期的批量检测状态', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const pending = deferred<HostReachability[]>()
    const firstGateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockResolvedValue([]),
      refreshSSHProfileReachability: vi.fn().mockReturnValue(pending.promise),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability-a',
    }
    const nextGateway: SSHProfileReachabilityGateway = {
      loadSSHProfileReachability: vi.fn().mockResolvedValue([]),
      refreshSSHProfileReachability: vi.fn().mockResolvedValue([]),
      sshProfileReachabilityEventsUrl: () => 'ws://termous.test/ssh-profiles/reachability-b',
    }
    const view = render(<Harness gateway={firstGateway} />)

    fireEvent.click(screen.getByRole('button', { name: 'refresh' }))
    expect(screen.getByTestId('pending')).toHaveTextContent('ssh-primary,ssh-secondary')
    view.rerender(<Harness gateway={nextGateway} />)
    await waitFor(() => expect(screen.getByTestId('pending')).toBeEmptyDOMElement())

    await act(async () => {
      pending.resolve([state('ssh-primary', 'online')])
    })
    expect(screen.getByTestId('primary')).toHaveTextContent('missing')
  })
})
