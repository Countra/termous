import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AnalysisQuery } from '#common/contracts'
import { AnalysisFilterEditor } from './AnalysisFilterEditor'
import { AnalysisFilterPopover } from './AnalysisFilterPopover'
import { AnalysisHistoryFilters } from './AnalysisHistoryFilters'
import { AnalysisSearch } from './AnalysisSearch'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
afterEach(() => vi.useRealTimers())

it('浮层保持列表可见，修改无需确认，重置保留搜索，Escape 仅关闭浮层', async () => {
  const changed = vi.fn(), outside = vi.fn()
  function View() {
    const [value, setValue] = useState<AnalysisQuery>({ q: '连接' })
    return <ConfigProvider theme={{ token: { motion: false } }}><div onKeyDown={outside}><p>visible results</p>
      <AnalysisFilterPopover count={value.text_min === undefined ? 0 : 1} onReset={() => { changed({ q: value.q }); setValue({ q: value.q }) }}>
        <AnalysisFilterEditor value={value} ocr onChange={next => { changed(next); setValue(next) }} />
      </AnalysisFilterPopover></div></ConfigProvider>
  }
  render(<View />)
  const trigger = screen.getByRole('button', { name: 'desktopWorkflow.analysisWorkspace.filters' })
  fireEvent.click(trigger)
  const confidence = await screen.findByRole('spinbutton', { name: 'desktopWorkflow.analysisWorkspace.textMinimum' })
  confidence.focus()
  fireEvent.change(confidence, { target: { value: '60' } })
  expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ q: '连接', text_min: .6 }))
  expect(confidence).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('visible results')).toBeVisible()
  fireEvent.click(screen.getByText('desktopWorkflow.analysisWorkspace.reset'))
  expect(changed).toHaveBeenLastCalledWith({ q: '连接' })
  const reset = screen.getByRole('spinbutton', { name: 'desktopWorkflow.analysisWorkspace.textMinimum' })
  expect(reset).toHaveValue('')
  fireEvent.keyDown(reset, { key: 'Escape' })
  await waitFor(() => expect(trigger).toHaveAttribute('aria-expanded', 'false'))
  expect(outside).not.toHaveBeenCalled()
  expect(trigger).toHaveFocus()
})

it('历史使用统一日期控件即时提交，非法时间顺序不覆盖有效筛选', async () => {
  const change = vi.fn()
  render(<AnalysisHistoryFilters value={{ after: new Date(2026, 9, 25, 10).toISOString(), before: new Date(2026, 9, 26, 10).toISOString() }} onChange={change} />)
  fireEvent.click(screen.getByRole('textbox', { name: 'analysisCenter.before' }))
  fireEvent.click(await screen.findByTitle('2026-10-27'))
  expect(change).toHaveBeenLastCalledWith({ after: new Date(2026, 9, 25, 10).toISOString(), before: new Date(2026, 9, 27, 10).toISOString() })
  change.mockClear()
  fireEvent.click(screen.getByTitle('2026-10-24'))
  expect(change).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toBeInTheDocument()
  fireEvent.click(screen.getByTitle('2026-10-26'))
  expect(change).toHaveBeenCalledOnce()
})

it('搜索等待中文组合结束，卸载取消尚未提交的输入', () => {
  vi.useFakeTimers()
  const change = vi.fn()
  const view = render(<AnalysisSearch placeholder="search" onChange={change} />)
  const input = screen.getByRole('textbox')
  fireEvent.compositionStart(input)
  fireEvent.change(input, { target: { value: '连接' } })
  act(() => vi.advanceTimersByTime(500))
  expect(change).not.toHaveBeenCalled()
  fireEvent.compositionEnd(input)
  act(() => vi.advanceTimersByTime(250))
  expect(change).toHaveBeenCalledWith('连接')
  fireEvent.change(input, { target: { value: '新文字' } })
  view.unmount()
  act(() => vi.advanceTimersByTime(500))
  expect(change).toHaveBeenCalledOnce()
})
