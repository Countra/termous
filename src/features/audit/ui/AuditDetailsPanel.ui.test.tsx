import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ConfigProvider } from 'antd'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuditEvent } from '#entities/audit'
import { changeLanguage } from '#shared/i18n'
import type { AuditGateway } from '../api/auditGateway.ts'
import { AuditDetailsPanel } from './AuditDetailsPanel'

beforeAll(async () => {
  await changeLanguage('zh-CN')
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})

const event: AuditEvent = { id: 'one', occurred_at: '2026-09-20T00:00:00Z', received_at: '2026-09-20T00:00:01Z', source: 'mcp', producer: 'mcp_server', level: 'info', type: 'tool', action: 'termous.hosts.list', scope: 'hosts', outcome: 'succeeded', actor_id: 'client', actor_name: 'Client', correlation_id: 'call', duration_ms: 2, summary: '第一条详情', details_version: 1 }

function gateway(): AuditGateway {
  return {
    event: vi.fn(async (id) => ({ ...event, id })),
    events: vi.fn(async () => ({ items: [event, { ...event, id: 'two' }, { ...event, id: 'three' }] })),
    status: vi.fn(),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise })
  return { promise, resolve, reject }
}

function Panel({ api, onClose }: { api: AuditGateway; onClose: () => void }) {
  const [id, setId] = useState<string | null>('one')
  return <ConfigProvider>
    <button onClick={() => setId('one')}>重新打开</button>
    <AuditDetailsPanel api={api} id={id} onSelect={setId} onClose={() => { setId(null); onClose() }} />
  </ConfigProvider>
}

function selectRelated(index: number) {
  const list = screen.getByRole('list', { name: '关联事件' })
  fireEvent.click(within(within(list).getAllByRole('listitem')[index]).getByRole('button', { name: '查看详情' }))
}

describe('审计详情关闭与切换', () => {
  it('首次加载中可关闭并取消请求，迟到响应不恢复内容，重新打开重新读取', async () => {
    const api = gateway()
    const pending = deferred<AuditEvent>()
    api.event = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ ...event, summary: '重新读取的详情' })
    const onClose = vi.fn()
    render(<Panel api={api} onClose={onClose} />)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载审计详情')
    const signal = vi.mocked(api.event).mock.calls[0][1]
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve({ ...event, summary: '迟到的详情' }) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByText('迟到的详情')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }))
    await screen.findByText('重新读取的详情')
    expect(api.event).toHaveBeenCalledTimes(2)
    expect(screen.queryByText('迟到的详情')).not.toBeInTheDocument()
  })

  it('同链切换保留旧内容但禁用交互，详情和选中关联项同步展示加载状态', async () => {
    const api = gateway()
    const pending = deferred<AuditEvent>()
    api.event = vi.fn().mockResolvedValueOnce(event).mockReturnValueOnce(pending.promise)
    render(<Panel api={api} onClose={vi.fn()} />)
    await screen.findByText('当前事件')
    const oldDetails = screen.getByText('第一条详情').parentElement
    selectRelated(1)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载审计详情')
    expect(screen.getByText('切换中…')).toBeInTheDocument()
    expect(oldDetails).toHaveAttribute('inert')
    expect(oldDetails).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByLabelText('审计详情', { selector: '[data-loading]' })).toHaveAttribute('aria-busy', 'true')
    await act(async () => { pending.resolve({ ...event, id: 'two', summary: '第二条详情' }) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('切换中…')).not.toBeInTheDocument()
    expect(screen.queryByText('第一条详情')).not.toBeInTheDocument()
    expect(screen.getByText('第二条详情').parentElement).not.toHaveAttribute('inert')
    expect(screen.getByLabelText('审计详情', { selector: '[data-loading]' })).toHaveFocus()
    expect(api.events).toHaveBeenCalledOnce()
  })

  it('连续切换取消旧请求，较慢的旧结果不会覆盖最新详情', async () => {
    const api = gateway()
    const second = deferred<AuditEvent>()
    const third = deferred<AuditEvent>()
    api.event = vi.fn().mockResolvedValueOnce(event).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    render(<Panel api={api} onClose={vi.fn()} />)
    await screen.findByText('当前事件')
    selectRelated(1)
    const secondSignal = vi.mocked(api.event).mock.calls[1][1]
    selectRelated(2)
    expect(secondSignal?.aborted).toBe(true)
    await act(async () => { third.resolve({ ...event, id: 'three', summary: '最新详情' }) })
    await act(async () => { second.resolve({ ...event, id: 'two', summary: '过时详情' }) })
    expect(screen.getByText('最新详情')).toBeInTheDocument()
    expect(screen.queryByText('过时详情')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(api.events).toHaveBeenCalledOnce()
  })

  it('切换失败撤销加载遮罩、保留关联列表，能切回先前的事件', async () => {
    const api = gateway()
    const pending = deferred<AuditEvent>()
    api.event = vi.fn().mockResolvedValueOnce(event).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(event)
    render(<Panel api={api} onClose={vi.fn()} />)
    await screen.findByText('当前事件')
    selectRelated(1)
    await act(async () => { pending.reject(new Error('offline')) })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByText('第一条详情')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('无法读取审计记录')
    expect(screen.getByRole('list', { name: '关联事件' })).toBeInTheDocument()
    selectRelated(0)
    await screen.findByText('第一条详情')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(api.events).toHaveBeenCalledOnce()
  })

  it('切换中关闭同时取消详情和关联请求，旧失败不污染重新打开的抽屉', async () => {
    const api = gateway()
    const pending = deferred<AuditEvent>()
    api.event = vi.fn().mockResolvedValueOnce(event).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(event)
    const onClose = vi.fn()
    render(<Panel api={api} onClose={onClose} />)
    await screen.findByText('当前事件')
    selectRelated(1)
    const detailSignal = vi.mocked(api.event).mock.calls[1][1]
    const relatedSignal = vi.mocked(api.events).mock.calls[0][1]
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(detailSignal?.aborted).toBe(true)
    expect(relatedSignal?.aborted).toBe(true)
    await act(async () => { pending.reject(new Error('旧详情失败')) })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '重新打开' }))
    await screen.findByText('第一条详情')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('首次详情失败可原位重试，恢复加载状态并取消前一次请求', async () => {
    const api = gateway()
    const pending = deferred<AuditEvent>()
    api.event = vi.fn().mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(pending.promise)
    render(<Panel api={api} onClose={vi.fn()} />)
    const alert = await screen.findByRole('alert')
    const previousSignal = vi.mocked(api.event).mock.calls[0][1]
    fireEvent.click(within(alert).getByRole('button', { name: /重\s*试/ }))
    expect(previousSignal?.aborted).toBe(true)
    expect(api.event).toHaveBeenLastCalledWith('one', expect.any(AbortSignal))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载审计详情')
    await act(async () => { pending.resolve(event) })
    await screen.findByText('当前事件')
    expect(screen.getByText('第一条详情')).toBeInTheDocument()
    expect(screen.getByLabelText('审计详情', { selector: '[data-loading]' })).toHaveFocus()
  })

  it('关联详情重试保留关联列表及当前项，关闭会取消重试且拒绝迟到结果', async () => {
    const api = gateway()
    const pending = deferred<AuditEvent>()
    api.event = vi.fn().mockResolvedValueOnce(event).mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(pending.promise)
    const onClose = vi.fn()
    render(<Panel api={api} onClose={onClose} />)
    await screen.findByText('当前事件')
    const list = screen.getByRole('list', { name: '关联事件' })
    selectRelated(1)
    fireEvent.click(within(await screen.findByRole('alert')).getByRole('button', { name: /重\s*试/ }))
    expect(screen.getByRole('list', { name: '关联事件' })).toBe(list)
    expect(screen.getByText('切换中…')).toBeInTheDocument()
    expect(api.events).toHaveBeenCalledOnce()
    expect(api.event).toHaveBeenLastCalledWith('two', expect.any(AbortSignal))
    const signal = vi.mocked(api.event).mock.calls[2][1]
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(signal?.aborted).toBe(true)
    await act(async () => { pending.resolve({ ...event, id: 'two', summary: '迟到重试结果' }) })
    expect(screen.queryByText('迟到重试结果')).not.toBeInTheDocument()
  })
})
