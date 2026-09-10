import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import type { AgentResourceBinding, AgentSSHResourceState } from '#entities/agent'
import { AgentTerminalReferenceConfirmDialog } from './AgentTerminalReferenceConfirmDialog'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const binding: AgentResourceBinding = {
  kind: 'ssh_session', session_id: 'ssh-original-123456789012', host_id: 'host-original',
  host_name: '原生产主机', ssh_profile_id: 'profile-original-123456789012',
  platform: 'linux', bound_at: '2026-09-08T08:00:00Z',
}
const original: AgentSSHResourceState = {
  session_id: binding.session_id, host_id: binding.host_id, host_name: '后来重命名的主机',
  ssh_profile_id: binding.ssh_profile_id, ssh_profile_name: '原 SSH 配置',
  status: 'unavailable', started_at: '2026-09-08T07:00:00Z',
}
const source: AgentSSHResourceState = {
  session_id: 'ssh-destination-987654321098', host_id: 'host-destination', host_name: '新的生产主机',
  ssh_profile_id: 'profile-destination-987654321098', ssh_profile_name: '新 SSH 配置',
  status: 'ready', started_at: '2026-09-08T09:00:00Z',
}

function fixture(resources: AgentSSHResourceState[] = [original]) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<ConfigProvider theme={{ token: { motion: false } }}>
    <AgentTerminalReferenceConfirmDialog binding={binding} source={source} resources={resources}
      onConfirm={onConfirm} onCancel={onCancel} />
  </ConfigProvider>)
  return {
    onConfirm, onCancel,
    current: screen.getByRole('group', { name: /^agent.terminalReference.currentAssociation/ }),
    destination: screen.getByRole('group', { name: /^agent.terminalReference.nextAssociation/ }),
  }
}

describe('终端引用换绑确认', () => {
  it('原身份匹配时补充配置名，新关联保持捕获时的来源名称', () => {
    const f = fixture([original, { ...source, host_name: '来源的新名称', ssh_profile_name: '来源的新配置名' }])
    expect(screen.getByRole('dialog', { name: 'agent.terminalReference.confirmTitle' }))
      .toHaveTextContent('agent.terminalReference.confirmDescription')
    expect(f.current).toHaveTextContent(binding.host_name)
    expect(f.current).toHaveTextContent(original.ssh_profile_name)
    expect(f.current).not.toHaveTextContent(original.host_name)
    expect(f.destination).toHaveTextContent(source.host_name)
    expect(f.destination).toHaveTextContent(source.ssh_profile_name)
    expect(f.destination).not.toHaveTextContent('来源的新名称')
    expect(f.destination).not.toHaveTextContent('来源的新配置名')
    expect(f.onConfirm).not.toHaveBeenCalled()
  })

  it.each([
    { reason: '原资源缺失', resources: [] },
    { reason: '同会话 ID 更换主机', resources: [{ ...original, host_id: 'another-host' }] },
    { reason: '同会话 ID 更换配置', resources: [{ ...original, ssh_profile_id: 'another-profile' }] },
  ])('$reason时保留绑定主机，不混用当前资源的配置名称', ({ resources }) => {
    const f = fixture(resources)
    expect(f.current).toHaveTextContent(binding.host_name)
    expect(f.current).toHaveTextContent('agent.terminalReference.profileUnavailable')
    expect(f.current).not.toHaveTextContent(original.ssh_profile_name)
    expect(f.destination).toHaveTextContent(source.ssh_profile_name)
  })

  it('两侧只显示短会话标识，键盘聚焦能查看完整配置和会话标识且不会触发换绑', async () => {
    const user = userEvent.setup()
    const f = fixture([])
    const cancel = screen.getByRole('button', { name: 'app.cancel' })
    await waitFor(() => {
      expect(cancel).toBeVisible()
      expect(cancel).toHaveFocus()
    })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    expect(f.current.textContent).not.toContain(binding.session_id)
    expect(f.destination.textContent).not.toContain(source.session_id)
    expect(within(f.current).getByText(/#…/)).toBeVisible()
    expect(within(f.destination).getByText(/#…/)).toBeVisible()

    await user.tab({ shift: true })
    expect(f.destination).toHaveFocus()
    await waitFor(() => {
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent(source.session_id)
      expect(tooltip).toHaveTextContent(source.ssh_profile_id)
    })
    await user.tab({ shift: true })
    expect(f.current).toHaveFocus()
    await waitFor(() => {
      const tooltip = screen.getByRole('tooltip')
      expect(tooltip).toHaveTextContent(binding.session_id)
      expect(tooltip).toHaveTextContent(binding.ssh_profile_id)
      expect(tooltip).not.toHaveTextContent(original.ssh_profile_name)
    })
    await user.keyboard('{Enter}')
    expect(f.onConfirm).not.toHaveBeenCalled()
    expect(f.onCancel).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'confirm', 'escape'] as const)('%s只调用对应操作一次', async (action) => {
    const user = userEvent.setup()
    const f = fixture()
    const cancel = screen.getByRole('button', { name: 'app.cancel' })
    if (action === 'escape') {
      act(() => cancel.focus())
      await user.keyboard('{Escape}')
    } else {
      await user.click(action === 'cancel' ? cancel : screen.getByRole('button', {
        name: 'agent.terminalReference.confirmReplace',
      }))
    }
    expect(action === 'confirm' ? f.onConfirm : f.onCancel).toHaveBeenCalledOnce()
    expect(action === 'confirm' ? f.onCancel : f.onConfirm).not.toHaveBeenCalled()
  })
})
