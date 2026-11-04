import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { expect, it, vi } from 'vitest'
import type { LocalNetworkSettings as Value, SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway, type SettingsTransport } from '#entities/settings'
import { i18n } from '#shared/i18n'
import { renderWithFeedback as render } from '../../../../test/renderWithFeedback'
import { LocalNetworkSettings } from './LocalNetworkSettings'

function setup(value: Value = { enabled: false, url: '', bypass: ['localhost', '127.0.0.1', '::1'] }) {
  let snapshot: SettingsSnapshot = { id: 'local_network', schema_version: 1, revision: 3, value: { ...value }, state: { status: 'saved' } }
  const update = vi.fn<SettingsTransport['update']>(async (_id, request) => {
    const current = store.snapshot('local_network') ?? snapshot
    snapshot = { ...current, revision: current.revision + 1, value: { ...current.value, ...request.patch } }
    return snapshot
  })
  const store = new SettingsModuleStore({ read: async () => snapshot, update })
  store.merge(snapshot)
  const gateway: SettingsGateway = {
    getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe,
  }
  const content = <I18nextProvider i18n={i18n}><SettingsGatewayContext.Provider value={gateway}><LocalNetworkSettings /></SettingsGatewayContext.Provider></I18nextProvider>
  const view = render(content)
  return { update, store, view, content }
}

it('未填写地址时引导输入，结束编辑与切换开关分别提交变化字段', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update, view } = setup()
  const address = screen.getByLabelText('代理地址')
  const toggle = screen.getByRole('switch', { name: '启用代理' })
  expect(address).toBeEnabled()
  expect(toggle).not.toBeChecked()
  expect(screen.queryByRole('button', { name: /保存|刷新/u })).not.toBeInTheDocument()
  expect(update).not.toHaveBeenCalled()
  fireEvent.click(toggle)
  expect(toggle).not.toBeChecked()
  expect(address).toHaveFocus()
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('请先填写代理地址。')
  expect(view.container).not.toContainElement(notice)
  fireEvent.change(address, { target: { value: ' http://127.0.0.1:7890 ' } })
  expect(update).not.toHaveBeenCalled()
  fireEvent.blur(address)
  await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('local_network', {
    expected_revision: 3, patch: { url: 'http://127.0.0.1:7890' },
  }, undefined))
  await waitFor(() => expect(toggle).toBeEnabled())
  fireEvent.click(toggle)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update.mock.calls[1][1]).toEqual({ expected_revision: 4, patch: { enabled: true } })
  expect(toggle).toBeChecked()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('直连清单保留输入换行，只在内容变化后提交，外部刷新同步显示', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update, store } = setup()
  const bypass = screen.getByLabelText('直连规则')
  fireEvent.change(bypass, { target: { value: 'localhost\n127.0.0.1\n::1\n' } })
  expect(bypass).toHaveValue('localhost\n127.0.0.1\n::1\n')
  fireEvent.blur(bypass)
  await act(async () => {})
  expect(update).not.toHaveBeenCalled()
  fireEvent.change(bypass, { target: { value: 'localhost\n .example.com \nexample.test:8080\n' } })
  fireEvent.blur(bypass)
  await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('local_network', {
    expected_revision: 3, patch: { bypass: ['localhost', '.example.com', 'example.test:8080'] },
  }, undefined))
  act(() => { store.merge({ ...store.snapshot('local_network')!, revision: 5, value: { enabled: false, url: '', bypass: ['external.test'] } }) })
  expect(bypass).toHaveValue('external.test')
})

it('在途提交不会覆盖直连清单的未完成输入，后续失焦沿用新修订号', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update } = setup()
  let finish!: (snapshot: SettingsSnapshot) => void
  update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const address = screen.getByLabelText('代理地址')
  const bypass = screen.getByLabelText('直连规则')
  fireEvent.change(address, { target: { value: 'http://proxy.test:8080' } })
  fireEvent.blur(address)
  await waitFor(() => expect(update).toHaveBeenCalledOnce())
  fireEvent.change(bypass, { target: { value: 'localhost\n127.0.0.1\n::1\n' } })
  await act(async () => finish({ id: 'local_network', schema_version: 1, revision: 4, state: { status: 'saved' },
    value: { enabled: false, url: 'http://proxy.test:8080', bypass: ['localhost', '127.0.0.1', '::1'] } }))
  expect(bypass).toHaveValue('localhost\n127.0.0.1\n::1\n')
  fireEvent.change(bypass, { target: { value: 'localhost\nnew.test\n' } })
  fireEvent.blur(bypass)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update.mock.calls[1][1]).toEqual({ expected_revision: 4, patch: { bypass: ['localhost', 'new.test'] } })
  expect(address).toHaveValue('http://proxy.test:8080')
})

it('直连规则改回原值后不提交，也不把相同清单附带到其他修改中', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update } = setup()
  const bypass = screen.getByLabelText('直连规则')
  fireEvent.change(bypass, { target: { value: 'other.test' } })
  fireEvent.change(bypass, { target: { value: 'localhost\n127.0.0.1\n::1' } })
  fireEvent.blur(bypass)
  await act(async () => {})
  expect(update).not.toHaveBeenCalled()
  const address = screen.getByLabelText('代理地址')
  fireEvent.change(address, { target: { value: 'http://proxy.test:8080' } })
  fireEvent.blur(address)
  await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('local_network', {
    expected_revision: 3, patch: { url: 'http://proxy.test:8080' },
  }, undefined))
})

it('保存失败通过浮动消息保留重试入口和草稿，不自动重发', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update, view } = setup()
  update.mockRejectedValueOnce(new Error('代理配置提交失败'))
  const address = screen.getByLabelText('代理地址')
  fireEvent.change(address, { target: { value: 'http://proxy.test:8080' } })
  fireEvent.blur(address)
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('代理配置提交失败')
  expect(view.container).not.toContainElement(notice)
  expect(address).toHaveValue('http://proxy.test:8080')
  expect(update).toHaveBeenCalledOnce()
  fireEvent.click(within(notice).getByRole('button', { name: /重\s*试/u }))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(address).toHaveValue('http://proxy.test:8080')
})

it('关闭代理只修改开关，保留地址与直连清单', async () => {
  await i18n.changeLanguage('zh-CN')
  const { update } = setup({ enabled: true, url: 'http://proxy.test:8080', bypass: ['private.test'] })
  fireEvent.click(screen.getByRole('switch', { name: '启用代理' }))
  await waitFor(() => expect(update).toHaveBeenCalledExactlyOnceWith('local_network', {
    expected_revision: 3, patch: { enabled: false },
  }, undefined))
  expect(screen.getByLabelText('代理地址')).toHaveValue('http://proxy.test:8080')
  expect(screen.getByLabelText('直连规则')).toHaveValue('private.test')
})

it('离开时提交完整草稿，启用状态缺少地址时不提交并保留修改', async () => {
  await i18n.changeLanguage('zh-CN')
  const complete = setup()
  fireEvent.change(screen.getByLabelText('代理地址'), { target: { value: ' http://proxy.test:8080 ' } })
  complete.view.unmount()
  await waitFor(() => expect(complete.update).toHaveBeenCalledExactlyOnceWith('local_network', {
    expected_revision: 3, patch: { url: 'http://proxy.test:8080' },
  }, undefined))
  const incomplete = setup({ enabled: true, url: 'http://proxy.test:8080', bypass: [] })
  fireEvent.change(screen.getByLabelText('代理地址'), { target: { value: '' } })
  fireEvent.blur(screen.getByLabelText('代理地址'))
  expect(await screen.findByRole('alert')).toHaveTextContent('请先填写代理地址。')
  incomplete.view.unmount()
  await act(async () => {})
  expect(incomplete.update).not.toHaveBeenCalled()
  render(incomplete.content)
  expect(screen.getByLabelText('代理地址')).toHaveValue('')
  fireEvent.click(screen.getByRole('switch', { name: '启用代理' }))
  await waitFor(() => expect(incomplete.update).toHaveBeenCalledExactlyOnceWith('local_network', {
    expected_revision: 3, patch: { enabled: false, url: '' },
  }, undefined))
})

it('没有设置网关时禁用编辑，显示准确的适用范围且不渲染内嵌状态', async () => {
  await i18n.changeLanguage('en-US')
  render(<I18nextProvider i18n={i18n}><LocalNetworkSettings /></I18nextProvider>)
  expect(screen.getByRole('switch', { name: 'Enable proxy' })).toBeDisabled()
  expect(screen.getByLabelText('Proxy URL')).toBeDisabled()
  expect(screen.getByLabelText('Bypass proxy')).toBeDisabled()
  expect(screen.getByText('For MCP and local commands. Applies to new tasks and connections.')).toBeVisible()
  fireEvent.focus(screen.getByRole('button', { name: 'Proxy details' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Web search, model APIs, cloud sync and updates are not affected.')
  expect(screen.queryByText(/Saving|Saved|Auto-save/u)).not.toBeInTheDocument()
})
