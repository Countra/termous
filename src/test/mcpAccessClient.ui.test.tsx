import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntimeGatewaysFromConfig } from '#app/data-runtime'

describe('McpAccessClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('使用冻结的管理路由、revision 请求体和动态 WebSocket 地址', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(statusFixture(4)))
      .mockResolvedValueOnce(jsonResponse(statusFixture(5)))
      .mockResolvedValueOnce(jsonResponse({ client: clientFixture(1), token: 'tmcp_once' }))
      .mockResolvedValueOnce(jsonResponse(clientFixture(2)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ client: clientFixture(4), token: 'tmcp_rotated' }))
      .mockResolvedValueOnce(jsonResponse(approvalSnapshotFixture()))
      .mockResolvedValueOnce(jsonResponse({ approval: approvalFixture('dispatching') }))
    vi.stubGlobal('fetch', fetchMock)
    const client = createRuntimeGatewaysFromConfig({
      apiBaseUrl: 'http://127.0.0.1:49217',
      apiToken: 'renderer-token',
    }).mcpAccess

    await client.status()
    await client.updateSettings({ enabled: true, expected_revision: 4 })
    const created = await client.createClient({
      name: 'Codex',
      approval_bypass: true,
      scopes: ['hosts:read', 'sessions:read'],
    })
    const updated = await client.patchClient('client/1', {
      name: 'Codex',
      enabled: false,
      approval_bypass: false,
      scopes: ['hosts:read'],
      expected_revision: 1,
    })
    const deleted = await client.deleteClient('client/1', 2)
    const rotated = await client.issueClientToken('client/1', 3)
    await client.approvals()
    await client.decideApproval('approval/1', 'approve', 9)

    expect(requestAt(fetchMock, 0)).toMatchObject({ path: '/api/v1/mcp/status', method: 'GET' })
    expect(requestAt(fetchMock, 1)).toMatchObject({
      path: '/api/v1/mcp/settings',
      method: 'PUT',
      body: { enabled: true, expected_revision: 4 },
    })
    expect(requestAt(fetchMock, 2)).toMatchObject({
      path: '/api/v1/mcp/clients',
      method: 'POST',
      body: { name: 'Codex', approval_bypass: true, scopes: ['hosts:read', 'sessions:read'] },
    })
    expect(created.client).toMatchObject({ source: 'external', read_only: false })
    expect(requestAt(fetchMock, 3)).toMatchObject({
      path: '/api/v1/mcp/clients/client%2F1',
      method: 'PATCH',
      body: {
        name: 'Codex',
        enabled: false,
        approval_bypass: false,
        scopes: ['hosts:read'],
        expected_revision: 1,
      },
    })
    expect(updated).toMatchObject({ source: 'external', read_only: false })
    expect(requestAt(fetchMock, 4)).toMatchObject({
      path: '/api/v1/mcp/clients/client%2F1',
      method: 'DELETE',
      body: { expected_revision: 2 },
    })
    expect(deleted).toBeUndefined()
    expect(requestAt(fetchMock, 5)).toMatchObject({
      path: '/api/v1/mcp/clients/client%2F1/token',
      method: 'POST',
      body: { expected_revision: 3 },
    })
    expect(rotated.client).toMatchObject({ source: 'external', read_only: false })
    expect(requestAt(fetchMock, 6)).toMatchObject({ path: '/api/v1/mcp/approvals', method: 'GET' })
    expect(requestAt(fetchMock, 7)).toMatchObject({
      path: '/api/v1/mcp/approvals/approval%2F1/decisions',
      method: 'POST',
      body: { decision: 'approve', expected_revision: 9 },
    })
    expect(client.approvalEventsUrl()).toBe(
      'ws://127.0.0.1:49217/api/v1/mcp/approvals/events?token=renderer-token',
    )
  })
})

function requestAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  const [url, init] = fetchMock.mock.calls[index] as [URL, RequestInit]
  return {
    path: url.pathname,
    method: init.method ?? 'GET',
    body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
  }
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  })
}

function statusFixture(revision: number) {
  return {
    instance_id: 'instance-1',
    enabled: true,
    revision,
    state: 'enabled',
    endpoint: 'http://127.0.0.1:49217/mcp',
    protocol_version: '2025-11-25',
  }
}

function clientFixture(revision: number) {
  return {
    id: 'client-1',
    name: 'Codex',
    source: 'external',
    enabled: true,
    scopes: ['hosts:read', 'sessions:read'],
    host_access_mode: 'all_saved',
    token_prefix: 'tmcp_abcd',
    revision,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:01:00Z',
  }
}

function approvalSnapshotFixture() {
  return { instance_id: 'instance-1', revision: 10, items: [approvalFixture('pending')] }
}

function approvalFixture(state: string) {
  return {
    id: 'approval-1',
    revision: 9,
    client_id: 'client-1',
    client_name: 'Codex',
    client_request_id: 'request-1',
    command: 'uname -s',
    session_ids: ['session-1'],
    targets: [{
      id: 'session-1',
      host_id: 'host-1',
      status: 'connected',
      started_at: '2026-08-13T00:00:00Z',
      host_key_confirmation_required: false,
      owned_by_client: false,
    }],
    state,
    created_at: '2026-08-13T00:01:00Z',
    updated_at: '2026-08-13T00:01:01Z',
    expires_at: '2026-08-13T00:03:00Z',
  }
}
