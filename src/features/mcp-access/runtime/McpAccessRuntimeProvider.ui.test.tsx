import { act, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { McpApproval, McpClient, McpStatus } from '#entities/mcp-access'
import type { McpAccessGateway } from '../api/mcpAccessGateway'
import { useMcpAccessRuntime, type McpAccessRuntimeValue } from './mcpAccessContext'
import { McpAccessRuntimeProvider } from './McpAccessRuntimeProvider'

describe('McpAccessRuntimeProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('使用 revision 删除客户端、移除已决定审批且不保存一次性令牌', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const initialClient = clientFixture()
    const initialApproval = approvalFixture()
    const createdClient = { ...initialClient, id: 'client-2', name: 'New client', revision: 1 }
    let serverClients = [initialClient]
    let serverApprovals = [initialApproval]
    const gateway = gatewayFixture({
      clients: vi.fn(async () => serverClients),
      createClient: vi.fn(async () => {
        serverClients = [createdClient, ...serverClients]
        return { client: createdClient, token: 'tmcp_once' }
      }),
      deleteClient: vi.fn(async () => {
        serverClients = serverClients.filter((client) => client.id !== initialClient.id)
      }),
      approvals: vi.fn(async () => ({ instance_id: 'instance-1', revision: 10, items: serverApprovals })),
      decideApproval: vi.fn(async () => {
        const decided = { ...initialApproval, state: 'dispatching' as const, revision: 4 }
        serverApprovals = []
        return { approval: decided }
      }),
    })
    let runtime: McpAccessRuntimeValue | null = null

    render(
      <McpAccessRuntimeProvider api={gateway} enabled>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </McpAccessRuntimeProvider>,
    )
    await waitFor(() => expect(runtime?.phase).toBe('ready'))

    let token = ''
    await act(async () => {
      token = (await runtime!.createClient({
        name: 'New client',
        scopes: ['hosts:read', 'sessions:read'],
      })).token
    })
    expect(token).toBe('tmcp_once')
    expect(JSON.stringify(runtime)).not.toContain('tmcp_once')

    await act(async () => runtime!.deleteClient(initialClient.id))
    expect(gateway.deleteClient).toHaveBeenCalledWith(initialClient.id, initialClient.revision)
    expect(runtime!.clients.some((client) => client.id === initialClient.id)).toBe(false)
    expect(runtime!.clients.some((client) => client.id === createdClient.id)).toBe(true)

    await act(async () => runtime!.decideApproval(initialApproval.id, 'approve'))
    expect(gateway.decideApproval).toHaveBeenCalledWith(
      initialApproval.id,
      'approve',
      initialApproval.revision,
    )
    expect(runtime!.approvals).toEqual([])
  })

  it('管理写操作会淘汰在途旧快照并以最新权威状态收口', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    let serverStatus = statusFixture()
    let serverClients = [clientFixture()]
    const status = vi.fn(async () => ({ ...serverStatus }))
    const clients = vi.fn(async () => serverClients.map((client) => ({ ...client, scopes: [...client.scopes] })))
    const updateSettings: McpAccessGateway['updateSettings'] = vi.fn(async (input) => {
      serverStatus = {
        ...serverStatus,
        enabled: input.enabled,
        state: input.enabled ? 'enabled' : 'disabled',
        revision: serverStatus.revision + 1,
      }
      return { ...serverStatus }
    })
    const createClient: McpAccessGateway['createClient'] = vi.fn(async (input) => {
      const created = { ...clientFixture(), id: 'client-2', name: input.name, scopes: input.scopes, revision: 1 }
      serverClients = [created, ...serverClients]
      return { client: created, token: 'tmcp_new_once' }
    })
    const patchClient: McpAccessGateway['patchClient'] = vi.fn(async (clientId, input) => {
      const current = serverClients.find((client) => client.id === clientId)!
      const updated = { ...current, ...input, revision: current.revision + 1 }
      serverClients = serverClients.map((client) => client.id === clientId ? updated : client)
      return updated
    })
    const deleteClient: McpAccessGateway['deleteClient'] = vi.fn(async (clientId) => {
      serverClients = serverClients.filter((client) => client.id !== clientId)
    })
    const gateway = gatewayFixture({ status, clients, updateSettings, createClient, patchClient, deleteClient })
    let runtime: McpAccessRuntimeValue | null = null

    render(
      <McpAccessRuntimeProvider api={gateway} enabled>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </McpAccessRuntimeProvider>,
    )
    await waitFor(() => expect(runtime?.phase).toBe('ready'))

    const staleStatus = deferred<McpStatus>()
    status.mockImplementationOnce(() => staleStatus.promise)
    let staleReconcile!: Promise<void>
    act(() => { staleReconcile = runtime!.reload() })
    await act(async () => runtime!.setEnabled(false))
    await waitFor(() => expect(runtime!.status).toMatchObject({ enabled: false, revision: 5 }))
    await act(async () => {
      staleStatus.resolve(statusFixture())
      await staleReconcile
    })
    expect(runtime!.status).toMatchObject({ enabled: false, revision: 5 })

    const staleBeforeCreate = deferred<McpStatus>()
    status.mockImplementationOnce(() => staleBeforeCreate.promise)
    act(() => { staleReconcile = runtime!.reload() })
    await act(async () => runtime!.createClient({ name: 'New client', scopes: ['hosts:read'] }))
    await waitFor(() => expect(runtime!.clients.some((client) => client.id === 'client-2')).toBe(true))
    await act(async () => {
      staleBeforeCreate.resolve({ ...serverStatus })
      await staleReconcile
    })
    expect(runtime!.clients.some((client) => client.id === 'client-2')).toBe(true)

    const staleBeforePatch = deferred<McpStatus>()
    status.mockImplementationOnce(() => staleBeforePatch.promise)
    act(() => { staleReconcile = runtime!.reload() })
    await act(async () => runtime!.patchClient('client-1', { name: 'Edited client' }))
    await waitFor(() => expect(runtime!.clients.find((client) => client.id === 'client-1')?.name).toBe('Edited client'))
    await act(async () => {
      staleBeforePatch.resolve({ ...serverStatus })
      await staleReconcile
    })
    expect(runtime!.clients.find((client) => client.id === 'client-1')?.name).toBe('Edited client')

    const staleBeforeDelete = deferred<McpStatus>()
    status.mockImplementationOnce(() => staleBeforeDelete.promise)
    act(() => { staleReconcile = runtime!.reload() })
    await act(async () => runtime!.deleteClient('client-1'))
    expect(deleteClient).toHaveBeenCalledWith('client-1', 8)
    expect(runtime!.clients.some((client) => client.id === 'client-1')).toBe(false)
    await act(async () => {
      staleBeforeDelete.resolve({ ...serverStatus })
      await staleReconcile
    })
    expect(runtime!.clients.some((client) => client.id === 'client-1')).toBe(false)
  })

  it('运行时切换期间完成的旧写操作会触发当前网关对账', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const update = deferred<McpStatus>()
    const previousGateway = gatewayFixture({
      updateSettings: vi.fn(() => update.promise),
    })
    const currentStatus = { ...statusFixture(), revision: 20 }
    const currentGateway = gatewayFixture({
      status: vi.fn().mockResolvedValue(currentStatus),
      clients: vi.fn().mockResolvedValue([]),
      approvals: vi.fn().mockResolvedValue({
        instance_id: 'instance-2',
        revision: 1,
        items: [],
      }),
    })
    let runtime: McpAccessRuntimeValue | null = null
    const view = render(
      <McpAccessRuntimeProvider api={previousGateway} enabled>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </McpAccessRuntimeProvider>,
    )
    await waitFor(() => expect(runtime?.phase).toBe('ready'))

    let mutation!: Promise<void>
    act(() => { mutation = runtime!.setEnabled(false) })
    view.rerender(
      <McpAccessRuntimeProvider api={currentGateway} enabled>
        <RuntimeCapture onRuntime={(value) => { runtime = value }} />
      </McpAccessRuntimeProvider>,
    )
    await act(async () => {
      update.resolve({ ...statusFixture(), enabled: false, state: 'disabled', revision: 5 })
      await mutation
    })

    await waitFor(() => expect(runtime!.status).toEqual(currentStatus))
    expect(currentGateway.status).toHaveBeenCalled()
  })
})

function RuntimeCapture({ onRuntime }: { onRuntime: (runtime: McpAccessRuntimeValue) => void }) {
  onRuntime(useMcpAccessRuntime())
  return null
}

class FakeWebSocket extends EventTarget {
  constructor(readonly url: string) {
    super()
  }

  close() {
    this.dispatchEvent(new Event('close'))
  }
}

function gatewayFixture(overrides: Partial<McpAccessGateway> = {}): McpAccessGateway {
  const unsupported = vi.fn(() => Promise.reject(new Error('本测试不调用此接口')))
  return {
    status: vi.fn().mockResolvedValue(statusFixture()),
    updateSettings: unsupported,
    clients: vi.fn().mockResolvedValue([clientFixture()]),
    createClient: unsupported,
    patchClient: unsupported,
    deleteClient: unsupported,
    issueClientToken: unsupported,
    approvals: vi.fn().mockResolvedValue({
      instance_id: 'instance-1',
      revision: 10,
      items: [approvalFixture()],
    }),
    decideApproval: unsupported,
    approvalEventsUrl: () => 'ws://termous.test/api/v1/mcp/approvals/events',
    ...overrides,
  }
}

function statusFixture(): McpStatus {
  return {
    instance_id: 'instance-1',
    enabled: true,
    revision: 4,
    state: 'enabled',
    endpoint: 'http://127.0.0.1:18131/mcp',
    protocol_version: '2025-11-25',
  }
}

function clientFixture(): McpClient {
  return {
    id: 'client-1',
    name: 'Codex',
    enabled: true,
    scopes: ['hosts:read', 'sessions:read'],
    host_access_mode: 'all_saved',
    token_prefix: 'tmcp_abcd',
    revision: 7,
    created_at: '2026-08-13T00:00:00Z',
    updated_at: '2026-08-13T00:01:00Z',
  }
}

function approvalFixture(): McpApproval {
  return {
    id: 'approval-1',
    revision: 3,
    client_id: 'client-1',
    client_name: 'Codex',
    client_request_id: 'request-1',
    kind: 'command',
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
    state: 'pending',
    created_at: '2026-08-13T00:01:00Z',
    updated_at: '2026-08-13T00:01:01Z',
    expires_at: '2026-08-13T00:03:00Z',
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => { resolve = next })
  return { promise, resolve }
}
