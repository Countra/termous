import { App, ConfigProvider } from 'antd'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway, type SettingsTransport } from '#entities/settings'
import type { AnalysisGateway, AnalysisStorageUsage } from '#entities/screen-analysis'
import { ScreenAnalysisStorageSetting } from './ScreenAnalysisStorageSetting'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture(active = true, usageOverrides: Partial<AnalysisStorageUsage> = {}) {
  const policy = { max_bytes: 1024 ** 3, max_records: 100, retention_days: 30 }
  let saved: SettingsSnapshot = { id: 'screen_analysis_storage', schema_version: 1, revision: 7, value: policy, state: { status: 'applied' } }
  const update = vi.fn<SettingsTransport['update']>(async (_id, request) => {
    saved = { ...saved, revision: saved.revision + 1, value: request.patch }
    return saved
  })
  const store = new SettingsModuleStore({ read: vi.fn(async () => saved), update })
  const settings: SettingsGateway = { getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe }
  const usage: AnalysisStorageUsage = { policy, records: 12, content_bytes: 64 * 1024 ** 2, pending_bytes: 16 * 1024 ** 2,
    database_bytes: 1024, wal_bytes: 512, free_page_bytes: 0, ...usageOverrides }
  const analysisStorage = vi.fn().mockResolvedValue(usage)
  const clearAnalyses = vi.fn().mockResolvedValue(undefined)
  const gateway = { analysisStorage, clearAnalyses } as unknown as AnalysisGateway
  const view = (visible: boolean) => <ConfigProvider theme={{ token: { motion: false } }}><App><SettingsGatewayContext value={settings}>
    <ScreenAnalysisStorageSetting disabled={false} active={visible} gateway={gateway} />
  </SettingsGatewayContext></App></ConfigProvider>
  const rendered = render(view(active))
  return { update, analysisStorage, clearAnalyses, usage, store, view, ...rendered }
}

test('存储总量不重复计算待清理文件，MiB 转换后按原模块和版本保存', async () => {
  const f = fixture()
  const input = screen.getByRole('spinbutton', { name: 'analysisCenter.max_bytes' })
  await waitFor(() => expect(input).toBeEnabled())
  const progress = await screen.findByRole('progressbar', { name: 'settings.screenAnalysis.storageUsage' })
  expect(progress).toHaveAttribute('value', String(64 * 1024 ** 2))
  expect(progress).toHaveAttribute('max', String(1024 ** 3))
  expect(screen.getByText('settings.screenAnalysis.contentUsage').parentElement).toHaveTextContent('48.00 MiB')
  expect(screen.getByText('settings.screenAnalysis.pendingUsage').parentElement).toHaveTextContent('16.00 MiB')
  fireEvent.change(input, { target: { value: '512' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  fireEvent.blur(input)
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(1))
  expect(f.update.mock.calls[0]).toEqual(['screen_analysis_storage', {
    expected_revision: 7, patch: { ...f.usage.policy, max_bytes: 512 * 1024 ** 2 },
  }, expect.any(AbortSignal)])
})

test('记录已清空但文件待回收时，总量继续占用预算且分析内容为零', async () => {
  fixture(true, { records: 0, content_bytes: 16 * 1024 ** 2, pending_bytes: 16 * 1024 ** 2 })
  expect(await screen.findByRole('progressbar')).toHaveAttribute('value', String(16 * 1024 ** 2))
  expect(screen.getByText('settings.screenAnalysis.contentUsage').parentElement).toHaveTextContent('0.00 MiB')
  expect(screen.getByText('settings.screenAnalysis.pendingUsage').parentElement).toHaveTextContent('16.00 MiB')
})

test('保存后刷新保留用量节点和展开状态，新用量就绪后再替换数值', async () => {
  const f = fixture()
  const progress = await screen.findByRole('progressbar')
  const summary = screen.getByText('settings.screenAnalysis.databaseDetails')
  await userEvent.click(summary)
  const details = summary.closest('details')!
  expect(details.open).toBe(true)
  let finish!: (value: AnalysisStorageUsage) => void
  f.analysisStorage.mockImplementationOnce(() => new Promise<AnalysisStorageUsage>(resolve => { finish = resolve }))
  const input = screen.getByRole('spinbutton', { name: 'analysisCenter.max_bytes' })
  fireEvent.change(input, { target: { value: '512' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
  await waitFor(() => expect(f.analysisStorage).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('progressbar')).toBe(progress)
  expect(progress).toHaveAttribute('max', String(1024 ** 3))
  expect(details).toBeInTheDocument()
  expect(details.open).toBe(true)
  await act(async () => finish({ ...f.usage, policy: { ...f.usage.policy, max_bytes: 512 * 1024 ** 2 } }))
  expect(screen.getByRole('progressbar')).toBe(progress)
  expect(progress).toHaveAttribute('max', String(512 * 1024 ** 2))
  expect(details.open).toBe(true)
})

test('手动刷新失败保留最后确认的用量和明细，仍显示读取错误', async () => {
  const f = fixture()
  const progress = await screen.findByRole('progressbar')
  let fail!: (reason: Error) => void
  f.analysisStorage.mockImplementationOnce(() => new Promise<AnalysisStorageUsage>((_resolve, reject) => { fail = reject }))
  await userEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.refresh' }))
  await waitFor(() => expect(f.analysisStorage).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('progressbar')).toBe(progress)
  await act(async () => fail(new Error('fixture unavailable')))
  expect(await screen.findByRole('alert')).toHaveTextContent('analysisCenter.cleanupFailed')
  expect(screen.getByRole('progressbar')).toBe(progress)
  expect(progress).toHaveAttribute('value', String(64 * 1024 ** 2))
})

test('存储参数拒绝非法范围，失败后保留草稿并支持重试', async () => {
  const f = fixture()
  const input = screen.getByRole('spinbutton', { name: 'analysisCenter.retention_days' })
  await waitFor(() => expect(input).toBeEnabled())
  for (const value of ['0', '91', '1.5']) {
    fireEvent.change(input, { target: { value } })
    fireEvent.blur(input)
    expect(f.update).not.toHaveBeenCalled()
    expect(input).toHaveAttribute('aria-invalid', 'true')
  }
  f.update.mockRejectedValueOnce(new Error('fixture'))
  fireEvent.change(input, { target: { value: '20' } })
  fireEvent.blur(input)
  await screen.findByRole('alert')
  expect(input).toHaveValue('20')
  await userEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

test('切换页面终止存储观察，迟到结果不会覆盖重新进入后的数据', async () => {
  const f = fixture(false)
  expect(f.analysisStorage).not.toHaveBeenCalled()
  let resolve: (value: AnalysisStorageUsage) => void = () => {}
  f.analysisStorage.mockImplementationOnce(() => new Promise<AnalysisStorageUsage>(done => { resolve = done }))
  f.rerender(f.view(true))
  await waitFor(() => expect(f.analysisStorage).toHaveBeenCalledTimes(1))
  const signal = f.analysisStorage.mock.calls[0][0] as AbortSignal
  f.rerender(f.view(false))
  expect(signal.aborted).toBe(true)
  f.rerender(f.view(true))
  await screen.findByRole('progressbar')
  await act(async () => resolve({ ...f.usage, content_bytes: 900 * 1024 ** 2 }))
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', String(64 * 1024 ** 2))
})

test('清理历史需要确认，切换设置页会关闭未确认对话框', async () => {
  const f = fixture()
  await userEvent.click(screen.getByRole('button', { name: 'analysisCenter.clear' }))
  expect(await screen.findByRole('dialog')).toBeInTheDocument()
  expect(f.clearAnalyses).not.toHaveBeenCalled()
  f.rerender(f.view(false))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(f.clearAnalyses).not.toHaveBeenCalled()
})
