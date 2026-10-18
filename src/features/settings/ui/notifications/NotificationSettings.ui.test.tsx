import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsTransport } from '#entities/settings'
import { NotificationSettings } from './NotificationSettings'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture(overrides: Partial<SettingsSnapshot> = {}) {
  let current: SettingsSnapshot = {
    id: 'notifications', schema_version: 1, revision: 1,
    value: { enabled: true, agent: true, file: false, approval: true, cloud: false },
    state: { status: 'applied', supported: true }, ...overrides,
  }
  const read = vi.fn<SettingsTransport['read']>(async () => current)
  const update = vi.fn<SettingsTransport['update']>(async (_id, input) => {
    current = { ...current, revision: current.revision + 1, value: { ...current.value, ...input.patch } }
    return current
  })
  const store = new SettingsModuleStore({ read, update })
  const gateway = {
    getModule: store.snapshot.bind(store), readModule: store.read.bind(store),
    updateModule: store.update.bind(store), subscribeSettings: store.subscribe,
  }
  return { read, update, gateway, snapshot: current }
}

test('总开关管理通知类型，暂停和重新开启保留各类型选择，只提交本次修改', async () => {
  const user = userEvent.setup()
  const setup = fixture({ value: { enabled: false, agent: true, file: false, approval: true, cloud: false } })
  render(<SettingsGatewayContext.Provider value={setup.gateway}><NotificationSettings /></SettingsGatewayContext.Provider>)
  const master = screen.getByRole('switch', { name: 'notifications.settings.enabled' })
  const agent = screen.getByRole('switch', { name: 'notifications.sources.agent' })
  const file = screen.getByRole('switch', { name: 'notifications.sources.file' })
  await waitFor(() => expect(master).toBeEnabled())
  expect(master).not.toBeChecked()
  expect(screen.getByRole('group', { name: 'notifications.settings.categories' })).toBeDisabled()
  expect(agent).toBeChecked()
  expect(agent).toBeDisabled()
  expect(file).not.toBeChecked()
  expect(screen.getByText('notifications.settings.paused')).toBeInTheDocument()
  expect(setup.update).not.toHaveBeenCalled()

  await user.click(master)
  await waitFor(() => expect(file).toBeEnabled())
  expect(setup.update).toHaveBeenLastCalledWith('notifications', { expected_revision: 1, patch: { enabled: true } }, expect.anything())
  expect(agent).toBeChecked()
  await user.click(screen.getByText('notifications.sources.file'))
  await waitFor(() => expect(file).toBeChecked())
  expect(setup.update).toHaveBeenLastCalledWith('notifications', { expected_revision: 2, patch: { file: true } }, expect.anything())
  await user.click(master)
  await waitFor(() => expect(master).not.toBeChecked())
  expect(file).toBeChecked()
  expect(file).toBeDisabled()
  expect(agent).toBeChecked()
  expect(setup.update).toHaveBeenCalledTimes(3)
})

test('提交仅在当前开关显示加载，失败保留确认值，重试只重新读取', async () => {
  const user = userEvent.setup()
  const setup = fixture()
  let reject!: (error: Error) => void
  setup.update.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  render(<SettingsGatewayContext.Provider value={setup.gateway}><NotificationSettings /></SettingsGatewayContext.Provider>)
  const agent = screen.getByRole('switch', { name: 'notifications.sources.agent' })
  const master = screen.getByRole('switch', { name: 'notifications.settings.enabled' })
  await waitFor(() => expect(agent).toBeEnabled())
  await user.click(agent)
  expect(agent).toHaveClass('ant-switch-loading')
  expect(screen.getByRole('switch', { name: 'notifications.sources.file' })).not.toHaveClass('ant-switch-loading')
  expect(master).not.toHaveClass('ant-switch-loading')
  for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
  await act(async () => reject(new Error('模拟写入失败')))
  expect(await screen.findByRole('alert')).toHaveTextContent('notifications.settings.error')
  expect(agent).toBeChecked()
  await user.click(screen.getByRole('button', { name: 'app.retry' }))
  await waitFor(() => expect(agent).toBeEnabled())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(setup.read).toHaveBeenCalledTimes(2)
  expect(setup.update).toHaveBeenCalledTimes(1)
})

test('首次读取期间显示加载提示，不误报桌面版不可用', async () => {
  const setup = fixture()
  let resolve!: (snapshot: SettingsSnapshot) => void
  setup.read.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  render(<SettingsGatewayContext.Provider value={setup.gateway}><NotificationSettings /></SettingsGatewayContext.Provider>)
  expect(await screen.findByText('notifications.settings.loading')).toBeInTheDocument()
  expect(screen.queryByText('notifications.settings.desktopOnly')).not.toBeInTheDocument()
  for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
  await act(async () => resolve(setup.snapshot))
  await waitFor(() => expect(screen.getByRole('switch', { name: 'notifications.settings.enabled' })).toBeEnabled())
  expect(screen.queryByText('notifications.settings.loading')).not.toBeInTheDocument()
})

test.each([
  [{ status: 'unavailable', reason: 'desktop_only' }, 'desktopOnly'],
  [{ status: 'applied', supported: false }, 'unsupported'],
  [{ status: 'unavailable', supported: true }, 'unavailable'],
] as const)('不可用状态 %s 禁止写入，并准确解释原因', async (state, reason) => {
  const setup = fixture({ state })
  render(<SettingsGatewayContext.Provider value={setup.gateway}><NotificationSettings /></SettingsGatewayContext.Provider>)
  expect(await screen.findByText(`notifications.settings.${reason}`)).toBeInTheDocument()
  for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
  expect(setup.update).not.toHaveBeenCalled()
  expect(screen.getByText('notifications.settings.centreHint')).toBeInTheDocument()
})
