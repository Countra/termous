import { App as AntdApp } from 'antd'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { FileNameSearchEntryType } from '#entities/file'
import {
  countGlobalFileSearchAdvancedFilters,
  createDefaultGlobalFileSearchAdvancedFilters,
} from '../model/globalFileSearchModel'
import type {
  GlobalFileSearchAdvancedFilters,
  GlobalFileSearchScope,
} from '../model/types'
import { GlobalFileSearchFilters } from './GlobalFileSearchFilters'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number }) => (
      values?.count === undefined ? key : `${key}:${values.count}`
    ),
  }),
}))

function FiltersHarness({
  entryType = 'all',
  currentPath = '/srv/projects',
}: {
  entryType?: FileNameSearchEntryType
  currentPath?: string
}) {
  const [filters, setFilters] = useState(createDefaultGlobalFileSearchAdvancedFilters)
  const [oneFileSystem, setOneFileSystem] = useState(false)
  const [searchScope, setSearchScope] = useState<GlobalFileSearchScope>('system')
  const setFilter = <Key extends keyof GlobalFileSearchAdvancedFilters>(
    key: Key,
    value: GlobalFileSearchAdvancedFilters[Key],
  ) => setFilters((current) => ({ ...current, [key]: value }))
  const changeSearchScope = (value: GlobalFileSearchScope) => {
    setSearchScope(value)
    setFilter('searchRoot', value === 'system' ? '/' : currentPath)
  }

  return (
    <AntdApp>
      <GlobalFileSearchFilters
        filters={filters}
        entryType={entryType}
        oneFileSystem={oneFileSystem}
        searchScope={searchScope}
        currentPath={currentPath}
        activeCount={countGlobalFileSearchAdvancedFilters(filters)}
        disabled={false}
        onFilterChange={setFilter}
        onOneFileSystemChange={setOneFileSystem}
        onSearchScopeChange={changeSearchScope}
        onReset={() => setFilters(createDefaultGlobalFileSearchAdvancedFilters())}
      />
    </AntdApp>
  )
}

describe('GlobalFileSearchFilters', () => {
  it('目录范围和文件系统限制统一计数并可重置', async () => {
    render(<FiltersHarness />)

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.filters.action',
    }))
    fireEvent.click(await screen.findByText('files.globalSearch.filters.directory'))

    expect(screen.getByRole('textbox', {
      name: 'files.globalSearch.filters.searchRoot',
    })).toHaveValue('/srv/projects')
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByLabelText('files.globalSearch.filters.active:2')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.filters.reset',
    }))
    expect(screen.queryByRole('textbox', {
      name: 'files.globalSearch.filters.searchRoot',
    })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('files.globalSearch.filters.active:2')).not.toBeInTheDocument()
  })

  it('当前目录为根目录时仍能切换到指定目录', async () => {
    render(<FiltersHarness currentPath="/" />)

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.filters.action',
    }))
    fireEvent.click(await screen.findByText('files.globalSearch.filters.directory'))

    expect(screen.getByRole('textbox', {
      name: 'files.globalSearch.filters.searchRoot',
    })).toHaveValue('/')
  })

  it('多值过滤以标签输入呈现且不显示下拉入口', async () => {
    render(<FiltersHarness />)

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.filters.action',
    }))
    const extensions = await screen.findByRole('combobox', {
      name: 'files.globalSearch.filters.extensions',
    })
    const excludeGlobs = screen.getByRole('combobox', {
      name: 'files.globalSearch.filters.excludeGlobs',
    })

    expect(extensions.closest('.ant-select')?.querySelector('.ant-select-arrow')).toBeNull()
    expect(excludeGlobs.closest('.ant-select')?.querySelector('.ant-select-arrow')).toBeNull()

    fireEvent.change(extensions, { target: { value: 'pyc' } })
    fireEvent.keyDown(extensions, { key: 'Enter', code: 'Enter' })
    expect(await screen.findByText('pyc')).toBeInTheDocument()
  })

  it('日期范围复用统一的日期时间选择器', async () => {
    render(<FiltersHarness />)

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.filters.action',
    }))
    const modifiedAfter = await screen.findByRole('textbox', {
      name: 'files.globalSearch.filters.modifiedAfter',
    })
    const modifiedBefore = screen.getByRole('textbox', {
      name: 'files.globalSearch.filters.modifiedBefore',
    })

    expect(modifiedAfter).not.toHaveAttribute('type', 'datetime-local')
    expect(modifiedBefore).not.toHaveAttribute('type', 'datetime-local')
    expect(modifiedAfter.closest('.ant-picker')).toBeInTheDocument()
    expect(modifiedBefore.closest('.ant-picker')).toBeInTheDocument()
  })

  it('文件大小使用单一外框的数值与单位组合控件', async () => {
    render(<FiltersHarness entryType="file" />)

    fireEvent.click(screen.getByRole('button', {
      name: 'files.globalSearch.filters.action',
    }))
    const minimum = await screen.findByRole('spinbutton', {
      name: 'files.globalSearch.filters.minSize (MiB)',
    })
    const maximum = screen.getByRole('spinbutton', {
      name: 'files.globalSearch.filters.maxSize (MiB)',
    })
    const minimumControl = minimum.closest('.ant-space-compact') as HTMLElement
    const maximumControl = maximum.closest('.ant-space-compact') as HTMLElement

    expect(within(minimumControl).getByText('MiB')).toBeInTheDocument()
    expect(within(maximumControl).getByText('MiB')).toBeInTheDocument()
    expect(minimum.closest('.ant-input-number-group-wrapper')).toBeNull()
    expect(maximum.closest('.ant-input-number-group-wrapper')).toBeNull()
  })
})
