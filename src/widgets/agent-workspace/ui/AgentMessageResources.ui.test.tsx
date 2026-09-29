import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AgentMessageResources } from './AgentMessageResources.tsx'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe('消息资源名称边界', () => {
  it.each([
    ['TX-HK', 'TX-HK'],
    ['1234567890123456', '1234567890123456'],
    ['1234567890123456额外文字', '1234567890123456…'],
    ['123456789012345🚀额外文字', '123456789012345🚀…'],
  ])('名称 %s 最多展示 16 个字符，保留完整无障碍名称', (name, displayed) => {
    render(<AgentMessageResources resources={[{ kind: 'ssh_session', id: 'ses-one', name }]} />)
    const chip = screen.getByLabelText(`agent.message.resourceKind.ssh_session · ${name}`)
    expect(within(chip).getByText(displayed, { exact: true })).toBeVisible()
    expect(chip).toHaveAttribute('tabindex', '0')
  })

  it.each(['ssh_session', 'ssh_profile', 'file_profile'] as const)('%s 的截断名称悬停后显示完整名称和来源', async (kind) => {
    const name = '1234567890123456很长的资源全称'
    render(<AgentMessageResources resources={[{ kind, id: 'resource-one', name, host_name: '来源主机' }]} />)
    const chip = screen.getByLabelText(`agent.message.resourceKind.${kind} · ${name}`)
    expect(within(chip).queryByText(name, { exact: true })).not.toBeInTheDocument()
    fireEvent.mouseEnter(chip)
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent(name)
    expect(tooltip).toHaveTextContent('来源主机')
    expect(tooltip).toHaveTextContent('resource-one')
  })
})
