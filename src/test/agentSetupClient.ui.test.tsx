import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

describe('AgentSetupClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('使用固定 Provider/目录路由并完整提交 revision 与风险确认字段', async () => {
    const timeoutSpy = vi.spyOn(window, 'setTimeout')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(settingsFixture(2)))
      .mockResolvedValueOnce(jsonResponse(settingsFixture(3)))
      .mockResolvedValueOnce(jsonResponse(readinessFixture()))
      .mockResolvedValueOnce(jsonResponse({ readiness: readinessFixture() }))
      .mockResolvedValueOnce(jsonResponse(policyFixture(3)))
      .mockResolvedValueOnce(jsonResponse({ items: [providerFixture(1)] }))
      .mockResolvedValueOnce(jsonResponse(providerFixture(1)))
      .mockResolvedValueOnce(jsonResponse(providerFixture(2)))
      .mockResolvedValueOnce(jsonResponse({ status: 'ready', latency_ms: 35, model_count: 1, message: '' }))
      .mockResolvedValueOnce(jsonResponse(providerFixture(3, false, 'ready')))
      .mockResolvedValueOnce(jsonResponse({ items: [modelFixture(1)] }))
      .mockResolvedValueOnce(jsonResponse(modelFixture(1)))
      .mockResolvedValueOnce(jsonResponse(modelFixture(2)))
      .mockResolvedValueOnce(jsonResponse({ status: 'ready', latency_ms: 30, model_id: 'gpt-test', message: '' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'renderer-token',
    }).agentSetup

    await client.settings()
    await client.updateSettings({ default_model_id: 'apm-1', default_reasoning_level: 'high', expected_revision: 2 })
    await client.readiness()
    await client.setup()
    await client.updateMcpPolicy({ approval_bypass: true, sync_scopes: false, expected_revision: 2 })
    await client.modelProviders('cursor/value')
    await client.createModelProvider({ ...providerInput(), api_key: 'secret-value' })
    await client.updateModelProvider('apv/1', {
      ...providerInput(), remove_api_key: true, expected_revision: 1,
    })
    await client.testModelProvider('apv/1', 2)
    await client.refreshProviderModels('apv/1', 2)
    await client.models('apv/1', 'model/cursor')
    await client.model('apm/1')
    await client.updateModel('apm/1', { ...modelInput(), expected_revision: 1 })
    await client.testModel('apm/1', 2)
    await client.deleteModelProvider('apv/1', 5)

    expect(requestAt(fetchMock, 1)).toMatchObject({
      path: '/api/v1/agent/settings', method: 'PATCH',
      body: { default_model_id: 'apm-1', default_reasoning_level: 'high', expected_revision: 2 },
    })
    expect(requestAt(fetchMock, 5)).toMatchObject({
      path: '/api/v1/agent/model-providers', search: '?limit=16&cursor=cursor%2Fvalue',
    })
    expect(requestAt(fetchMock, 7)).toMatchObject({
      path: '/api/v1/agent/model-providers/apv%2F1', method: 'PATCH',
      body: { ...providerInput(), remove_api_key: true, expected_revision: 1 },
    })
    expect(requestAt(fetchMock, 8).body).toEqual({ expected_revision: 2 })
    expect(requestAt(fetchMock, 6).body).toEqual({ ...providerInput(), api_key: 'secret-value' })
    expect(requestAt(fetchMock, 9)).toMatchObject({
      path: '/api/v1/agent/model-providers/apv%2F1/models/refresh', method: 'POST',
      body: { expected_revision: 2 },
    })
    expect(requestAt(fetchMock, 10)).toMatchObject({
      path: '/api/v1/agent/models', search: '?limit=100&provider_id=apv%2F1&cursor=model%2Fcursor',
    })
    expect(requestAt(fetchMock, 12)).toMatchObject({
      path: '/api/v1/agent/models/apm%2F1', method: 'PATCH',
      body: { ...modelInput(), expected_revision: 1 },
    })
    expect(requestAt(fetchMock, 13).body).toEqual({ expected_revision: 2, confirm_potential_cost: true })
    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Function), 25_000)
    expect(requestAt(fetchMock, 14)).toMatchObject({ method: 'DELETE', body: { expected_revision: 5 } })
  })
})

function requestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as [URL, RequestInit]
  return {
    path: url.pathname, search: url.search, method: init.method ?? 'GET',
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
}

function settingsFixture(revision: number) {
  return {
    default_model_id: 'apm-1', default_reasoning_level: 'high', revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:01Z',
  }
}

function policyFixture(revision: number) {
  return {
    client_id: 'client-1', approval_bypass: false, scope_count: 29,
    required_scope_count: 29, scope_sync_required: false, revision,
  }
}

function readinessFixture() {
  return {
    status: 'ready', mcp_runtime: { status: 'ready', message: '' },
    mcp_client: { status: 'ready', message: '' }, skills_bundle: { status: 'ready', message: '' },
    default_model: { status: 'ready', message: '' }, mcp_policy: policyFixture(2), settings: settingsFixture(2),
  }
}

function providerInput() {
  return {
    name: 'Local provider', api_mode: 'responses' as const,
    base_url: 'http://127.0.0.1:11434/v1', enabled: true, confirm_insecure_http: true,
  }
}

function providerFixture(revision: number, apiKeyConfigured = false, refreshStatus = 'ready') {
  return {
    id: 'apv-1', name: 'Local provider', api_mode: 'responses', base_url: 'https://example.test/v1',
    enabled: true, api_key_configured: apiKeyConfigured, refresh_status: refreshStatus, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:01Z',
  }
}

function modelInput() {
  return {
    display_name: 'GPT Test', context_window_tokens: 8192, max_output_tokens: 1024,
    supports_images: false, supports_reasoning: true, capabilities_confirmed: true as const,
  }
}

function modelFixture(revision: number) {
  return {
    id: 'apm-1', provider_id: 'apv-1', remote_model_id: 'gpt-test', display_name: 'GPT Test',
    availability: 'available', context_window_tokens: 8192, max_output_tokens: 1024,
    supports_images: false, supports_reasoning: true, capabilities_confirmed: false, revision,
    created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:01Z',
  }
}
