import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TermousApi } from '../api/client'
import { TransferRuntimeProvider } from '#app/transfer-runtime'
import {
  useTransferRuntime,
  type TransferRuntimeValue,
} from '#features/transfers'

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = []

  readonly url: string
  closeCalls = 0

  constructor(url: string | URL) {
    super()
    this.url = String(url)
    FakeWebSocket.instances.push(this)
  }

  open() {
    this.dispatchEvent(new Event('open'))
  }

  close() {
    this.closeCalls += 1
    this.dispatchEvent(new Event('close'))
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

describe('Transfer Runtime Provider', () => {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('同一 API 共享运行时，并按连接与快照顺序初始化，最后消费者释放后才关闭', async () => {
    const initialTransfers = deferred<[]>()
    const transfers = vi.fn(() => initialTransfers.promise)
    const api = {
      transfers,
      transferEventsUrl: () => 'ws://127.0.0.1/api/v1/transfers/events',
    } as unknown as TermousApi
    const latestValues = new Map<string, TransferRuntimeValue>()

    function Probe({ id }: { id: string }) {
      const runtime = useTransferRuntime()
      latestValues.set(id, runtime)
      return (
        <output data-testid={id}>
          {String(runtime.connected)}:{String(runtime.initialized)}
        </output>
      )
    }

    function Consumer({ id }: { id: string }) {
      return (
        <TransferRuntimeProvider api={api}>
          <Probe id={id} />
        </TransferRuntimeProvider>
      )
    }

    function Harness({ first, second }: { first: boolean; second: boolean }) {
      return (
        <>
          {first ? <Consumer id="first" /> : null}
          {second ? <Consumer id="second" /> : null}
        </>
      )
    }

    const view = render(<Harness first second />)

    expect(transfers).toHaveBeenCalledTimes(1)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(latestValues.get('first')).toBe(latestValues.get('second'))
    expect(screen.getByTestId('first')).toHaveTextContent('false:false')
    expect(screen.getByTestId('second')).toHaveTextContent('false:false')

    await act(async () => {
      FakeWebSocket.instances[0].open()
    })

    expect(transfers).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('first')).toHaveTextContent('true:false')
    expect(screen.getByTestId('second')).toHaveTextContent('true:false')

    await act(async () => {
      initialTransfers.resolve([])
      await initialTransfers.promise
    })

    expect(screen.getByTestId('first')).toHaveTextContent('true:true')
    expect(screen.getByTestId('second')).toHaveTextContent('true:true')
    expect(latestValues.get('first')).toBe(latestValues.get('second'))

    view.rerender(<Harness first={false} second />)
    expect(FakeWebSocket.instances[0].closeCalls).toBe(0)

    view.rerender(<Harness first={false} second={false} />)
    expect(FakeWebSocket.instances[0].closeCalls).toBe(0)

    await act(async () => {
      vi.advanceTimersByTime(0)
    })

    expect(FakeWebSocket.instances[0].closeCalls).toBe(1)
  })
})
