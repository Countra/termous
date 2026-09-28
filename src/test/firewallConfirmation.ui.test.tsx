import { ConfigProvider } from 'antd'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { TermousUiProvider } from '#app/ui-runtime'
import { FirewallPanel } from '#features/firewall'
import type { FirewallApplyResult, FirewallCapability, FirewallSnapshot } from '#entities/firewall'
import type { FirewallGateway } from '../features/firewall/model/contracts'

const capability: FirewallCapability = {
  provider: 'nftables', status: 'ready', privilege: 'root', supports_apply: true,
  supports_save: false, supports_counters: false, detected_providers: [],
}
const snapshot: FirewallSnapshot = {
  capability, snapshot_version: 'revision-a', synced_at: '2026-09-22T10:00:00Z',
  rules: [{
    id: 'rule-a', provider: 'nftables', direction: 'inbound', family: 'ipv4', action: 'drop',
    protocol: 'tcp', ports: [{ from: 22, to: 22 }], source: '0.0.0.0/0',
    enabled: false, managed: true, editable: true,
  }],
}

function createApi(): FirewallGateway {
  return {
    sessionFirewallProviders: vi.fn().mockResolvedValue({
      default_provider: 'nftables', privilege: 'root',
      providers: [{ ...capability, present: true, recommended: true }],
    }),
    sessionFirewallCapability: vi.fn().mockResolvedValue(capability),
    sessionFirewallSnapshot: vi.fn().mockResolvedValue(snapshot),
    sessionFirewallPersistenceStatus: vi.fn().mockResolvedValue(null),
    applySessionFirewall: vi.fn(),
    previewSessionFirewall: vi.fn(),
    saveSessionFirewall: vi.fn(),
    sessionFirewallPersistenceInstallPlan: vi.fn(),
    installSessionFirewallPersistence: vi.fn(),
    saveSessionFirewallPersistence: vi.fn(),
  }
}

function Panel({ api, enabled = true, sessionId = 'session-a' }: {
  api: FirewallGateway
  enabled?: boolean
  sessionId?: string
}) {
  return <ConfigProvider theme={{ token: { motion: false } }}>
    <TermousUiProvider theme="dark" language="zh-CN">
      <FirewallPanel api={api} session={{ id: sessionId, kind: 'ssh', status: 'connected' }}
        host={{ platform: 'linux' }} enabled={enabled} />
    </TermousUiProvider>
  </ConfigProvider>
}

test('风险确认使用应用上下文，取消不提交规则，确认期间等待真实请求完成', async () => {
  const api = createApi()
  const user = userEvent.setup()
  let finish!: (result: FirewallApplyResult) => void
  vi.mocked(api.applySessionFirewall).mockReturnValue(new Promise((resolve) => { finish = resolve }))
  render(<Panel api={api} />)
  await user.click(await screen.findByRole('switch'))
  let dialog = await screen.findByRole('dialog')
  expect(api.applySessionFirewall).not.toHaveBeenCalled()
  await user.click(within(dialog).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.applySessionFirewall).not.toHaveBeenCalled()

  await user.click(screen.getByRole('switch'))
  dialog = await screen.findByRole('dialog')
  const confirm = within(dialog).getByRole('button', { name: '确认' })
  await user.click(confirm)
  expect(confirm).toHaveClass('ant-btn-loading')
  expect(api.applySessionFirewall).toHaveBeenCalledWith('session-a', expect.objectContaining({
    snapshot_version: 'revision-a', confirm_risk: true,
    rules: [expect.objectContaining({ id: 'rule-a', enabled: true })],
  }), 'nftables', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  await user.click(confirm)
  expect(api.applySessionFirewall).toHaveBeenCalledTimes(1)
  await act(async () => finish({
    applied: true,
    snapshot: { ...snapshot, rules: [{ ...snapshot.rules[0], enabled: true }] },
    plan: { provider: 'nftables', snapshot_version: 'revision-a', changes: [], allowed: true },
  }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(screen.getByRole('switch')).toBeChecked()
})

test.each(['deactivate', 'change-session', 'unmount'] as const)('风险确认在 %s 后销毁，不残留可执行的旧操作', async (change) => {
  const api = createApi()
  const user = userEvent.setup()
  const view = render(<Panel api={api} />)
  await user.click(await screen.findByRole('switch'))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  if (change === 'unmount') {
    view.unmount()
  } else {
    view.rerender(<Panel api={api} enabled={change !== 'deactivate'} sessionId={change === 'change-session' ? 'session-b' : 'session-a'} />)
  }
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.applySessionFirewall).not.toHaveBeenCalled()
})
