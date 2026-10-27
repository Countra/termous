import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { presentationDefaults } from '@termous/remote-protocol/presentation'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway, type SettingsTransport } from '#entities/settings'
import type { SettingsSnapshot, SettingsUpdate } from '#common/contracts'
import { PresentationDefaultsSettings } from './PresentationDefaultsSettings'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'zh-CN' } }) }))

function fixture() {
  let saved: SettingsSnapshot = { id: 'desktop_presentation', schema_version: 1, revision: 1, value: { ...presentationDefaults() }, state: { status: 'saved' } }
  const save = (input: SettingsUpdate) => { saved = { ...saved, revision: saved.revision + 1, value: input.patch }; return saved }
  const update = vi.fn<SettingsTransport['update']>().mockImplementation(async (_id, input) => save(input))
  const store = new SettingsModuleStore({ read: async () => saved, update })
  const gateway: SettingsGateway = { getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal), updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe }
  const element = <SettingsGatewayContext value={gateway}><PresentationDefaultsSettings /></SettingsGatewayContext>
  const view = render(element)
  return { update, store, save, view, element }
}

async function pixelInput() {
  const summary = await screen.findByText('RDP 直接观看', { selector: 'summary span' })
  if (!summary.closest('details')?.open) fireEvent.click(summary)
  return screen.getByRole('spinbutton', { name: '更新频率上限' })
}

test('多位数编辑完成后自动保存，失败保留草稿并允许重试', async () => {
  const { update, store } = fixture()
  update.mockRejectedValueOnce(new Error('save_failed'))
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '1' } })
  fireEvent.change(input, { target: { value: '15' } })
  expect(update).not.toHaveBeenCalled()
  fireEvent.blur(input)
  expect(await screen.findByText('保存失败，修改已保留。')).toBeVisible()
  expect(input).toHaveValue('15')
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update.mock.calls[1][1]).toMatchObject({ expected_revision: 1, patch: { pixels: { updateRateLimit: 15 } } })
  await waitFor(() => expect(store.snapshot('desktop_presentation')?.revision).toBe(2))
  expect(screen.queryByText('已保存')).toBeNull()
  expect(screen.queryByRole('button', { name: '保存默认设置' })).toBeNull()
  expect(screen.queryByText('保存失败，修改已保留。')).toBeNull()
})

test('下拉预设和桌面效果选中后自动保存', async () => {
  const user = userEvent.setup(), { update, store } = fixture()
  await user.click(within(await screen.findByRole('region', { name: '远程控制画面' })).getByRole('combobox', { name: '画质方案' }))
  await user.click(screen.getByText('均衡'))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  expect(update.mock.calls[0][1].patch).toMatchObject({ pixels: { updateRateLimit: 30 }, video: { bitrate: 4_000_000 }, rfb: presentationDefaults().rfb })
  await waitFor(() => expect(store.snapshot('desktop_presentation')?.revision).toBe(2))
  await user.click(screen.getByRole('combobox', { name: '桌面壁纸' }))
  await user.click(screen.getByText('关闭'))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update.mock.calls[1][1]).toMatchObject({ expected_revision: 2, patch: { connection: { wallpaper: 'disabled' } } })
})

test('跨画面分组与桌面效果的连续修改共用保存队列，不丢失其他分组', async () => {
  const user = userEvent.setup(), { update, save, store } = fixture()
  let finish!: () => void
  update.mockImplementationOnce(async (_id, input) => new Promise(resolve => { finish = () => resolve(save(input)) }))
  await user.click(within(await screen.findByRole('region', { name: '远程控制画面' })).getByRole('combobox', { name: '画质方案' }))
  await user.click(screen.getByText('均衡'))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '25' } })
  fireEvent.blur(input)
  await user.click(screen.getByRole('combobox', { name: '桌面壁纸' }))
  await user.click(screen.getByText('关闭'))
  expect(update).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  await waitFor(() => expect(store.snapshot('desktop_presentation')?.revision).toBe(3))
  expect(update.mock.calls[1][1]).toMatchObject({ expected_revision: 2, patch: {
    pixels: { updateRateLimit: 25 }, video: presentationDefaults('balanced').video,
    rfb: presentationDefaults().rfb, connection: { wallpaper: 'disabled' },
  } })
})

test('回车后失焦不重复提交，保存期间只保留最新待提交值', async () => {
  const { update, save, store } = fixture()
  let finish!: () => void
  update.mockImplementationOnce(async (_id, input) => new Promise(resolve => { finish = () => resolve(save(input)) }))
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '15' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('正在保存…')).toBeNull()
  expect(input).not.toBeDisabled()
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.blur(input)
  fireEvent.change(input, { target: { value: '25' } })
  fireEvent.blur(input)
  expect(update).toHaveBeenCalledTimes(1)
  await act(async () => finish())
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update.mock.calls[1][1]).toMatchObject({ expected_revision: 2, patch: { pixels: { updateRateLimit: 25 } } })
  expect(input).toHaveValue('25')
  await waitFor(() => expect(store.snapshot('desktop_presentation')?.revision).toBe(3))
  expect(screen.queryByText('已保存')).toBeNull()
})

test.each(['', '0', '31'])('非法数值不自动提交，允许修正：%s', async value => {
  const { update } = fixture()
  const input = await pixelInput()
  fireEvent.change(input, { target: { value } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  expect(input).toHaveValue(value)
  fireEvent.blur(input)
  expect(update).not.toHaveBeenCalled()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  expect(input).not.toHaveAttribute('aria-invalid', 'true')
})

test('保存回执不打断未完成的输入，下拉修改随后使用最新版本保存', async () => {
  const user = userEvent.setup(), { update, save, store } = fixture()
  let finish!: () => void
  update.mockImplementationOnce(async (_id, input) => new Promise(resolve => { finish = () => resolve(save(input)) }))
  const input = await pixelInput()
  await user.clear(input)
  await user.type(input, '15{Enter}')
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  await user.clear(input)
  await user.type(input, '25')
  await act(async () => finish())
  expect(input).toHaveValue('25')
  expect(update).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('combobox', { name: '流畅度' }))
  await user.click(screen.getByText('均衡'))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(3))
  expect(update.mock.calls[1][1]).toMatchObject({ expected_revision: 2, patch: { pixels: { updateRateLimit: 25 } } })
  expect(update.mock.calls[2][1]).toMatchObject({ expected_revision: 3, patch: { pixels: { updateRateLimit: 20 }, video: { bitrate: 8_000_000 } } })
  await waitFor(() => expect(store.snapshot('desktop_presentation')?.revision).toBe(4))
})

test('选择方案会替换已结束编辑的无效数值', async () => {
  const user = userEvent.setup(), { update, store } = fixture()
  const input = await pixelInput()
  await user.clear(input)
  await user.type(input, '31')
  await user.click(screen.getByRole('combobox', { name: '流畅度' }))
  expect(update).not.toHaveBeenCalled()
  expect(input).toHaveAttribute('aria-invalid', 'true')
  await user.click(screen.getByText('均衡'))
  await waitFor(() => expect(store.snapshot('desktop_presentation')?.revision).toBe(2))
  expect(input).toHaveValue('20')
  expect(input).not.toHaveAttribute('aria-invalid', 'true')
})

test('外部更新不打断正在输入的数值，提交使用新修订号', async () => {
  const { update, store, save } = fixture()
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '15' } })
  const external = presentationDefaults('balanced')
  await act(async () => { store.merge(save({ expected_revision: 1, patch: { ...external } })) })
  expect(input).toHaveValue('15')
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  expect(update.mock.calls[0][1]).toMatchObject({ expected_revision: 2, patch: { pixels: { updateRateLimit: 15 }, video: { bitrate: 4_000_000 } } })
})

test('修订冲突后保留修改，手动重试使用刷新后的修订号', async () => {
  const { update, save } = fixture()
  update.mockImplementationOnce(async () => {
    save({ expected_revision: 1, patch: { ...presentationDefaults('balanced') } })
    throw new Error('SETTINGS_REVISION_CONFLICT')
  })
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '15' } })
  fireEvent.blur(input)
  expect(await screen.findByText('保存失败，修改已保留。')).toBeVisible()
  expect(input).toHaveValue('15')
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(update.mock.calls[1][1]).toMatchObject({ expected_revision: 2, patch: { pixels: { updateRateLimit: 15 } } })
})

test('离开设置页仍保存最后一次调整，返回时显示确认值', async () => {
  const { update, save, store, view, element } = fixture()
  let finish!: () => void
  update.mockImplementationOnce(async (_id, input) => new Promise(resolve => { finish = () => resolve(save(input)) }))
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '15' } })
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  fireEvent.change(input, { target: { value: '25' } })
  fireEvent.blur(input)
  view.unmount()
  await act(async () => finish())
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
  expect(store.snapshot('desktop_presentation')?.value).toMatchObject({ pixels: { updateRateLimit: 25 } })
  render(element)
  expect(await pixelInput()).toHaveValue('25')
})

test('实例重置丢弃旧队列，迟到回执不污染新默认值', async () => {
  const { update, save, store } = fixture()
  let finish!: () => void
  update.mockImplementationOnce(async (_id, input) => new Promise(resolve => { finish = () => resolve(save(input)) }))
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '15' } })
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  fireEvent.change(input, { target: { value: '25' } })
  fireEvent.blur(input)
  await act(async () => {
    store.reset()
    store.merge({ id: 'desktop_presentation', schema_version: 1, revision: 1, value: { ...presentationDefaults('balanced') }, state: { status: 'saved' } })
    finish()
  })
  expect(update).toHaveBeenCalledTimes(1)
  expect(await pixelInput()).toHaveValue('20')
  expect(screen.queryByText('保存失败，修改已保留。')).toBeNull()
})

test('离开页面后保存失败，返回仍保留草稿并允许重试', async () => {
  const { update, view, element } = fixture()
  let fail!: () => void
  update.mockImplementationOnce(async () => new Promise((_, reject) => { fail = () => reject(new Error('save_failed')) }))
  const input = await pixelInput()
  fireEvent.change(input, { target: { value: '15' } })
  fireEvent.blur(input)
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1))
  view.unmount()
  await act(async () => fail())
  render(element)
  expect(await pixelInput()).toHaveValue('15')
  expect(await screen.findByText('保存失败，修改已保留。')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2))
})
