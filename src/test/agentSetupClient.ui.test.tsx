import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

describe('AgentSetupClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('使用固定路由并完整提交 revision 与风险确认字段', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(settingsFixture(2)))
      .mockResolvedValueOnce(jsonResponse(settingsFixture(3)))
      .mockResolvedValueOnce(jsonResponse(readinessFixture()))
      .mockResolvedValueOnce(jsonResponse({ readiness: readinessFixture() }))
      .mockResolvedValueOnce(jsonResponse(policyFixture(3)))
      .mockResolvedValueOnce(jsonResponse({ items: [profileFixture(1)] }))
      .mockResolvedValueOnce(jsonResponse(profileFixture(1)))
      .mockResolvedValueOnce(jsonResponse(profileFixture(2)))
      .mockResolvedValueOnce(jsonResponse({ status: 'ready', latency_ms: 35, model_id: 'gpt-test', message: '' }))
      .mockResolvedValueOnce(jsonResponse(profileFixture(3, true)))
      .mockResolvedValueOnce(jsonResponse(profileFixture(4, false)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createRuntimeGatewaysFromConfig({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: 'renderer-token' }).agentSetup
    const modelInput = {
      name: 'Local model', api_mode: 'responses' as const, base_url: 'http://127.0.0.1:11434/v1', model_id: 'gpt-test',
      context_window_tokens: 8192, max_output_tokens: 1024, supports_images: false,
      supports_reasoning: true, confirm_insecure_http: true,
    }

    await client.settings()
    await client.updateSettings({ default_model_profile_id: 'amp-1', default_reasoning_level: 'high', expected_revision: 2 })
    await client.readiness()
    await client.setup()
    await client.updateMcpPolicy({ approval_bypass: true, sync_scopes: false, expected_revision: 2 })
    await client.modelProfiles('cursor/value')
    await client.createModelProfile(modelInput)
    await client.updateModelProfile('amp/1', { ...modelInput, expected_revision: 1 })
    await client.testModelProfile('amp/1', 2)
    await client.replaceModelApiKey('amp/1', 'secret-value', 2)
    await client.deleteModelApiKey('amp/1', 3)
    await client.deleteModelProfile('amp/1', 4)

    expect(requestAt(fetchMock, 1)).toMatchObject({ path: '/api/v1/agent/settings', method: 'PATCH', body: { default_model_profile_id: 'amp-1', default_reasoning_level: 'high', expected_revision: 2 } })
    expect(requestAt(fetchMock, 3)).toMatchObject({ path: '/api/v1/agent/setup', method: 'POST', body: {} })
    expect(requestAt(fetchMock, 4).body).toEqual({ approval_bypass: true, sync_scopes: false, expected_revision: 2 })
    expect(requestAt(fetchMock, 5)).toMatchObject({ path: '/api/v1/agent/model-profiles', search: '?limit=32&cursor=cursor%2Fvalue' })
    expect(requestAt(fetchMock, 7)).toMatchObject({ path: '/api/v1/agent/model-profiles/amp%2F1', method: 'PATCH', body: { ...modelInput, expected_revision: 1 } })
    expect(requestAt(fetchMock, 8).body).toEqual({ expected_revision: 2, confirm_potential_cost: true })
    expect(requestAt(fetchMock, 9).body).toEqual({ api_key: 'secret-value', expected_revision: 2 })
    expect(requestAt(fetchMock, 10)).toMatchObject({ method: 'DELETE', body: { expected_revision: 3 } })
    expect(requestAt(fetchMock, 11)).toMatchObject({ method: 'DELETE', body: { expected_revision: 4 } })
  })
})

function requestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as [URL, RequestInit]
  return { path: url.pathname, search: url.search, method: init.method ?? 'GET', body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined }
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
}

function settingsFixture(revision: number) {
  return { default_model_profile_id: 'amp-1', default_reasoning_level: 'high', revision, created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:01Z' }
}

function policyFixture(revision: number) {
  return { client_id: 'client-1', approval_bypass: false, scope_count: 29, required_scope_count: 29, scope_sync_required: false, revision }
}

function readinessFixture() {
  return { status: 'ready', mcp_runtime: { status: 'ready', message: '' }, mcp_client: { status: 'ready', message: '' }, skills_bundle: { status: 'ready', message: '' }, default_model: { status: 'ready', message: '' }, mcp_policy: policyFixture(2), settings: settingsFixture(2) }
}

function profileFixture(revision: number, apiKeyConfigured = false) {
  return { id: 'amp-1', name: 'Local model', api_mode: 'responses', base_url: 'https://example.test/v1', model_id: 'gpt-test', context_window_tokens: 8192, max_output_tokens: 1024, supports_images: false, supports_reasoning: true, api_key_configured: apiKeyConfigured, revision, created_at: '2026-08-28T00:00:00Z', updated_at: '2026-08-28T00:00:01Z' }
}
