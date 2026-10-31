import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it, vi } from 'vitest'
import { i18n } from '#shared/i18n'
import { SettingsGatewayContext, type SettingsGateway } from '#entities/settings'
import type { SettingsSnapshot } from '#common/contracts'
import { WebSearchSettings } from './WebSearchSettings'

it('保存不联网，测试只针对已保存配置且保留服务错误', async () => {
  await i18n.changeLanguage('zh-CN')
  const snapshot: SettingsSnapshot = { id: 'web_search', schema_version: 1, revision: 3, value: { mode: 'searxng', base_url: 'http://127.0.0.1:18088' }, state: { status: 'saved' } }
  const test = vi.fn().mockRejectedValue(new Error('搜索服务未返回 JSON'))
  const update = vi.fn().mockResolvedValue(snapshot)
  const gateway: SettingsGateway = { getModule: () => snapshot, readModule: async () => snapshot, updateModule: update, subscribeSettings: () => () => {}, testWebSearch: test }
  render(<I18nextProvider i18n={i18n}><SettingsGatewayContext.Provider value={gateway}><WebSearchSettings /></SettingsGatewayContext.Provider></I18nextProvider>)
  await waitFor(() => expect(screen.getByLabelText('SearXNG 地址')).toBeEnabled())
  expect(test).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('SearXNG 地址'), { target: { value: 'http://127.0.0.1:18089' } })
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  const save = screen.getByRole('button', { name: /保\s*存/u })
  await waitFor(() => expect(save).toBeEnabled())
  fireEvent.click(save)
  await waitFor(() => expect(update).toHaveBeenCalledWith('web_search', { mode: 'searxng', base_url: 'http://127.0.0.1:18089' }, expect.objectContaining({ expectedRevision: 3 })))
  expect(test).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
  expect(await screen.findByText('搜索服务未返回 JSON')).toBeVisible()
})
