import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import { fromJson } from '@bufbuild/protobuf'
import { RequestSchema } from '@termous/remote-protocol'
import { AgentQuery_Kind as Q } from '@termous/remote-protocol/agent'
import type { RemoteConnection, RemoteWindowBridge } from '#common/contracts'
import { RemoteClient } from '#entities/remote-control'
import { RemoteAgentSurface } from './RemoteAgentSurface'
import { createRemoteAgentGateway } from '../api/agentGateway.ts'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }))
vi.mock('#pages/agent', () => ({ AgentPage: function AgentPage({ remote, enabled, fileResources, sshResources, sshResourcesReady }: {
  remote: boolean; enabled: boolean; fileResources: unknown[]; sshResources: unknown[]; sshResourcesReady: boolean
}) {
  const [draft, setDraft] = useState('')
  return <div>
    {remote && enabled ? '被控端会话' : '错误的会话来源'}
    <input aria-label="草稿" value={draft} onChange={event => setDraft(event.target.value)} />
    <span>{sshResourcesReady ? `资源就绪：${fileResources.length} 个文件配置，${sshResources.length} 个终端` : '资源未就绪'}</span>
  </div>
} }))
vi.mock('./RemoteAgentApprovals.tsx', () => ({ RemoteAgentApprovals: () => null }))

const component = { status: 'ready', message: '' }
const readiness = { status: 'ready', mcp_runtime: component, mcp_client: component, skills_bundle: component, default_model: component,
  settings: { default_model_id: 'model', default_reasoning_level: 'medium', global_context_window_tokens: 32768, global_max_output_tokens: 4096, revision: 1, show_turn_token_usage: true,
    max_concurrent_runs: 4,
    context_compaction_threshold_percent: 80, created_at: '2026-10-05T00:00:00Z', updated_at: '2026-10-05T00:00:00Z' } }

function fixture(initialResources: unknown[] = []) {
  let error = ''
  let resourceError = ''
  let resources = initialResources
  const request = vi.fn<RemoteWindowBridge['request']>(async value => {
    const decoded = fromJson(RequestSchema, value)
    expect(decoded.operation.case).toBe('agent')
    if (decoded.operation.case !== 'agent' || decoded.operation.value.operation.case !== 'query') throw new Error('不是只读 AI 请求')
    const kind = decoded.operation.value.operation.value.kind
    if (error) return { ok: false, code: error }
    if (kind === Q.RESOURCES && resourceError) return { ok: false, code: resourceError }
    expect([Q.STATUS, Q.RESOURCES]).toContain(kind)
    return { ok: true, value: { agent: {
      type: kind === Q.STATUS ? 'readiness' : 'resources', instanceId: 'host-instance',
      json: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(kind === Q.STATUS ? readiness : { items: resources })))),
    } } }
  })
  const bridge = { request } as unknown as RemoteWindowBridge
  const client = new RemoteClient(bridge, { id: 'remote-connection' } as RemoteConnection)
  return { client, request, fail: (code: string) => { error = code }, failResources: (code: string) => { resourceError = code }, setResources: (items: unknown[]) => { resources = items } }
}

beforeEach(() => { vi.restoreAllMocks() })

test('控制端无本机 AI 时仅查询被控端，仍可进入远程会话', async () => {
  const localFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('本机 AI 不可用'))
  const { client, request } = fixture()
  expect((await createRemoteAgentGateway(client).setup.readiness()).status).toBe('ready')
  request.mockClear()
  render(<RemoteAgentSurface client={client} active />)
  expect(await screen.findByText('被控端会话')).toBeVisible()
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(localFetch).not.toHaveBeenCalled()
  expect(request.mock.calls.every(([, id]) => id === 'remote-connection')).toBe(true)
})

test.each([
  ['remote_agent_disabled', '请在被控电脑开启助手远程访问。'],
  ['remote_agent_unsupported', '被控电脑不支持远程助手，请更新应用。'],
])('被控端拒绝访问时显示具体原因且可原地重试：%s', async (code, message) => {
  const { client, request, fail } = fixture()
  fail(code)
  render(<RemoteAgentSurface client={client} active />)
  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(screen.queryByText('被控端会话')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
  fail('')
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  expect(await screen.findByText('被控端会话')).toBeVisible()
})

test('离开页面后的迟到访问结果不能重新挂载会话', async () => {
  const { client, request } = fixture()
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve })
  request.mockImplementationOnce(async () => { await gate; return { ok: false, code: 'remote_agent_disabled' } })
  const view = render(<RemoteAgentSurface client={client} active />)
  view.unmount()
  await act(async () => { finish() })
  expect(request).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

const boundAt = '2026-10-05T00:00:00Z'
const fileCandidate = (engine: string, sshProfile = '') => ({
  name: engine, binding: { kind: 'file_profile', file_access_profile_id: `file-${engine}`, file_access_profile_name: engine,
    host_id: '', host_name: '', ssh_profile_id: sshProfile, engine, bound_at: boundAt },
})

test('S3、FTP 和 SFTP 混合资源通过真实 v1 解码，不误报 AI 不可用', async () => {
  const { client } = fixture([
    fileCandidate('s3'), fileCandidate('ftp'), fileCandidate('sftp', 'ssh-one'),
    { name: 'SSH', binding: { kind: 'ssh_profile', host_id: 'host-one', host_name: '主机', ssh_profile_id: 'ssh-one', ssh_profile_name: 'SSH', platform: 'linux', bound_at: boundAt } },
    { name: 'SSH', started_at: boundAt, binding: { kind: 'ssh_session', session_id: 'terminal-one', host_id: 'host-one', host_name: '主机', ssh_profile_id: 'ssh-one', platform: 'linux', bound_at: boundAt } },
  ])
  render(<RemoteAgentSurface client={client} active />)
  expect(await screen.findByText('资源就绪：3 个文件配置，1 个终端')).toBeVisible()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('资源刷新失败单独重试，保留会话草稿且不重新检查整个工作区', async () => {
  const { client, request, failResources } = fixture([fileCandidate('ftp')])
  failResources('remote_request_failed')
  render(<RemoteAgentSurface client={client} active />)
  expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent('远端资源加载失败。')
  fireEvent.change(screen.getByRole('textbox', { name: '草稿' }), { target: { value: '尚未发送的消息' } })
  request.mockClear()
  failResources('')
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  expect(await screen.findByText('资源就绪：1 个文件配置，0 个终端')).toBeVisible()
  expect(screen.getByRole('textbox', { name: '草稿' })).toHaveValue('尚未发送的消息')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(request).toHaveBeenCalledTimes(1)
  const query = fromJson(RequestSchema, request.mock.calls[0][0]).operation
  expect(query.case === 'agent' && query.value.operation.case === 'query' && query.value.operation.value.kind).toBe(Q.RESOURCES)
})

test('资源瞬时失败自动补读，不闪出警告或丢失会话草稿', async () => {
  const { client, failResources } = fixture([fileCandidate('ftp')])
  failResources('remote_capacity_exceeded')
  render(<RemoteAgentSurface client={client} active />)
  await screen.findByText('被控端会话')
  fireEvent.change(screen.getByRole('textbox', { name: '草稿' }), { target: { value: '仍在输入' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  failResources('')
  expect(await screen.findByText('资源就绪：1 个文件配置，0 个终端')).toBeVisible()
  expect(screen.getByRole('textbox', { name: '草稿' })).toHaveValue('仍在输入')
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

test('非法文件身份仍拒绝，修正后可原地恢复资源', async () => {
  const { client, setResources } = fixture([fileCandidate('ftp', ' ')])
  render(<RemoteAgentSurface client={client} active />)
  expect(await screen.findByRole('alert')).toHaveTextContent('远端资源加载失败。')
  expect(screen.getByText('资源未就绪')).toBeVisible()
  setResources([fileCandidate('ftp')])
  fireEvent.click(screen.getByRole('button', { name: 'app.retry' }))
  expect(await screen.findByText('资源就绪：1 个文件配置，0 个终端')).toBeVisible()
})
