import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DetachedPacket } from '#common/contracts'
import { DetachedClient } from '#shared/detached-window'
import { DetachedAgentSurface } from './DetachedAgentSurface.tsx'

const flush = vi.hoisted(() => vi.fn<() => Promise<void>>())
const callbacks = vi.hoisted(() => ({ report: () => {} }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('../model/surface/agentSurfaceProjection.ts', () => ({ restoreAgentSurface: () => ({}) }))
vi.mock('../model/surface/agentRemoteAdapter.ts', () => ({ AgentRemoteAdapter: class {
  constructor(_client: unknown, report: () => void) { callbacks.report = report }
  flush = flush
  subscribe = () => () => undefined
  getSnapshot = () => 0
  connect = () => ({})
} }))
vi.mock('./AgentSurfaceView.tsx', () => ({ AgentSurfaceView: ({ interactive }: { interactive: boolean }) => <textarea aria-label="draft" disabled={!interactive} /> }))

afterEach(() => { cleanup(); vi.clearAllMocks() })

it('操作失败与交接失败分别提示，刷新只同步状态和输入回执', async () => {
  flush.mockResolvedValue(undefined)
  const connection = { module: 'agent', instance: 'workspace', generation: 'one' }
  const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
  const sent: DetachedPacket[] = []
  const client = new DetachedClient(bootstrap, {
    bootstrap: async () => bootstrap, subscribe: () => () => undefined,
    send: packet => {
      sent.push(packet)
      if (packet.operation === 'snapshot') queueMicrotask(() => client.accept({ connection, kind: 'response', id: packet.id,
        payload: { sequence: 0, full: true, partitions: {} } }))
      if (packet.kind === 'ready') queueMicrotask(() => client.accept({ connection, kind: 'ready' }))
    },
  })
  try {
    const view = render(<DetachedAgentSurface client={client} />)
    await waitFor(() => expect(view.getByRole('textbox')).toBeEnabled())
    act(() => callbacks.report())
    expect(view.getByRole('alert')).toHaveTextContent('agent.window.operationFailed')
    expect(view.getByRole('alert')).not.toHaveTextContent('agent.window.failed')
    sent.length = 0
    fireEvent.click(view.getByRole('button', { name: 'app.reload' }))
    await waitFor(() => expect(sent.some(packet => packet.operation === 'snapshot')).toBe(true))
    expect(sent.some(packet => packet.operation === 'command')).toBe(false)
    expect(flush).toHaveBeenCalledOnce()
    act(() => client.accept({ connection, kind: 'state', payload: { handoffFailed: true } }))
    expect(view.getByRole('alert')).toHaveTextContent('agent.window.failed')
  } finally { client.dispose() }
})

it('宿主取消收回后，迟到的输入确认不会淡出小窗，下一次收回仍可完成', async () => {
  let confirm!: () => void
  flush.mockImplementationOnce(() => new Promise<void>(resolve => { confirm = resolve })).mockResolvedValue(undefined)
  const connection = { module: 'agent', instance: 'workspace', generation: 'one' }
  const bootstrap = { ...connection, appearance: { theme: 'dark' as const, language: 'zh-CN' as const } }
  const sent: DetachedPacket[] = []
  const client = new DetachedClient(bootstrap, {
    bootstrap: async () => bootstrap, subscribe: () => () => undefined,
    send: packet => {
      sent.push(packet)
      if (packet.operation === 'snapshot') queueMicrotask(() => client.accept({ connection, kind: 'response', id: packet.id,
        payload: { sequence: 0, full: true, partitions: {} } }))
      if (packet.kind === 'ready') queueMicrotask(() => client.accept({ connection, kind: 'ready' }))
    },
  })
  try {
    const { getByRole, container } = render(<DetachedAgentSurface client={client} />)
    await waitFor(() => expect(getByRole('textbox')).toBeEnabled())
    act(() => client.accept({ connection, kind: 'request', operation: 'flush', id: 'first' }))
    await waitFor(() => expect(flush).toHaveBeenCalledOnce())
    expect(getByRole('textbox')).toBeDisabled()
    act(() => client.accept({ connection, kind: 'state', payload: { handoffFailed: true } }))
    await act(async () => { confirm() })
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ id: 'first', error: 'detached_operation_failed' })))
    expect(getByRole('textbox')).toBeEnabled()
    expect(container.querySelector('[data-motion="leaving"]')).toBeNull()
    act(() => client.accept({ connection, kind: 'request', operation: 'flush', id: 'retry' }))
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ id: 'retry', kind: 'response', payload: {} })))
    expect(getByRole('textbox')).toBeDisabled()
    expect(container.querySelector('[data-motion="leaving"]')).not.toBeNull()
  } finally { client.dispose() }
})
