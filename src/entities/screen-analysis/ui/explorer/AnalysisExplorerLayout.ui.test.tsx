import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AnalysisPresentation } from '#common/contracts'
import { defaultAnalysisPanels, explorerLayout, type AnalysisPane } from '../../model/explorerLayout'
import { AnalysisExplorerLayout } from './AnalysisExplorerLayout'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => vi.unstubAllGlobals())

it('历史和结果共用右侧面板，窄窗口切换内容，各自保留宽度偏好', () => {
  const preferred = { historyWidth: 380, resultsWidth: 520 }
  for (const width of [800, 1000, 1200, 1600]) {
    const value = explorerLayout(width, preferred, true, true, 'canvas')
    expect(value.sizes.canvas / 100 * value.available).toBeGreaterThanOrEqual(359.99)
    expect(value.active).toBe('history')
    expect(value.sizes.canvas + value.sizes.sidebar).toBeCloseTo(100)
  }
  expect(explorerLayout(640, preferred, false, true, 'results').sizes).toEqual({ canvas: 0, sidebar: 100 })
  expect(explorerLayout(1600, preferred, false, false, 'canvas').sizes).toEqual({ canvas: 100, sidebar: 0 })
  const history = explorerLayout(1600, preferred, true, true, 'canvas')
  const results = explorerLayout(1600, preferred, false, true, 'canvas')
  expect(history.sizes.sidebar / 100 * history.available).toBeCloseTo(380)
  expect(results.sizes.sidebar / 100 * results.available).toBeCloseTo(520)
})

it('折叠和窗口适配不重建画布，隐藏历史卸载查询，不改写用户宽度', () => {
  let resize!: (width: number) => void
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { if (element.hasAttribute('data-analysis-layout')) resize = width => this.callback([{ target: element, contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver) }
    unobserve() {}
    disconnect() {}
  })
  const mounted = vi.fn(), released = vi.fn(), patch = vi.fn()
  function Canvas() { useEffect(() => { mounted() }, []); return <p>canvas content</p> }
  function History() { useEffect(() => released, []); return <p>history content</p> }
  function View() {
    const [state, setState] = useState<AnalysisPresentation>({ open: true, layer: 'elements', filter: {}, history: true, panels: defaultAnalysisPanels })
    const [pane, setPane] = useState<AnalysisPane>('canvas')
    return <AnalysisExplorerLayout state={state} onChange={value => { patch(value); setState(s => ({ ...s, ...value })) }} pane={pane} onPane={setPane} history={<History />} results={<p>result content</p>}><Canvas /></AnalysisExplorerLayout>
  }
  render(<View />)
  const collapseHistory = screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.collapseHistory' })
  expect(collapseHistory).toHaveAttribute('aria-controls', 'analysis-history')
  expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  fireEvent.click(collapseHistory)
  expect(released).toHaveBeenCalledOnce()
  expect(screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.expandHistory' })).toBe(collapseHistory)
  expect(collapseHistory).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('result content')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.expandResults' }))
  expect(screen.getByText('result content')).toBeInTheDocument()
  const resultTab = screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.collapseResults' })
  expect(resultTab).toHaveAttribute('aria-selected', 'true')
  resultTab.focus()
  fireEvent.keyDown(resultTab, { key: 'ArrowDown' })
  expect(collapseHistory).toHaveFocus()
  fireEvent.click(collapseHistory)
  expect(screen.queryByText('result content')).not.toBeInTheDocument()
  expect(screen.getByText('history content')).toBeInTheDocument()
  act(() => resize(640))
  fireEvent.click(screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.collapseHistory' }))
  expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: 'desktopWorkflow.analysisWorkspace.expandResults' }))
  expect(screen.getByText('result content')).toBeInTheDocument()
  act(() => resize(1400))
  expect(mounted).toHaveBeenCalledOnce()
  expect(patch.mock.calls.every(([value]) => value.panels === undefined)).toBe(true)
})
