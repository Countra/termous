import { act, fireEvent, render, screen } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import type { AnalysisPresentation } from '#common/contracts'
import type { WorkflowSurfaceModel } from '../../model/workspace/types'
import { WorkflowAnalysis } from './WorkflowAnalysis'
import { setup } from './analysisTestFixture'

const callbacks = vi.hoisted(() => ({ change: undefined as undefined | ((patch: Partial<AnalysisPresentation>) => void) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('#entities/screen-analysis', async importOriginal => ({
  ...await importOriginal<object>(),
  AnalysisExplorer: ({ onChange }: { onChange: (patch: Partial<AnalysisPresentation>) => void }) => { callbacks.change = onChange; return null },
}))

it('独立窗口关闭等待确认时，旧快照及迟到布局不能覆盖关闭意图；重新打开可继续调整', () => {
  const { gateway, props } = setup()
  const presentation = vi.fn()
  const model = {
    state: { view: 'scripts', dirty: false, busy: false, presentation: { propertiesVisible: true, queries: { scripts: '', runs: '' }, runFilter: 'all',
      analysis: { open: true, history: false, layer: 'elements', filter: {} } } },
    target: props.target, environment: { sessions: props.sessions, profiles: [] }, actions: { presentation },
  } as unknown as WorkflowSurfaceModel
  const content = () => <ConfigProvider theme={{ token: { motion: false } }}><App><WorkflowAnalysis model={{ ...model }} gateway={gateway} slot="target" active guided={false} onMediaTask={() => {}} onApplied={() => {}} /></App></ConfigProvider>
  const view = render(content())
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(presentation).toHaveBeenLastCalledWith(expect.objectContaining({ analysis: expect.objectContaining({ open: false }) }))
  view.rerender(content())
  const calls = presentation.mock.calls.length
  act(() => callbacks.change?.({ panels: { historyWidth: 260, resultsWidth: 350 } }))
  act(() => callbacks.change?.({ view: { zoom: 1, boxes: true } }))
  expect(presentation).toHaveBeenCalledTimes(calls)
  fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.title' }))
  act(() => callbacks.change?.({ panels: { historyWidth: 260, resultsWidth: 350 } }))
  expect(presentation).toHaveBeenLastCalledWith(expect.objectContaining({ analysis: expect.objectContaining({ open: true, panels: { historyWidth: 260, resultsWidth: 350 } }) }))
})
