import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it, vi } from 'vitest'
import { i18n } from '#shared/i18n'
import { SettingsGatewayContext, type SettingsGateway } from '#entities/settings'
import type { SettingsSnapshot } from '#common/contracts'
import { SettingsModuleStore } from '../../../../entities/settings/model/moduleState'
import { renderWithFeedback as render } from '../../../../test/renderWithFeedback'
import { WebSearchSettings } from './WebSearchSettings'

function setup(value = { mode: 'searxng', base_url: 'http://127.0.0.1:18088' }, test = vi.fn().mockRejectedValue(new Error('搜索服务未返回 JSON'))) {
  let snapshot: SettingsSnapshot = { id: 'web_search', schema_version: 1, revision: 3, value, state: { status: 'saved' } }
  const update = vi.fn(async (_id, request) => {
    snapshot = { ...snapshot, revision: snapshot.revision + 1, value: { ...snapshot.value, ...request.patch } }
    return snapshot
  })
  const store = new SettingsModuleStore({ read: async () => snapshot, update })
  store.merge(snapshot)
  const gateway: SettingsGateway = { getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe, testWebSearch: test }
  const view = render(<I18nextProvider i18n={i18n}><SettingsGatewayContext.Provider value={gateway}><WebSearchSettings /></SettingsGatewayContext.Provider></I18nextProvider>)
  return { store, update, test, view }
}

it('结束编辑后提交配置，仅显式测试连接，错误通过消息提示', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update, test } = setup()
  await waitFor(() => expect(screen.getByLabelText('SearXNG 地址')).toBeEnabled())
  expect(test).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('SearXNG 地址'), { target: { value: 'http://127.0.0.1:18089' } })
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  expect(update).not.toHaveBeenCalled()
  fireEvent.blur(screen.getByLabelText('SearXNG 地址'))
  await waitFor(() => expect(update).toHaveBeenCalledWith('web_search', { patch: { base_url: 'http://127.0.0.1:18089' }, expected_revision: 3 }, undefined))
  expect(test).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.getByRole('button', { name: '测试连接' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: '测试连接' }))
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('搜索服务未返回 JSON')
  expect(screen.getByRole('region', { name: '联网搜索' })).not.toContainElement(notice)
})

it('正常修改不显示保存状态，连接成功只出现在浮动消息中', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update } = setup(undefined, vi.fn().mockResolvedValue({ results: [] }))
  const panel = screen.getByRole('region', { name: '联网搜索' })
  const address = await screen.findByLabelText('SearXNG 地址')
  fireEvent.change(address, { target: { value: 'http://changed.test' } })
  fireEvent.blur(address)
  await waitFor(() => expect(update).toHaveBeenCalledOnce())
  const button = within(panel).getByRole('button', { name: '测试连接' })
  await waitFor(() => expect(button).toBeEnabled())
  expect(within(panel).queryByText(/自动保存|正在保存|已保存/u)).not.toBeInTheDocument()
  fireEvent.click(button)
  const notice = await screen.findByText('连接成功')
  expect(notice.closest('.ant-notification')).toBeInTheDocument()
  expect(panel).not.toContainElement(notice)
  expect(within(panel).queryByRole('alert')).not.toBeInTheDocument()
})

it('配置提交失败通过消息保留重试入口，重试后移除消息且不丢失修改', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update } = setup()
  update.mockRejectedValueOnce(new Error('连接中断，修改尚未应用'))
  const address = await screen.findByLabelText('SearXNG 地址')
  fireEvent.change(address, { target: { value: 'http://changed.test' } })
  fireEvent.blur(address)
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('连接中断，修改尚未应用')
  expect(screen.getByRole('region', { name: '联网搜索' })).not.toContainElement(notice)
  expect(address).toHaveValue('http://changed.test')
  fireEvent.click(within(notice).getByRole('button', { name: /重\s*试/u }))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(address).toHaveValue('http://changed.test')
})

it('选择自建服务但地址为空时保留草稿，补全地址后一并保存', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update, test } = setup({ mode: 'cloud', base_url: '' })
  fireEvent.click(await screen.findByRole('radio', { name: /自建 SearXNG/u }))
  expect(update).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  fireEvent.change(screen.getByLabelText('SearXNG 地址'), { target: { value: 'http://search.test' } })
  fireEvent.blur(screen.getByLabelText('SearXNG 地址'))
  await waitFor(() => expect(update).toHaveBeenCalledWith('web_search', { patch: { mode: 'searxng', base_url: 'http://search.test' }, expected_revision: 3 }, undefined))
  expect(test).not.toHaveBeenCalled()
})

it('清空自建地址后失焦只保留草稿，补全后才能提交和测试', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update, test } = setup()
  const address = await screen.findByLabelText('SearXNG 地址')
  await waitFor(() => expect(address).toBeEnabled())
  fireEvent.change(address, { target: { value: '' } })
  fireEvent.blur(address)
  await act(async () => {})
  expect(update).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: '测试连接' })).toBeDisabled()
  fireEvent.change(address, { target: { value: 'http://complete.test' } })
  fireEvent.blur(address)
  await waitFor(() => expect(update).toHaveBeenCalledOnce())
  expect(test).not.toHaveBeenCalled()
})

it('关闭页面补交未失焦的完整修改，未填写地址的配置不提交', async () => {
  await i18n.changeLanguage('zh-CN')
  const first = setup()
  fireEvent.change(await screen.findByLabelText('SearXNG 地址'), { target: { value: 'http://changed.test' } })
  first.view.unmount()
  await waitFor(() => expect(first.update).toHaveBeenCalledOnce())
  const incomplete = setup({ mode: 'cloud', base_url: '' })
  fireEvent.click(await screen.findByRole('radio', { name: /自建 SearXNG/u }))
  incomplete.view.unmount()
  expect(incomplete.update).not.toHaveBeenCalled()
})

it('读取失败时重试读取缓存配置，不误发保存请求', async () => {
  await i18n.changeLanguage('zh-CN')
  const snapshot: SettingsSnapshot = { id: 'web_search', schema_version: 1, revision: 1, value: { mode: 'cloud', base_url: '' }, state: { status: 'saved' } }
  const read = vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue(snapshot)
  const update = vi.fn()
  const gateway: SettingsGateway = { getModule: () => snapshot, readModule: read, updateModule: update, subscribeSettings: () => () => {} }
  render(<I18nextProvider i18n={i18n}><SettingsGatewayContext.Provider value={gateway}><WebSearchSettings /></SettingsGatewayContext.Provider></I18nextProvider>)
  expect(await screen.findByText('读取失败')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/u }))
  await waitFor(() => expect(screen.queryByText('读取失败')).not.toBeInTheDocument())
  expect(read).toHaveBeenCalledTimes(2)
  expect(update).not.toHaveBeenCalled()
})

it('外部配置变化和离开页面终止测试观察，不把旧连接结果显示到新配置', async () => {
  await i18n.changeLanguage('zh-CN')
  let reject!: (cause: unknown) => void
  const test = vi.fn((signal?: AbortSignal) => { signal?.throwIfAborted(); return new Promise<never>((_resolve, fail) => { reject = fail }) })
  const { store, view } = setup(undefined, test)
  const button = await screen.findByRole('button', { name: '测试连接' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  const signal = vi.mocked(test).mock.calls[0][0] as AbortSignal
  act(() => { store.merge({ ...store.snapshot('web_search')!, revision: 4, value: { mode: 'cloud', base_url: '' } }) })
  expect(signal.aborted).toBe(true)
  await act(async () => reject(new Error('旧连接错误')))
  expect(screen.queryByText('旧连接错误')).not.toBeInTheDocument()
  fireEvent.click(button)
  const nextSignal = vi.mocked(test).mock.calls[1][0] as AbortSignal
  view.unmount()
  expect(nextSignal.aborted).toBe(true)
  await act(async () => reject(new Error('已离开页面')))
})
