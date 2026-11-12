import { fireEvent, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it, vi } from 'vitest'
import type { SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway, type SettingsTransport } from '#entities/settings'
import { i18n } from '#shared/i18n'
import { renderWithFeedback as render } from '../../../../test/renderWithFeedback'
import { RemoteConnectionSettings } from './RemoteConnectionSettings'

it('仅提交本机连接偏好，保存失败明确反馈且不自动重发', async () => {
  await i18n.changeLanguage('zh-CN')
  let snapshot: SettingsSnapshot = { id: 'remote_connection', schema_version: 1, revision: 3, value: { transport_policy: 'auto' }, state: { status: 'saved' } }
  const update = vi.fn<SettingsTransport['update']>(async (_id, request) => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, ...request.patch } }
    return snapshot
  })
  const store = new SettingsModuleStore({ read: async () => snapshot, update })
  store.merge(snapshot)
  const gateway: SettingsGateway = {
    getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe,
  }
  render(<I18nextProvider i18n={i18n}><SettingsGatewayContext.Provider value={gateway}><RemoteConnectionSettings /></SettingsGatewayContext.Provider></I18nextProvider>)
  expect(screen.getByText('应用于本机发起的新连接。')).toBeInTheDocument()
  expect(update).not.toHaveBeenCalled()
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '连接方式' }))
  fireEvent.click(await screen.findByText('仅中继', { selector: '.ant-select-item-option-content' }))
  await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('remote_connection', { expected_revision: 3, patch: { transport_policy: 'relay' } }, undefined))
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled())
  update.mockRejectedValueOnce(new Error('连接方式保存失败'))
  fireEvent.mouseDown(screen.getByRole('combobox'))
  fireEvent.click(await screen.findByText('自动（优先直连）', { selector: '.ant-select-item-option-content' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('连接方式保存失败')
  expect(store.snapshot('remote_connection')?.value.transport_policy).toBe('relay')
  expect(update).toHaveBeenCalledTimes(2)
})
