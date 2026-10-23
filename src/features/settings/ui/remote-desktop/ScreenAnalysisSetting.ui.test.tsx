import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { screenAnalysisDefaults, type SettingsSnapshot } from '#common/contracts'
import { SettingsGatewayContext, SettingsModuleStore, type SettingsGateway, type SettingsTransport } from '#entities/settings'
import { ScreenAnalysisSetting } from './ScreenAnalysisSetting'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function fixture() {
  let saved: SettingsSnapshot = { id: 'screen_analysis', schema_version: 1, revision: 1, value: { ...screenAnalysisDefaults }, state: { status: 'applied' } }
  const update = vi.fn<SettingsTransport['update']>(async (_id, request) => {
    saved = { ...saved, revision: saved.revision + 1, value: request.patch }
    return saved
  })
  const read = vi.fn(async () => saved)
  const store = new SettingsModuleStore({ read, update })
  const gateway: SettingsGateway = { getModule: id => store.snapshot(id), readModule: (id, signal) => store.read(id, signal),
    updateModule: (id, patch, options) => store.update(id, patch, options), subscribeSettings: store.subscribe }
  render(<SettingsGatewayContext value={gateway}><ScreenAnalysisSetting disabled={false} /></SettingsGatewayContext>)
  return { update, read, store, setSaved: (next: SettingsSnapshot) => { saved = next } }
}

test('数字输入确认时保存，关闭 OCR 保留参数，恢复默认只提交一次', async () => {
  const f = fixture()
  const confidence = screen.getByRole('spinbutton', { name: 'settings.screenAnalysis.confidence' })
  await waitFor(() => expect(confidence).toBeEnabled())
  fireEvent.change(confidence, { target: { value: '0.2' } })
  expect(f.update).not.toHaveBeenCalled()
  fireEvent.keyDown(confidence, { key: 'Enter', code: 'Enter' })
  fireEvent.blur(confidence)
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(1))
  expect(f.update.mock.calls[0][1]).toEqual({ expected_revision: 1, patch: { ...screenAnalysisDefaults, confidence: .2 } })
  await waitFor(() => expect(confidence).toBeEnabled())
  fireEvent.click(screen.getByRole('switch', { name: 'settings.screenAnalysis.ocr_enabled' }))
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(2))
  expect(screen.getByRole('spinbutton', { name: 'settings.screenAnalysis.text_confidence' })).toBeDisabled()
  expect(f.update.mock.calls[1][1].patch).toMatchObject({ ocr_enabled: false, text_confidence: .5, ocr_max_side: 1600 })
  await waitFor(() => expect(screen.getByRole('button', { name: 'settings.screenAnalysis.reset' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'settings.screenAnalysis.reset' }))
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(3))
  expect(f.update.mock.calls[2][1].patch).toEqual(screenAnalysisDefaults)
})

test('非法尺寸不提交，保存失败保留草稿并支持显式重试', async () => {
  const f = fixture()
  const size = screen.getByRole('spinbutton', { name: 'settings.screenAnalysis.image_size' })
  await waitFor(() => expect(size).toBeEnabled())
  fireEvent.change(size, { target: { value: '321' } })
  fireEvent.blur(size)
  expect(f.update).not.toHaveBeenCalled()
  expect(size).toHaveAttribute('aria-invalid', 'true')
  f.update.mockRejectedValueOnce(new Error('save failed'))
  fireEvent.change(size, { target: { value: '640' } })
  fireEvent.blur(size)
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.screenAnalysis.saveFailed')
  expect(size).toHaveValue('640')
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  await waitFor(() => expect(f.update).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
})

test('编辑期间外部版本变化不覆盖草稿，冲突不会自动重试或覆盖新设置', async () => {
  const f = fixture()
  const confidence = screen.getByRole('spinbutton', { name: 'settings.screenAnalysis.confidence' })
  await waitFor(() => expect(confidence).toBeEnabled())
  fireEvent.change(confidence, { target: { value: '0.2' } })
  const changed: SettingsSnapshot = { ...f.store.snapshot('screen_analysis')!, revision: 2, value: { ...screenAnalysisDefaults, confidence: .3 } }
  f.setSaved(changed)
  act(() => f.store.merge(changed))
  expect(Number((confidence as HTMLInputElement).value)).toBe(.2)
  f.update.mockRejectedValueOnce(Object.assign(new Error('conflict'), { code: 'SETTINGS_REVISION_CONFLICT' }))
  fireEvent.blur(confidence)
  expect(await screen.findByRole('alert')).toHaveTextContent('settings.conflict')
  expect(f.update.mock.calls[0][1].expected_revision).toBe(1)
  expect(f.update).toHaveBeenCalledTimes(1)
  expect(Number((confidence as HTMLInputElement).value)).toBe(.2)
  fireEvent.click(screen.getByRole('button', { name: 'settings.screenAnalysis.reload' }))
  await waitFor(() => expect(Number((confidence as HTMLInputElement).value)).toBe(.3))
  expect(f.update).toHaveBeenCalledTimes(1)
})
