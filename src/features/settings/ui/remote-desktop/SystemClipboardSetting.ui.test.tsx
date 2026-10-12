import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway, type SettingsTransport } from '#entities/settings'
import { SystemClipboardSetting } from './SystemClipboardSetting'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture(enabled = false, unavailable = false) {
  let saved: SettingsSnapshot = { id: 'desktop_clipboard', schema_version: 1, revision: 1, value: { enabled }, state: { status: unavailable ? 'unavailable' : 'applied' } }
  const update = vi.fn<SettingsTransport['update']>(async (_id, input) => { saved = { ...saved, revision: saved.revision + 1, value: input.patch }; return saved })
  const store = new SettingsModuleStore({ read: async () => saved, update })
  const gateway: SettingsGateway = {
    getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe,
  }
  const view = render(<SettingsGatewayContext value={gateway}><SystemClipboardSetting disabled={false} /></SettingsGatewayContext>)
  return { view, update, store, gateway }
}

test('读取持久开关，保存期间禁止重复操作，重新挂载保持已确认值', async () => {
  const f = fixture(true)
  const toggle = screen.getByRole('switch', { name: 'settings.systemFileClipboard' })
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(toggle).toBeChecked()
  let finish!: () => void
  const save = f.update.getMockImplementation()!
  f.update.mockImplementationOnce(async (id, input) => { await new Promise<void>(resolve => { finish = resolve }); return save(id, input) })
  fireEvent.click(toggle)
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(1))
  expect(toggle).toBeDisabled()
  expect(toggle).toBeChecked()
  await act(async () => finish())
  await waitFor(() => expect(toggle).not.toBeChecked())
  expect(f.update.mock.calls[0]).toEqual(['desktop_clipboard', { expected_revision: 1, patch: { enabled: false } }, expect.anything()])
  f.view.unmount()
  render(<SettingsGatewayContext value={f.gateway}><SystemClipboardSetting disabled={false} /></SettingsGatewayContext>)
  await waitFor(() => expect(screen.getByRole('switch')).toBeEnabled())
  expect(screen.getByRole('switch')).not.toBeChecked()
})

test('保存失败保留原值并就地提示，外部设置变更更新开关', async () => {
  const f = fixture()
  const toggle = screen.getByRole('switch')
  await waitFor(() => expect(toggle).toBeEnabled())
  f.update.mockRejectedValueOnce(new Error('保存失败'))
  fireEvent.click(toggle)
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.systemFileClipboardFailed')
  expect(toggle).not.toBeChecked()
  act(() => f.store.merge({ ...f.store.snapshot('desktop_clipboard')!, revision: 3, value: { enabled: true } }))
  expect(toggle).toBeChecked()
})

test('平台不可用时不允许启用，不影响同页其他设置', async () => {
  const f = fixture(false, true)
  expect(await screen.findByText('settings.systemFileClipboardUnavailable')).toBeVisible()
  expect(screen.getByRole('switch')).toBeDisabled()
  expect(f.update).not.toHaveBeenCalled()
})
