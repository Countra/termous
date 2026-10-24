import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App } from 'antd'
import { expect, test, vi } from 'vitest'
import type { AnalysisGateway, SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway, type SettingsTransport } from '#entities/settings'
import { ScreenAnalysisStorageSetting } from './ScreenAnalysisStorageSetting'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture(failRead = false) {
  let saved: SettingsSnapshot = { id: 'screen_analysis_storage', schema_version: 1, revision: 1,
    value: { max_bytes: 1024 ** 3, max_records: 500, retention_days: 7 }, state: { status: 'applied' } }
  const update = vi.fn<SettingsTransport['update']>(async (_id, request) => { saved = { ...saved, revision: saved.revision + 1, value: request.patch }; return saved })
  const read = vi.fn(async () => saved)
  if (failRead) read.mockRejectedValueOnce(new Error('temporary read failure'))
  const store = new SettingsModuleStore({ read, update })
  const gateway: SettingsGateway = { getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe }
  const clearAnalyses = vi.fn(async () => undefined)
  const analysisStorage = vi.fn(async () => ({ records: 2, content_bytes: 1024, pending_bytes: 0, database_bytes: 2048, wal_bytes: 0, free_page_bytes: 0, policy: saved.value }))
  const analysis = { clearAnalyses, analysisStorage } as unknown as AnalysisGateway
  render(<App><SettingsGatewayContext value={gateway}><ScreenAnalysisStorageSetting disabled={false} gateway={analysis} /></SettingsGatewayContext></App>)
  return { read, update, store, clearAnalyses, analysisStorage }
}

test('首次读取失败可以重新读取政策，不发送空草稿', async () => {
  const f = fixture(true)
  const limit = screen.getByRole('spinbutton', { name: 'analysisCenter.max_bytes' })
  await screen.findByRole('alert')
  expect(limit).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  await waitFor(() => expect(limit).toBeEnabled())
  expect(limit).toHaveValue('1024')
  expect(f.read).toHaveBeenCalledTimes(2)
  expect(f.update).not.toHaveBeenCalled()
})

test('保留策略失焦保存、非法值不写入，失败后保留草稿重试', async () => {
  const f = fixture()
  const limit = screen.getByRole('spinbutton', { name: 'analysisCenter.max_bytes' })
  await waitFor(() => expect(limit).toBeEnabled())
  fireEvent.change(limit, { target: { value: '127' } }); fireEvent.blur(limit)
  expect(f.update).not.toHaveBeenCalled()
  expect(limit).toHaveAttribute('aria-invalid', 'true')
  f.update.mockRejectedValueOnce(new Error('storage error'))
  fireEvent.change(limit, { target: { value: '256' } }); fireEvent.blur(limit)
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.screenAnalysis.saveFailed')
  expect(limit).toHaveValue('256')
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(2))
  expect(f.update.mock.calls[1][1]).toEqual({ expected_revision: 1, patch: { max_bytes: 256 * 1024 ** 2, max_records: 500, retention_days: 7 } })
})

test('策略冲突不覆盖外部版本，清空必须确认', async () => {
  const f = fixture()
  const days = screen.getByRole('spinbutton', { name: 'analysisCenter.retention_days' })
  await waitFor(() => expect(days).toBeEnabled())
  fireEvent.change(days, { target: { value: '30' } })
  act(() => f.store.merge({ ...f.store.snapshot('screen_analysis_storage')!, revision: 2, value: { max_bytes: 1024 ** 3, max_records: 500, retention_days: 14 } }))
  f.update.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'SETTINGS_REVISION_CONFLICT' }))
  fireEvent.blur(days)
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.conflict')
  expect(f.update.mock.calls[0][1].expected_revision).toBe(1)
  expect(days).toHaveValue('30')
  fireEvent.click(screen.getByRole('button', { name: 'analysisCenter.clear' }))
  expect(f.clearAnalyses).not.toHaveBeenCalled()
  expect(await screen.findByText('analysisCenter.clearHint')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /OK|确 定|确定/u }))
  await waitFor(() => expect(f.clearAnalyses).toHaveBeenCalledTimes(1))
})
