import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { AnalysisCanvas } from './AnalysisCanvas'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

it('恢复已保存视图不重复回报，真实调整才提交，卸载取消延迟回报', async () => {
  vi.useFakeTimers()
  const changed = vi.fn()
  const props = { blob: new Blob(['image'], { type: 'image/png' }), image: { width: 800, height: 600, coordinate_space: 'original_pixels' as const }, geometry: [], onSelect: vi.fn(), onViewChange: changed }
  const view = render(<AnalysisCanvas {...props} preference={{ zoom: 'fit', boxes: true }} />)
  fireEvent.load(screen.getByAltText('analysisCenter.originalImage'))
  await act(() => vi.advanceTimersByTimeAsync(250))
  expect(changed).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.boxes' }))
  await act(() => vi.advanceTimersByTimeAsync(250))
  expect(changed).toHaveBeenCalledExactlyOnceWith({ zoom: 'fit', boxes: false })
  view.rerender(<AnalysisCanvas {...props} preference={{ zoom: 'fit', boxes: false }} />)
  await act(() => vi.advanceTimersByTimeAsync(250))
  expect(changed).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.boxes' }))
  view.unmount()
  await act(() => vi.advanceTimersByTimeAsync(250))
  expect(changed).toHaveBeenCalledOnce()
})
