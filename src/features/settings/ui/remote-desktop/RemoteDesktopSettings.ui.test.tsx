import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { defaultConnectionSettings } from '#entities/settings'
import { RemoteDesktopSettings } from './RemoteDesktopSettings'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

test('RDP 保留时间允许编辑后按回车保存，只提交变动字段', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn(async () => undefined)
  render(<RemoteDesktopSettings value={defaultConnectionSettings} disabled={false} onChange={onChange} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.rdpUnattendedTimeout' })
  expect(input).toHaveValue('10')
  await user.clear(input)
  expect(onChange).not.toHaveBeenCalled()
  await user.type(input, '30{Enter}')
  await waitFor(() => expect(onChange).toHaveBeenCalledExactlyOnceWith({ rdp_unattended_timeout_minutes: 30 }))
})

test.each(['', '0', '31', '1.5'])('RDP 保留时间拒绝非法输入：%s', async (text) => {
  const user = userEvent.setup()
  const onChange = vi.fn(async () => undefined)
  render(<RemoteDesktopSettings value={defaultConnectionSettings} disabled={false} onChange={onChange} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.rdpUnattendedTimeout' })
  await user.clear(input)
  if (text) await user.type(input, text)
  await user.tab()
  expect(onChange).not.toHaveBeenCalled()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByText('settings.rdpUnattendedInvalid')).toBeVisible()
})

test('保存失败保留草稿并允许重试，外部更新同步确认值', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn().mockRejectedValueOnce(new Error('fixture')).mockResolvedValue(undefined)
  const { rerender } = render(<RemoteDesktopSettings value={defaultConnectionSettings} disabled={false} onChange={onChange} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.rdpUnattendedTimeout' })
  await user.clear(input)
  await user.type(input, '1{Enter}')
  expect(await screen.findByText('settings.rdpUnattendedSaveFailed')).toBeVisible()
  expect(input).toHaveValue('1')
  await user.click(input)
  await user.keyboard('{Enter}')
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2))
  rerender(<RemoteDesktopSettings value={{ ...defaultConnectionSettings, rdp_unattended_timeout_minutes: 20 }} disabled onChange={onChange} />)
  expect(input).toHaveValue('20')
  expect(input).toBeDisabled()
})

test('并发保存冲突刷新确认值时保留当前草稿', async () => {
  const user = userEvent.setup()
  let rejectSave!: (error: Error) => void
  const onChange = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject }))
  const { rerender } = render(<RemoteDesktopSettings value={defaultConnectionSettings} disabled={false} onChange={onChange} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.rdpUnattendedTimeout' })
  await user.clear(input)
  await user.type(input, '30{Enter}')
  rerender(<RemoteDesktopSettings value={{ ...defaultConnectionSettings, rdp_unattended_timeout_minutes: 20 }} disabled={false} onChange={onChange} />)
  await act(async () => { rejectSave(new Error('SETTINGS_REVISION_CONFLICT')) })
  expect(input).toHaveValue('30')
  expect(screen.getByText('settings.rdpUnattendedSaveFailed')).toBeVisible()
  expect(input).not.toBeDisabled()
})

test('冲突刷新和失败响应被 React 合并时仍保留草稿', async () => {
  const user = userEvent.setup()
  let rejectSave!: (error: Error) => void
  const onChange = vi.fn(() => new Promise<void>((_, reject) => { rejectSave = reject }))
  const { rerender } = render(<RemoteDesktopSettings value={defaultConnectionSettings} disabled={false} onChange={onChange} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.rdpUnattendedTimeout' })
  await user.clear(input)
  await user.type(input, '30{Enter}')
  await act(async () => {
    rerender(<RemoteDesktopSettings value={{ ...defaultConnectionSettings, rdp_unattended_timeout_minutes: 20 }} disabled={false} onChange={onChange} />)
    rejectSave(new Error('SETTINGS_REVISION_CONFLICT'))
  })
  expect(input).toHaveValue('30')
  expect(screen.getByText('settings.rdpUnattendedSaveFailed')).toBeVisible()
})

test('外部更新不覆盖尚未提交的编辑', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn(async () => undefined)
  const { rerender } = render(<RemoteDesktopSettings value={defaultConnectionSettings} disabled={false} onChange={onChange} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.rdpUnattendedTimeout' })
  await user.clear(input)
  await user.type(input, '15')
  rerender(<RemoteDesktopSettings value={{ ...defaultConnectionSettings, rdp_unattended_timeout_minutes: 20 }} disabled={false} onChange={onChange} />)
  expect(input).toHaveValue('15')
  await user.keyboard('{Enter}')
  expect(onChange).toHaveBeenCalledExactlyOnceWith({ rdp_unattended_timeout_minutes: 15 })
})

test('外部确认值已与草稿一致时结束编辑，继续接收后续更新', async () => {
  const user = userEvent.setup()
  const onChange = vi.fn(async () => undefined)
  const { rerender } = render(<RemoteDesktopSettings value={defaultConnectionSettings} disabled={false} onChange={onChange} />)
  const input = screen.getByRole('spinbutton', { name: 'settings.rdpUnattendedTimeout' })
  await user.clear(input)
  await user.type(input, '15')
  rerender(<RemoteDesktopSettings value={{ ...defaultConnectionSettings, rdp_unattended_timeout_minutes: 15 }} disabled={false} onChange={onChange} />)
  await user.tab()
  expect(onChange).not.toHaveBeenCalled()
  rerender(<RemoteDesktopSettings value={{ ...defaultConnectionSettings, rdp_unattended_timeout_minutes: 20 }} disabled={false} onChange={onChange} />)
  expect(input).toHaveValue('20')
})
