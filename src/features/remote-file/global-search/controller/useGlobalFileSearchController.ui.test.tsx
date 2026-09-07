import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  FileNameSearchCapability,
  FileNameSearchResult,
} from '#entities/file'
import type { FileNameSearchGateway } from '#features/files'
import { TermousApiError } from '#shared/api'
import type { GlobalFileSearchModalProps } from '../model/types'
import { useGlobalFileSearchController } from './useGlobalFileSearchController'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function capability(
  status: FileNameSearchCapability['status'] = 'ready',
): FileNameSearchCapability {
  return {
    status,
    executable: status === 'ready' ? 'fd' : undefined,
    version: status === 'ready' ? '10.2.0' : undefined,
    minimum_version: '8.0.0',
    privilege: 'none',
    install_available: status !== 'ready' && status !== 'unsupported',
    connection_generation: 3,
  }
}

function searchResult(patch: Partial<FileNameSearchResult> = {}): FileNameSearchResult {
  return {
    items: [{ path: '/srv/report.txt', name: 'report.txt', parent_path: '/srv' }],
    returned_count: 1,
    truncated: false,
    partial: false,
    timed_out: false,
    skipped_invalid_utf8: 0,
    duration_ms: 32,
    connection_generation: 3,
    one_file_system: false,
    ...patch,
  }
}

function props(
  apiPatch: Partial<FileNameSearchGateway> = {},
  sourcePatch: Partial<GlobalFileSearchModalProps['source']> = {},
) {
  const api = {
    fileNameSearchCapability: vi.fn(async () => capability()),
    searchFileSessionNames: vi.fn(async () => searchResult()),
    installFileNameSearch: vi.fn(async () => capability()),
    ...apiPatch,
  } as FileNameSearchGateway
  return {
    api,
    open: true,
    source: {
      fileSessionId: 'file-session-1',
      connectionGeneration: 3,
      hostName: 'Test host',
      currentPath: '/srv',
      ...sourcePatch,
    },
    onReveal: vi.fn(async () => ({ status: 'revealed' as const })),
    onClose: vi.fn(),
  } satisfies GlobalFileSearchModalProps
}

describe('全局文件名搜索控制器', () => {
  it('使用精确 generation 合同并保留名称两侧的有效空格', async () => {
    const options = props()
    const view = renderHook(() => useGlobalFileSearchController(options))
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))

    act(() => view.result.current.setQuery(' report '))
    await act(async () => {
      await view.result.current.runSearch()
    })

    expect(options.api.searchFileSessionNames).toHaveBeenCalledWith(
      'file-session-1',
      {
        expected_connection_generation: 3,
        query: ' report ',
        entry_type: 'all',
        one_file_system: false,
        limit: 1_000,
        search_root: '/',
        match_mode: 'literal',
        case_mode: 'insensitive',
        match_target: 'name',
        hidden_mode: 'include',
        ignore_mode: 'bypass',
        max_depth: 0,
        extensions: [],
        exclude_globs: [],
      },
      expect.any(AbortSignal),
    )
    expect(view.result.current.result?.items[0].path).toBe('/srv/report.txt')
    expect(view.result.current.searchPhase).toBe('completed')
  })

  it('停止后续搜索时保留上一轮结果并取消对应请求', async () => {
    const pending = deferred<FileNameSearchResult>()
    const searchFileSessionNames = vi.fn()
      .mockResolvedValueOnce(searchResult())
      .mockImplementationOnce(() => pending.promise)
    const options = props({ searchFileSessionNames })
    const view = renderHook(() => useGlobalFileSearchController(options))
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))

    act(() => view.result.current.setQuery('report'))
    await act(async () => {
      await view.result.current.runSearch()
    })
    expect(view.result.current.result?.returned_count).toBe(1)

    act(() => view.result.current.setQuery('another'))
    let secondSearch!: Promise<boolean>
    act(() => {
      secondSearch = view.result.current.runSearch()
    })
    await waitFor(() => expect(view.result.current.searchPhase).toBe('running'))
    const secondSignal = searchFileSessionNames.mock.calls[1][2] as AbortSignal
    act(() => view.result.current.stopSearch())
    expect(secondSignal.aborted).toBe(true)
    await act(async () => {
      pending.resolve(searchResult({ items: [], returned_count: 0 }))
      await secondSearch
    })

    expect(view.result.current.searchPhase).toBe('cancelled')
    expect(view.result.current.result?.items[0].path).toBe('/srv/report.txt')
  })

  it('拒绝提交其他 connection generation 的迟到搜索结果', async () => {
    const options = props({
      searchFileSessionNames: vi.fn(async () => searchResult({ connection_generation: 2 })),
    })
    const view = renderHook(() => useGlobalFileSearchController(options))
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))
    act(() => view.result.current.setQuery('report'))
    await act(async () => {
      await view.result.current.runSearch()
    })

    expect(view.result.current.result).toBeNull()
    expect(view.result.current.searchPhase).toBe('failed')
    expect(view.result.current.searchError).toBe('FILE_SESSION_GENERATION_CHANGED')
  })

  it('远端搜索能力失效后清除旧状态并自动重新检测', async () => {
    const fileNameSearchCapability = vi.fn()
      .mockResolvedValueOnce(capability())
      .mockResolvedValueOnce(capability('missing'))
    const options = props({
      fileNameSearchCapability,
      searchFileSessionNames: vi.fn(async () => {
        throw new TermousApiError(
          '远端文件名搜索能力不可用',
          'SFTP_FILE_SEARCH_UNAVAILABLE',
          400,
        )
      }),
    })
    const view = renderHook(() => useGlobalFileSearchController(options))
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))

    act(() => view.result.current.setQuery('report'))
    await act(async () => {
      await view.result.current.runSearch()
    })

    await waitFor(() => {
      expect(fileNameSearchCapability).toHaveBeenCalledTimes(2)
      expect(view.result.current.capability?.status).toBe('missing')
    })
    expect(view.result.current.searchPhase).toBe('idle')
    expect(view.result.current.searchError).toBe('')
  })

  it('安装只提交后端计划哈希并在成功后进入 ready', async () => {
    const missing = {
      ...capability('missing'),
      install_plan: {
        automatic: true,
        privilege: 'sudo',
        plan_hash: 'install-plan-1',
        commands: [{ id: 'install', title: 'Install', command: 'sudo -n install fd' }],
        manual_commands: ['sudo install fd'],
        warnings: [],
      },
    } satisfies FileNameSearchCapability
    const installFileNameSearch = vi.fn(async () => capability())
    const options = props({
      fileNameSearchCapability: vi.fn(async () => missing),
      installFileNameSearch,
    })
    const view = renderHook(() => useGlobalFileSearchController(options))
    await waitFor(() => expect(view.result.current.capability?.status).toBe('missing'))

    await act(async () => {
      await view.result.current.install()
    })

    expect(installFileNameSearch).toHaveBeenCalledWith(
      'file-session-1',
      {
        expected_connection_generation: 3,
        expected_plan_hash: 'install-plan-1',
        confirmed: true,
      },
      expect.any(AbortSignal),
    )
    expect(view.result.current.capabilityPhase).toBe('ready')
  })

  it('提交类型安全的高级筛选并按维度统计启用数量', async () => {
    const options = props()
    const view = renderHook(() => useGlobalFileSearchController(options))
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))

    act(() => {
      view.result.current.setQuery('report.*')
      view.result.current.setEntryType('file')
      view.result.current.setAdvancedFilter('searchRoot', '/srv')
      view.result.current.setAdvancedFilter('matchMode', 'regex')
      view.result.current.setAdvancedFilter('extensions', ['log', 'txt'])
      view.result.current.setAdvancedFilter('modifiedAfter', '2026-08-01T00:00:00Z')
      view.result.current.setAdvancedFilter('minSizeBytes', 1_024)
    })

    expect(view.result.current.activeAdvancedFilterCount).toBe(5)
    await act(async () => {
      await view.result.current.runSearch()
    })

    expect(options.api.searchFileSessionNames).toHaveBeenCalledWith(
      'file-session-1',
      expect.objectContaining({
        search_root: '/srv',
        match_mode: 'regex',
        extensions: ['log', 'txt'],
        modified_after: '2026-08-01T00:00:00Z',
        min_size_bytes: 1_024,
      }),
      expect.any(AbortSignal),
    )

    act(() => view.result.current.resetAdvancedFilters())
    expect(view.result.current.advancedFilters.searchRoot).toBe('/')
    expect(view.result.current.activeAdvancedFilterCount).toBe(0)
  })

  it('当前目录为根目录时范围模式不再由路径值反向覆盖', async () => {
    const options = props({}, { currentPath: '/' })
    const view = renderHook(() => useGlobalFileSearchController(options))
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))

    act(() => view.result.current.setSearchScope('directory'))

    expect(view.result.current.searchScope).toBe('directory')
    expect(view.result.current.advancedFilters.searchRoot).toBe('/')

    act(() => view.result.current.resetAdvancedFilters())
    expect(view.result.current.searchScope).toBe('system')
  })

  it('关闭并重新打开相同连接时保留查询条件和上一轮结果', async () => {
    const initial: GlobalFileSearchModalProps = props()
    const view = renderHook(
      ({ value }) => useGlobalFileSearchController(value),
      { initialProps: { value: initial } },
    )
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))

    act(() => {
      view.result.current.setQuery('report')
      view.result.current.setEntryType('file')
      view.result.current.setOneFileSystem(true)
      view.result.current.setAdvancedFilter('extensions', ['txt'])
    })
    await act(async () => {
      await view.result.current.runSearch()
    })

    view.rerender({ value: { ...initial, open: false } })
    expect(view.result.current.query).toBe('report')
    expect(view.result.current.entryType).toBe('file')
    expect(view.result.current.oneFileSystem).toBe(true)
    expect(view.result.current.advancedFilters.extensions).toEqual(['txt'])
    expect(view.result.current.result?.items[0]?.path).toBe('/srv/report.txt')

    view.rerender({ value: initial })
    await waitFor(() => {
      expect(initial.api.fileNameSearchCapability).toHaveBeenCalledTimes(1)
      expect(view.result.current.capabilityPhase).toBe('ready')
    })
    expect(view.result.current.searchedQuery).toBe('report')
    expect(view.result.current.result?.items[0]?.path).toBe('/srv/report.txt')
  })

  it('隐藏弹窗时取消运行中的搜索且迟到结果不能覆盖上一轮结果', async () => {
    const pending = deferred<FileNameSearchResult>()
    const searchFileSessionNames = vi.fn()
      .mockResolvedValueOnce(searchResult())
      .mockImplementationOnce(() => pending.promise)
    const initial: GlobalFileSearchModalProps = props({ searchFileSessionNames })
    const view = renderHook(
      ({ value }) => useGlobalFileSearchController(value),
      { initialProps: { value: initial } },
    )
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))

    act(() => view.result.current.setQuery('report'))
    await act(async () => {
      await view.result.current.runSearch()
    })
    act(() => view.result.current.setQuery('another'))
    let secondSearch!: Promise<boolean>
    act(() => {
      secondSearch = view.result.current.runSearch()
    })
    await waitFor(() => expect(view.result.current.searchPhase).toBe('running'))
    const signal = searchFileSessionNames.mock.calls[1][2] as AbortSignal

    view.rerender({ value: { ...initial, open: false } })
    await waitFor(() => expect(view.result.current.searchPhase).toBe('cancelled'))
    expect(signal.aborted).toBe(true)
    expect(view.result.current.result?.items[0]?.path).toBe('/srv/report.txt')

    await act(async () => {
      pending.resolve(searchResult({
        items: [{ path: '/srv/another.txt', name: 'another.txt', parent_path: '/srv' }],
      }))
      await secondSearch
    })
    expect(view.result.current.result?.items[0]?.path).toBe('/srv/report.txt')
    expect(view.result.current.searchedQuery).toBe('report')
  })

  it('当前目录变化时保留进行中的搜索和状态并更新后续目录范围', async () => {
    const pending = deferred<FileNameSearchResult>()
    const searchFileSessionNames = vi.fn<FileNameSearchGateway['searchFileSessionNames']>(
      () => pending.promise,
    )
    const initial = props({ searchFileSessionNames })
    const view = renderHook(
      ({ value }) => useGlobalFileSearchController(value),
      { initialProps: { value: initial } },
    )
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))
    act(() => {
      view.result.current.setQuery('report')
      view.result.current.setAdvancedFilter('searchRoot', '/srv')
    })
    let search!: Promise<boolean>
    act(() => {
      search = view.result.current.runSearch()
    })
    await waitFor(() => expect(view.result.current.searchPhase).toBe('running'))
    const signal = searchFileSessionNames.mock.calls[0][2] as AbortSignal

    view.rerender({
      value: {
        ...initial,
        source: { ...initial.source, currentPath: '/var/log' },
      },
    })

    expect(signal.aborted).toBe(false)
    expect(initial.api.fileNameSearchCapability).toHaveBeenCalledTimes(1)
    expect(view.result.current.query).toBe('report')
    expect(view.result.current.advancedFilters.searchRoot).toBe('/srv')

    await act(async () => {
      pending.resolve(searchResult())
      await search
    })
    expect(view.result.current.searchPhase).toBe('completed')
    expect(view.result.current.result?.items[0]?.path).toBe('/srv/report.txt')

    act(() => {
      view.result.current.resetAdvancedFilters()
      view.result.current.setSearchScope('directory')
    })
    expect(view.result.current.searchScope).toBe('directory')
    expect(view.result.current.advancedFilters.searchRoot).toBe('/var/log')
  })

  it('连接 generation 变化时清空旧连接的搜索状态', async () => {
    const fileNameSearchCapability = vi.fn<FileNameSearchGateway['fileNameSearchCapability']>(
      async (_fileSessionId, connectionGeneration) => ({
        ...capability(),
        connection_generation: connectionGeneration,
      }),
    )
    const initial = props({ fileNameSearchCapability })
    const view = renderHook(
      ({ value }) => useGlobalFileSearchController(value),
      { initialProps: { value: initial } },
    )
    await waitFor(() => expect(view.result.current.capabilityPhase).toBe('ready'))
    act(() => view.result.current.setQuery('report'))
    await act(async () => {
      await view.result.current.runSearch()
    })
    expect(view.result.current.result).not.toBeNull()

    view.rerender({
      value: {
        ...initial,
        source: { ...initial.source, connectionGeneration: 4 },
      },
    })

    await waitFor(() => {
      expect(view.result.current.capability?.connection_generation).toBe(4)
    })
    expect(view.result.current.query).toBe('')
    expect(view.result.current.searchPhase).toBe('idle')
    expect(view.result.current.result).toBeNull()
  })
})
