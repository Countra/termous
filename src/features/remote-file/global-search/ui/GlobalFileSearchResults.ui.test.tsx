import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FileNameSearchResult } from '#entities/file'
import { GlobalFileSearchResults } from './GlobalFileSearchResults'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

function result(count: number): FileNameSearchResult {
  return {
    items: Array.from({ length: count }, (_, index) => ({
      path: `/srv/reports/report-${index}.txt`,
      name: `report-${index}.txt`,
      parent_path: '/srv/reports',
    })),
    returned_count: count,
    truncated: false,
    partial: false,
    timed_out: false,
    skipped_invalid_utf8: 0,
    duration_ms: 40,
    connection_generation: 3,
    one_file_system: false,
  }
}

describe('GlobalFileSearchResults', () => {
  it('虚拟化渲染大结果集且不产生滚动参数警告', () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <GlobalFileSearchResults
        result={result(1_000)}
        phase="completed"
        searchedQuery="report"
        locatingPath=""
        unavailablePaths={new Set()}
        onReveal={vi.fn()}
      />,
    )

    const firstName = screen.getByText('report-0.txt')
    const firstRow = firstName.closest('[data-row-key]')
    expect(firstRow).toHaveAttribute('aria-selected', 'true')
    expect(firstRow).toHaveAttribute('aria-posinset', '1')
    expect(firstRow).toHaveAttribute('aria-setsize', '1000')
    expect(screen.getByRole('listbox')).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-activedescendant', firstRow?.id)
    expect(screen.getAllByRole('button', { name: 'files.globalSearch.revealNamed' })[0])
      .toHaveAttribute('tabindex', '-1')
    expect(consoleWarn).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
    expect(screen.getAllByRole('option').length).toBeLessThan(1_000)

    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'End' })
    const lastRow = screen.getByText('report-999.txt').closest('[data-row-key]')
    expect(lastRow).toHaveAttribute('aria-selected', 'true')
    expect(lastRow).toHaveAttribute('aria-posinset', '1000')
    expect(screen.getByRole('listbox')).toHaveAttribute('aria-activedescendant', lastRow?.id)
  })

  it('空态和结果态复用同一个稳定容器', () => {
    const rendered = render(
      <GlobalFileSearchResults
        result={null}
        phase="idle"
        searchedQuery=""
        locatingPath=""
        unavailablePaths={new Set()}
        onReveal={vi.fn()}
      />,
    )
    const surface = screen.getByTestId('global-file-search-results')

    rendered.rerender(
      <GlobalFileSearchResults
        result={result(1)}
        phase="completed"
        searchedQuery="report"
        locatingPath=""
        unavailablePaths={new Set()}
        onReveal={vi.fn()}
      />,
    )

    expect(screen.getByTestId('global-file-search-results')).toBe(surface)
    expect(screen.getByRole('option')).toHaveAttribute('data-row-key')
  })

  it.each([80, 81])('结果数量为 %i 时都使用固定行虚拟列表', (count) => {
    render(
      <GlobalFileSearchResults
        result={result(count)}
        phase="completed"
        searchedQuery="report"
        locatingPath=""
        unavailablePaths={new Set()}
        onReveal={vi.fn()}
      />,
    )

    const rows = screen.getAllByRole('option')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(count)
    expect(rows[0]).toHaveAttribute('data-result-index', '0')
  })

  it('空结果后二次搜索显示进行中状态', () => {
    render(
      <GlobalFileSearchResults
        result={result(0)}
        phase="running"
        searchedQuery="old-query"
        locatingPath=""
        unavailablePaths={new Set()}
        onReveal={vi.fn()}
      />,
    )

    expect(screen.getByText('files.globalSearch.searching')).toBeInTheDocument()
    expect(screen.queryByText('files.globalSearch.noResults')).not.toBeInTheDocument()
  })
})
