import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { RemoteError } from '#entities/remote-control'
import type { RemoteAgentTransport } from '../api/agentTransport'
import { RemoteAgentApprovals } from './RemoteAgentApprovals'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'zh-CN' } }) }))
vi.mock('#features/mcp-access', () => ({
  decodeMcpApprovalSnapshot: (value: unknown) => value,
  McpApprovalDetails: () => <span>审批详情</span>, McpApprovalExpiry: () => null,
  mcpApprovalStyles: {},
}))

function fixture() {
  let refresh!: () => void
  const query = vi.fn(async () => ({ instance_id: 'core', items: [{ id: 'approval', state: 'pending', revision: 1, expires_at: new Date(Date.now() + 60_000).toISOString(), run_id: 'run', generation: 1 }] }))
  const write = vi.fn(async () => ({}))
  const transport = { query, write, client: { onEvent: (listener: (event: unknown) => void) => { refresh = () => listener({ value: { case: 'agent' } }); return () => {} } } } as unknown as RemoteAgentTransport
  render(<RemoteAgentApprovals transport={transport} />)
  fireEvent.click(screen.getByRole('button', { name: 'agent.remoteApprovals' }))
  return { query, write, refresh: () => refresh() }
}

test('批准结果未明的提示不会被后台成功补读抹掉，也不会自动重放批准', async () => {
  const { query, write, refresh } = fixture()
  write.mockRejectedValue(new RemoteError('remote_operation_uncertain', true))
  fireEvent.click(await screen.findByRole('button', { name: 'settings.mcp.approval.allowOnce' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('操作结果尚未确认')
  await waitFor(() => expect(query).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => expect(query).toHaveBeenCalledTimes(3))
  await act(async () => refresh())
  expect(screen.getByRole('alert')).toHaveTextContent('操作结果尚未确认')
  expect(write).toHaveBeenCalledTimes(1)
})

test('批准后刷新失败只提示读取失败，不误报批准结果未知', async () => {
  const { query, write, refresh } = fixture()
  const approve = await screen.findByRole('button', { name: 'settings.mcp.approval.allowOnce' })
  query.mockRejectedValue(new RemoteError('remote_request_failed'))
  fireEvent.click(approve)
  expect(await screen.findByRole('alert')).toHaveTextContent('审批更新失败')
  expect(screen.queryByText(/操作结果尚未确认/)).not.toBeInTheDocument()
  expect(approve).toBeDisabled()
  query.mockResolvedValue({ instance_id: 'core', items: [] })
  await act(async () => refresh())
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(write).toHaveBeenCalledTimes(1)
})
