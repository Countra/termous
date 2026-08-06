import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateSnapshot } from '#common/contracts'
import { UpdateRuntimeProvider } from '#app/update-runtime'
import {
  useUpdateRuntime,
  type UpdateRuntimeBridge,
} from '#features/update'

const notification = vi.hoisted(() => ({
  info: vi.fn(),
  success: vi.fn(),
}))

vi.mock('antd', () => ({
  App: {
    useApp: () => ({ notification }),
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { resolvedLanguage: 'zh-CN' },
    t: (key: string) => key,
  }),
}))

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function snapshot(currentVersion: string, stateSequence: number): UpdateSnapshot {
  return {
    state_seq: stateSequence,
    operation_generation: 1,
    phase: 'idle',
    current_version: currentVersion,
    available_version: null,
    release_name: null,
    release_date: null,
    release_notes: null,
    progress: null,
    checked_at: null,
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: null,
      revision: stateSequence,
    },
    next_automatic_check_at: null,
  }
}

function bridge(
  getState: UpdateRuntimeBridge['getState'],
  unsubscribe: () => void,
): UpdateRuntimeBridge {
  return {
    getState,
    subscribe: () => unsubscribe,
    setPreferences: async () => snapshot('preferences', 1).preferences,
    openWindow: async () => true,
  }
}

function RuntimeProbe() {
  const runtime = useUpdateRuntime()
  return (
    <output data-testid="runtime-state">
      {runtime.runtimeGeneration}:{runtime.snapshot?.current_version ?? 'none'}:{String(runtime.initializationFailed)}
    </output>
  )
}

describe('更新运行时 Provider 合同', () => {
  it('切换 Bridge 后丢弃旧代际迟到快照并释放对应订阅', async () => {
    const firstState = deferred<UpdateSnapshot>()
    const firstUnsubscribe = vi.fn()
    const secondUnsubscribe = vi.fn()
    const firstBridge = bridge(vi.fn(() => firstState.promise), firstUnsubscribe)
    const secondBridge = bridge(
      vi.fn(async () => snapshot('second', 2)),
      secondUnsubscribe,
    )

    const tree = (runtimeBridge: UpdateRuntimeBridge) => (
      <UpdateRuntimeProvider bridge={runtimeBridge} notificationStorage={null}>
        <RuntimeProbe />
      </UpdateRuntimeProvider>
    )
    const view = render(tree(firstBridge))

    await waitFor(() => {
      expect(firstBridge.getState).toHaveBeenCalledTimes(1)
    })
    view.rerender(tree(secondBridge))

    await waitFor(() => {
      expect(screen.getByTestId('runtime-state')).toHaveTextContent('1:second:false')
    })
    expect(firstUnsubscribe).toHaveBeenCalledTimes(1)

    await act(async () => {
      firstState.resolve(snapshot('stale', 99))
      await firstState.promise
    })

    expect(screen.getByTestId('runtime-state')).toHaveTextContent('1:second:false')
    view.unmount()
    expect(secondUnsubscribe).toHaveBeenCalledTimes(1)
  })
})
