import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConfigProvider } from 'antd'
import { TermousUiProvider } from '#app/ui-runtime'
import { McpAccessRuntimeProvider, McpApprovalCoordinator } from '#features/mcp-access'
import { McpAccessClient } from './mcpAccessClient'

afterEach(() => {
  vi.unstubAllGlobals()
  ApprovalSocket.instances = []
})

for (const kind of ['desktop', 'desktop_workflow']) {
  for (const delivery of ['snapshot', 'event'] as const) {
    it.each(['approve', 'reject'] as const)(`${kind} 通过 ${delivery} 展示真实弹窗并提交 %s`, async decision => {
      const fixture = setup(kind, delivery)
      await fixture.show()
      const dialog = await screen.findByRole('dialog')
      await waitFor(() => expect(within(dialog).getByText('本机桌面')).toBeVisible())
      expect(within(dialog).getByText('本机桌面：显示器 1')).toBeVisible()
      expect(within(dialog).getByText(/键盘输入影响当前系统焦点/)).toBeVisible()
      expect(within(dialog).queryByText('HOST_DESKTOP')).toBeNull()
      expect(within(dialog).queryByText('连接标识')).toBeNull()
      if (kind === 'desktop_workflow') expect(within(dialog).getByText('释放本次桌面绑定')).toBeVisible()
      expect(fixture.decisions).toEqual([])

      fireEvent.click(within(dialog).getByRole('button', { name: decision === 'approve' ? '仅本次允许' : '拒绝' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(fixture.decisions).toEqual([{ decision, expected_revision: 7 }])

      // 已处理的旧快照不能让刚刚关闭的审批弹窗复活。
      act(() => fixture.socket().emit({ type: 'mcp_approval_update', snapshot: fixture.pendingSnapshot }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(fixture.decisions).toHaveLength(1)
    })
  }
}

it.each(['cancelled', 'expired'])('本机请求进入 %s 时移除弹窗，不替用户作出审批决定', async state => {
  const fixture = setup('desktop', 'event')
  await fixture.show()
  await screen.findByRole('dialog')
  act(() => fixture.socket().emit({ type: 'mcp_approval_update', snapshot: {
    ...fixture.pendingSnapshot, revision: 3, items: [{ ...fixture.approval, state, revision: 8 }],
  } }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(fixture.decisions).toEqual([])
})

function setup(kind: string, delivery: 'snapshot' | 'event') {
  const now = new Date().toISOString()
  const approval = {
    id: 'approval-local', revision: 7, kind, state: 'pending', client_id: 'builtin-agent',
    client_name: 'Termous Agent', client_request_id: 'request-local', created_at: now, updated_at: now,
    expires_at: new Date(Date.now() + 120_000).toISOString(),
    operation: {
      domain: kind, action: kind === 'desktop' ? 'control.acquire' : 'run', resource_kind: 'host_desktop',
      resource_id: 'display-0', resource_name: '本机桌面：显示器 1', mode: 'observe_to_control', timeout_seconds: 1800,
      ...(kind === 'desktop_workflow' ? { script_id: 'script-1', script_version: 2, run_id: 'run-1',
        lifecycle: 'binding_only', target_resource_name: '打开设置', item_count: 2 } : {}),
    },
  }
  const pendingSnapshot = { instance_id: 'core-1', revision: 2, items: [approval] }
  let snapshot = delivery === 'snapshot' ? pendingSnapshot : { ...pendingSnapshot, revision: 1, items: [] }
  const decisions: unknown[] = []
  // 仅替换传输边界，客户端解码、状态订阅、弹窗和决定回执均使用生产实现。
  vi.stubGlobal('WebSocket', ApprovalSocket)
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
    const path = new URL(String(input)).pathname
    if (path === '/api/v1/mcp/status') return Response.json({ instance_id: 'core-1', enabled: true,
      revision: 1, state: 'enabled', endpoint: 'http://termous.test/mcp', protocol_version: '2025-11-25' })
    if (path === '/api/v1/mcp/clients') return Response.json([{
      id: 'builtin-agent', name: 'Termous Agent', source: 'builtin_agent', read_only: true, enabled: true,
      approval_bypass: false, scopes: ['host-desktop:read', 'host-desktop:capture', 'host-desktop:control'],
      host_access_mode: 'all_saved', token_prefix: '', revision: 1, created_at: now, updated_at: now,
    }])
    if (path === '/api/v1/mcp/approvals') return Response.json(snapshot)
    if (path === '/api/v1/mcp/approvals/approval-local/decisions' && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)) as { decision: string }
      decisions.push(body)
      snapshot = { ...snapshot, revision: 3, items: [] }
      return Response.json({ approval: { ...approval, revision: 8,
        state: body.decision === 'approve' ? 'dispatching' : 'rejected' } })
    }
    throw new Error(`验收不允许访问其他接口：${path}`)
  }))
  render(<TermousUiProvider language="zh-CN" theme="dark">
    <ConfigProvider theme={{ token: { motion: false } }}>
      <McpAccessRuntimeProvider api={new McpAccessClient({ apiBaseUrl: 'http://termous.test', apiToken: '' })} enabled>
        <McpApprovalCoordinator />
      </McpAccessRuntimeProvider>
    </ConfigProvider>
  </TermousUiProvider>)
  const socket = () => ApprovalSocket.instances[ApprovalSocket.instances.length - 1]!
  return { approval, pendingSnapshot, decisions, socket, show: async () => {
    await waitFor(() => expect(ApprovalSocket.instances).toHaveLength(1))
    if (delivery === 'event') {
      snapshot = pendingSnapshot
      act(() => socket().emit({ type: 'mcp_approval_update', snapshot }))
    }
  } }
}

class ApprovalSocket extends EventTarget {
  static instances: ApprovalSocket[] = []
  readyState = 1
  constructor(readonly url: string) {
    super()
    ApprovalSocket.instances.push(this)
  }
  emit(value: unknown) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })) }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')) }
}
