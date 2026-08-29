import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeStatus, TermousBridge } from '#common/contracts'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

describe('AgentWorkspaceClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'termous')
  })

  it('使用固定 HTTP/WS 路由、稳定游标和类型化 Runtime IPC', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ items: [sessionFixture()] }))
      .mockResolvedValueOnce(jsonResponse(sessionFixture()))
      .mockResolvedValueOnce(jsonResponse(sessionFixture()))
      .mockResolvedValueOnce(jsonResponse({ ...sessionFixture(), revision: 2 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ items: [messageFixture()] }))
      .mockResolvedValueOnce(jsonResponse(contextFixture()))
      .mockResolvedValueOnce(jsonResponse(runFixture()))
      .mockResolvedValueOnce(jsonResponse(runFixture()))
      .mockResolvedValueOnce(jsonResponse({ ...runFixture(), status: 'stopping', revision: 2 }))
      .mockResolvedValueOnce(jsonResponse({ items: [runEventFixture()] }))
      .mockResolvedValueOnce(jsonResponse({ items: [modelFixture()] }))
      .mockResolvedValueOnce(jsonResponse(policyFixture()))
    vi.stubGlobal('fetch', fetchMock)

    const start = vi.fn().mockResolvedValue(commandResult())
    const stop = vi.fn().mockResolvedValue(commandResult())
    const steer = vi.fn().mockResolvedValue(commandResult())
    const onStatus = vi.fn().mockReturnValue(() => undefined)
    Object.defineProperty(window, 'termous', {
      configurable: true,
      value: {
        agentRuntime: {
          getStatus: vi.fn().mockResolvedValue(runtimeStatus()),
          start,
          stop,
          steer,
          onStatus,
        },
      } satisfies Partial<TermousBridge>,
    })
    const gateway = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:8122',
      apiToken: 'renderer-token',
    }).agentWorkspace

    await gateway.sessions({ archived: false, cursor: 'cursor/value', limit: 50 })
    await gateway.session('ags/1')
    await gateway.createSession(sessionInput())
    await gateway.updateSession('ags/1', { ...sessionInput(), archived: false, expected_revision: 1 })
    await gateway.deleteSession('ags/1', 2)
    await gateway.messages('ags/1', { afterSequence: 4, limit: 80 })
    await gateway.context('ags/1')
    const run = await gateway.createRun('ags/1', {
      client_request_id: 'request-1', prompt: '检查主机', attachment_ids: [],
      force_context_compression: true,
    })
    await gateway.run('agr/1')
    await gateway.stopRun('agr/1', 1)
    await gateway.runEvents('agr/1', { generation: 2, afterSequence: 7, limit: 20 })
    await gateway.modelProfiles('model/cursor')
    await gateway.updateMcpPolicy({
      approval_bypass: true, sync_scopes: false, expected_revision: 3,
    })
    await gateway.runtimeStatus()
    await gateway.startRuntime(run)
    await gateway.stopRuntime(run)
    await gateway.steerRuntime(run, '补充要求')
    gateway.onRuntimeStatus(() => undefined)()

    expect(requestAt(fetchMock, 0)).toMatchObject({
      path: '/api/v1/agent/sessions',
      search: '?limit=50&archived=false&cursor=cursor%2Fvalue',
    })
    expect(requestAt(fetchMock, 1).path).toBe('/api/v1/agent/sessions/ags%2F1')
    expect(requestAt(fetchMock, 3)).toMatchObject({
      method: 'PATCH', body: { ...sessionInput(), archived: false, expected_revision: 1 },
    })
    expect(requestAt(fetchMock, 4)).toMatchObject({
      method: 'DELETE', body: { expected_revision: 2 },
    })
    expect(requestAt(fetchMock, 5)).toMatchObject({
      path: '/api/v1/agent/sessions/ags%2F1/messages',
      search: '?limit=80&after_sequence=4',
    })
    expect(requestAt(fetchMock, 6).path).toBe('/api/v1/agent/sessions/ags%2F1/context')
    expect(requestAt(fetchMock, 7).body).toEqual({
      client_request_id: 'request-1', prompt: '检查主机', attachment_ids: [],
      force_context_compression: true,
    })
    expect(requestAt(fetchMock, 9)).toMatchObject({
      path: '/api/v1/agent/runs/agr%2F1/stop',
      method: 'POST', body: { expected_revision: 1 },
    })
    expect(requestAt(fetchMock, 10)).toMatchObject({
      path: '/api/v1/agent/runs/agr%2F1/events',
      search: '?generation=2&after_sequence=7&limit=20',
    })
    expect(requestAt(fetchMock, 11).search).toBe('?limit=32&cursor=model%2Fcursor')
    expect(requestAt(fetchMock, 12).body).toEqual({
      approval_bypass: true, sync_scopes: false, expected_revision: 3,
    })
    expect(gateway.eventsUrl()).toBe('ws://127.0.0.1:8122/api/v1/agent/events?token=renderer-token')
    expect(start).toHaveBeenCalledWith({ run_id: 'agr-run', generation: 1 })
    expect(stop).toHaveBeenCalledWith({ run_id: 'agr-run', generation: 1 })
    expect(steer).toHaveBeenCalledWith({
      run_id: 'agr-run', generation: 1, message: '补充要求',
    })
    expect(onStatus).toHaveBeenCalledOnce()
  })
})

function requestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as [URL, RequestInit]
  return {
    path: url.pathname,
    search: url.search,
    method: init.method ?? 'GET',
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
}

function sessionInput() {
  return { title: '测试会话', model_profile_id: 'amp-model', reasoning_level: 'medium' as const }
}

function sessionFixture() {
  return {
    id: 'ags-session', ...sessionInput(), revision: 1,
    created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z',
  }
}

function messageFixture() {
  return {
    id: 'agm-assistant', session_id: 'ags-session', role: 'assistant', status: 'streaming',
    sequence: 2, revision: 1, created_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z', parts: [],
  }
}

function runFixture() {
  return {
    id: 'agr-run', client_request_id: 'request-1', session_id: 'ags-session',
    generation: 1, event_sequence: 0, status: 'running', user_message_id: 'agm-user',
    assistant_message_id: 'agm-assistant', model_profile_id: 'amp-model',
    model_snapshot: {
      api_mode: 'responses', base_url: 'https://model.example.test/v1', model_id: 'test-model',
      context_window_tokens: 32768, max_output_tokens: 4096,
      supports_images: false, supports_reasoning: true,
    },
    reasoning_level: 'medium',
    usage: { input_tokens: 0, output_tokens: 0, reasoning_tokens: 0, total_tokens: 0, estimated: false },
    revision: 1, queued_at: '2026-08-29T00:00:00Z', started_at: '2026-08-29T00:00:00Z',
    updated_at: '2026-08-29T00:00:00Z',
  }
}

function contextFixture() {
  return {
    session_id: 'ags/1', estimated_tokens: 24_000, context_window_tokens: 32_768,
    estimated: true, warning: true, compression_available: true,
  }
}

function runEventFixture() {
  return {
    id: 'age-1', run_id: 'agr-run', generation: 1, sequence: 1, kind: 'status',
    payload: { status: { status: 'running' } }, created_at: '2026-08-29T00:00:00Z',
  }
}

function modelFixture() {
  return {
    id: 'amp-model', name: '测试模型', api_mode: 'responses',
    base_url: 'https://model.example.test/v1', model_id: 'test-model',
    context_window_tokens: 32768, max_output_tokens: 4096,
    supports_images: false, supports_reasoning: true, api_key_configured: false,
    revision: 1, created_at: '2026-08-29T00:00:00Z', updated_at: '2026-08-29T00:00:00Z',
  }
}

function policyFixture() {
  return {
    client_id: 'mcp-client', approval_bypass: true, scope_count: 29,
    required_scope_count: 29, scope_sync_required: false, revision: 4,
  }
}

function runtimeStatus(): AgentRuntimeStatus {
  return { state: 'ready' }
}

function commandResult() {
  return { accepted: true, status: runtimeStatus() }
}
