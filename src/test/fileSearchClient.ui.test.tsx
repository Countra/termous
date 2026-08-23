import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

function createAbortablePendingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const rejectWithAbort = () => reject(new DOMException('请求已中止', 'AbortError'))
    if (init?.signal?.aborted) {
      rejectWithAbort()
      return
    }
    init?.signal?.addEventListener('abort', rejectWithAbort, { once: true })
  }))
}

describe('FileSearchClient', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('能力检测的前端期限覆盖后端完整检测窗口', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', createAbortablePendingFetch())
    const client = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:18131',
      apiToken: 'test-token',
    }).files

    const request = client.fileNameSearchCapability('file-session-1', 3)
    const assertion = expect(request).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(19_999)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await assertion
  })

  it('完整序列化结构化高级搜索参数', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      items: [],
      returned_count: 0,
      truncated: false,
      partial: false,
      timed_out: false,
      skipped_invalid_utf8: 0,
      duration_ms: 1,
      connection_generation: 3,
      one_file_system: true,
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:18131',
      apiToken: 'test-token',
    }).files

    await client.searchFileSessionNames('file-session/id', {
      expected_connection_generation: 3,
      query: 'report.*',
      entry_type: 'file',
      one_file_system: true,
      limit: 1_000,
      search_root: '/srv',
      match_mode: 'regex',
      case_mode: 'smart',
      match_target: 'full_path',
      hidden_mode: 'exclude',
      ignore_mode: 'respect',
      max_depth: 8,
      extensions: ['log'],
      exclude_globs: ['**/archive/**'],
      modified_after: '2026-08-01T00:00:00Z',
      modified_before: '2026-08-20T00:00:00Z',
      min_size_bytes: 1_024,
      max_size_bytes: 8_192,
    })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe(
      'http://127.0.0.1:18131/api/v1/file-sessions/file-session%2Fid/files/name-search',
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      expected_connection_generation: 3,
      query: 'report.*',
      entry_type: 'file',
      one_file_system: true,
      limit: 1_000,
      search_root: '/srv',
      match_mode: 'regex',
      case_mode: 'smart',
      match_target: 'full_path',
      hidden_mode: 'exclude',
      ignore_mode: 'respect',
      max_depth: 8,
      extensions: ['log'],
      exclude_globs: ['**/archive/**'],
      modified_after: '2026-08-01T00:00:00Z',
      modified_before: '2026-08-20T00:00:00Z',
      min_size_bytes: 1_024,
      max_size_bytes: 8_192,
    })
  })
})
