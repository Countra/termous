import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'
import { TermousApiError } from '#shared/api'

const API_BASE_URL = 'http://127.0.0.1:8122'

function createGateways(apiToken = 'test-token') {
  return createRuntimeGatewaysFromConfig({
    apiBaseUrl: API_BASE_URL,
    apiToken,
    version: '1.0.0-test',
  })
}

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

describe('领域 API HTTP transport 合同', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('解析 JSON、序列化请求体并保持 204 的空返回值', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'stopping' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const gateways = createGateways()

    await expect(gateways.runtime.health()).resolves.toEqual({ status: 'ok' })
    await expect(gateways.runtime.shutdown('transport-test')).resolves.toEqual({ status: 'stopping' })
    await expect(gateways.hosts.deleteConnectionProxy('proxy/id')).resolves.toBeUndefined()

    const [healthUrl, healthInit] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(healthUrl.toString()).toBe(`${API_BASE_URL}/api/v1/healthz`)
    expect(healthInit).toMatchObject({
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Termous-Token': 'test-token',
      },
    })

    const [shutdownUrl, shutdownInit] = fetchMock.mock.calls[1] as [URL, RequestInit]
    expect(shutdownUrl.toString()).toBe(`${API_BASE_URL}/api/v1/runtime/shutdown`)
    expect(shutdownInit).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ reason: 'transport-test' }),
    })

    const [deleteUrl, deleteInit] = fetchMock.mock.calls[2] as [URL, RequestInit]
    expect(deleteUrl.toString()).toBe(`${API_BASE_URL}/api/v1/proxies/proxy%2Fid`)
    expect(deleteInit.method).toBe('DELETE')
  })

  it('保留结构化 HTTP 错误的状态、错误码和详情', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'RESOURCE_CONFLICT',
        message: '资源状态已变化',
        details: { revision: 'next' },
      },
    }), { status: 409 })))

    await expect(createGateways().runtime.health()).rejects.toMatchObject({
      name: 'TermousApiError',
      message: '资源状态已变化',
      code: 'RESOURCE_CONFLICT',
      status: 409,
      details: { revision: 'next' },
    })
  })

  it('将 fetch 网络异常映射为稳定的 NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('连接被拒绝')
    }))

    await expect(createGateways().runtime.health()).rejects.toMatchObject({
      name: 'TermousApiError',
      message: '连接被拒绝',
      code: 'NETWORK_ERROR',
      status: 0,
    })
  })

  it('将调用方取消与 transport 超时区分为不同错误码', async () => {
    const fetchMock = createAbortablePendingFetch()
    vi.stubGlobal('fetch', fetchMock)
    const gateways = createGateways()
    const callerController = new AbortController()
    const canceledRequest = gateways.hostKeys.hostKeyChallenges(callerController.signal)

    callerController.abort()

    await expect(canceledRequest).rejects.toMatchObject({
      message: '请求已取消',
      code: 'REQUEST_ABORTED',
      status: 0,
    })

    vi.useFakeTimers()
    const timedOutRequest = gateways.hosts.refreshHostReachability()
    const timedOutAssertion = expect(timedOutRequest).rejects.toMatchObject({
      message: '请求超时',
      code: 'REQUEST_TIMEOUT',
      status: 0,
    })
    await vi.advanceTimersByTimeAsync(4_000)
    await timedOutAssertion
  })

  it('按 Blob 返回下载内容且不附加 JSON Content-Type', async () => {
    const fetchMock = vi.fn(async () => new Response('termous-binary', {
      headers: { 'Content-Type': 'application/octet-stream' },
      status: 200,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createGateways().files.fileOperationBlobResult('operation/id')

    expect(await result.text()).toBe('termous-binary')
    expect(result.type).toBe('application/octet-stream')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.toString()).toBe(`${API_BASE_URL}/api/v1/file-operations/operation%2Fid/blob`)
    expect(init.headers).toEqual({ 'X-Termous-Token': 'test-token' })
    expect(init.body).toBeUndefined()
  })

  it('保留 Blob 下载的结构化 HTTP 错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: {
        code: 'FILE_OPERATION_FAILED',
        message: '文件操作失败',
        details: { operationId: 'operation/id' },
      },
    }), { status: 409 })))

    await expect(createGateways().files.fileOperationBlobResult('operation/id')).rejects.toMatchObject({
      name: 'TermousApiError',
      message: '文件操作失败',
      code: 'FILE_OPERATION_FAILED',
      status: 409,
      details: { operationId: 'operation/id' },
    })
  })

  it('按文件操作合同将 Blob 下载超时映射为 REQUEST_TIMEOUT', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', createAbortablePendingFetch())

    const timedOutRequest = createGateways().files.fileOperationBlobResult('operation/id')
    const timedOutAssertion = expect(timedOutRequest).rejects.toMatchObject({
      message: '请求超时',
      code: 'REQUEST_TIMEOUT',
      status: 0,
    })
    await vi.advanceTimersByTimeAsync(90_000)
    await timedOutAssertion
  })

  it('原样提交 FormData，由运行时生成 multipart Content-Type', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'font-id' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['font-data'], 'custom.ttf', { type: 'font/ttf' })

    await createGateways().settings.uploadTerminalFont(file)

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('file')).toBeInstanceOf(File)
    expect(init.headers).toEqual({ 'X-Termous-Token': 'test-token' })
  })

  it('保持 WebSocket 与静态资源 URL 的协议、鉴权和编码规则', () => {
    const gateways = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'https://core.example.test/base?stale=1',
      apiToken: 'token value',
    })

    const websocketUrl = new URL(gateways.terminal.websocketUrl('/api/v1/events'))
    expect(websocketUrl.protocol).toBe('wss:')
    expect(websocketUrl.pathname).toBe('/api/v1/events')
    expect(websocketUrl.searchParams.get('token')).toBe('token value')
    expect(websocketUrl.searchParams.has('stale')).toBe(false)

    const fontUrl = new URL(gateways.terminal.terminalFontFileUrl('font/id', 'sha value'))
    expect(fontUrl.pathname).toBe('/api/v1/terminal-fonts/font%2Fid/file')
    expect(fontUrl.searchParams.get('token')).toBe('token value')
    expect(fontUrl.searchParams.get('sha256')).toBe('sha value')
  })

  it('所有 transport 错误仍使用公开的 TermousApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline')
    }))

    await expect(createGateways().runtime.health()).rejects.toBeInstanceOf(TermousApiError)
  })
})
