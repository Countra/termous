import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type {
  TermousUpdateWindowBridge,
  UpdateSnapshot,
  UpdateWindowBootstrap,
} from '#common/contracts'

const testState = vi.hoisted(() => ({
  bridge: null as TermousUpdateWindowBridge | null,
}))

vi.mock('#shared/bridge', () => ({
  getTermousUpdateBridge: () => testState.bridge,
}))

vi.mock('#app/update-simulation-slot', () => ({
  readDevelopmentUpdateSimulation: () => null,
}))

vi.mock('#app/ui-runtime', () => ({
  TermousUiProvider: ({ children }: { children: ReactNode }) => children,
}))

import UpdateWindowRoot from '#app/update-surface'

function snapshot(): UpdateSnapshot {
  return {
    state_seq: 4,
    operation_generation: 1,
    phase: 'available',
    current_version: '1.0.0',
    available_version: '1.1.0',
    release_name: 'Termous 1.1.0',
    release_date: '2026-08-01T00:00:00Z',
    release_notes: '## 1.1.0\n\n- 更新内容',
    progress: null,
    checked_at: '2026-08-01T00:00:00Z',
    error_code: null,
    error_message: null,
    retryable: false,
    support_reason: null,
    preferences: {
      automatic_check: true,
      check_interval: 'daily',
      automatic_download: false,
      last_checked_at: '2026-08-01T00:00:00Z',
      revision: 2,
    },
    next_automatic_check_at: null,
  }
}

function updateBridge() {
  const current = snapshot()
  const bootstrap: UpdateWindowBootstrap<UpdateSnapshot> = {
    bootstrap_seq: 2,
    language: 'zh-CN',
    snapshot: current,
    theme: 'dark',
  }
  const removeBootstrapListener = vi.fn()
  const removeStateListener = vi.fn()
  const removeSummaryListener = vi.fn()
  const bridge: TermousUpdateWindowBridge = {
    cancelDownload: async () => current,
    check: async () => current,
    close: async () => true,
    download: async () => current,
    getApplicationInfo: async () => ({
      product_name: 'Termous',
      version: '1.0.0',
      platform: 'win32',
      arch: 'x64',
      packaged: true,
    }),
    getBootstrap: async () => bootstrap,
    getState: async () => current,
    install: async () => current,
    minimize: async () => true,
    onInstallSummaryChanged: () => removeSummaryListener,
    onBootstrapChanged: () => removeBootstrapListener,
    prepareInstall: async () => {
      throw new Error('当前状态不需要安装确认')
    },
    subscribe: () => removeStateListener,
  }
  return {
    bridge,
    removeBootstrapListener,
    removeStateListener,
    removeSummaryListener,
  }
}

describe('独立更新 Surface 合同', () => {
  it('应用 bootstrap 后展示更新状态，并在卸载时释放全部 Bridge 监听', async () => {
    const subject = updateBridge()
    testState.bridge = subject.bridge
    const view = render(<UpdateWindowRoot />)

    expect(await screen.findByRole('heading', { name: '有可用更新' })).toBeVisible()
    await waitFor(() => {
      expect(document.querySelector('[data-update-phase="available"]')).not.toBeNull()
    })

    view.unmount()
    expect(subject.removeBootstrapListener).toHaveBeenCalledTimes(1)
    expect(subject.removeStateListener).toHaveBeenCalledTimes(1)
    expect(subject.removeSummaryListener).toHaveBeenCalledTimes(1)
    testState.bridge = null
  })
})
