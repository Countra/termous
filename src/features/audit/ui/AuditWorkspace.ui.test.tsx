import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ConfigProvider } from 'antd'
import type { AuditEvent, AuditPage } from '#entities/audit'
import { changeLanguage } from '#shared/i18n'
import type { AuditGateway } from '../api/auditGateway.ts'
import { AuditWorkspace } from './AuditWorkspace'
import { AuditDetailsPanel } from './AuditDetailsPanel'
import { AuditRelatedEvents } from './AuditRelatedEvents'

beforeAll(async () => { await changeLanguage('zh-CN') })
const event: AuditEvent = { id: 'one', occurred_at: '2026-09-20T00:00:00Z', received_at: '2026-09-20T00:00:01Z', source: 'mcp', producer: 'mcp_server', level: 'info', type: 'tool', action: 'termous.hosts.list', scope: 'hosts', outcome: 'succeeded', actor_id: 'client', actor_name: 'Client', correlation_id: 'call', duration_ms: 2, summary: '', details_version: 1 }
function gateway(): AuditGateway {
  return {
    events: vi.fn(async () => ({ items: [event], next_cursor: 'next' })),
    event: vi.fn(async () => ({ ...event, details: { result: { status: 'completed' } } })),
    status: vi.fn(async () => ({ state: 'ready', queued: 0, queued_bytes: 0, dropped: 0, write_failures: 0, written: 1, retention_days: 90 })),
  }
}

describe('审计中心', () => {
  it('指定搜索范围与高级条件组合，范围切换清空分页并取消旧请求', async () => {
    const api = gateway()
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('列出主机')
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '搜索范围' }))
    fireEvent.click(await screen.findByText('执行命令', { selector: '.select-option-content span' }))
    expect(api.events).toHaveBeenCalledOnce()
    const input = screen.getByRole('textbox', { name: '关键词搜索' })
    expect(input).toHaveAttribute('placeholder', '输入命令片段，如 systemctl restart')
    fireEvent.change(input, { target: { value: 'curl --token EXACT' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, search: 'curl --token EXACT', search_field: 'command', cursor: undefined }, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: '更多筛选' }))
    fireEvent.change(await screen.findByRole('textbox', { name: '操作' }), { target: { value: 'termous.commands.dispatch' } })
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith(expect.objectContaining({ search_field: 'command', action: 'termous.commands.dispatch' }), expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: /^更多筛选/ }))
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith(expect.objectContaining({ search_field: 'command', cursor: 'next' }), expect.any(AbortSignal)))
    const calls = vi.mocked(api.events).mock.calls
    const oldSignal = calls[calls.length - 1][1]
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '搜索范围' }))
    fireEvent.click(await screen.findByText('摘要与错误', { selector: '.select-option-content span' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'curl --token EXACT', search_field: 'summary', action: 'termous.commands.dispatch', cursor: undefined }), expect.any(AbortSignal)))
    expect(oldSignal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50 }, expect.any(AbortSignal)))
    expect(input).toHaveValue('')
    expect(input).toHaveAttribute('placeholder', '搜索命令、路径、发起者、目标或错误摘要')
  })

  it('关键词自动查询并重置分页，支持清除、回车和组合输入', async () => {
    const api = gateway()
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('列出主机')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: 'next' }, expect.any(AbortSignal)))
    const input = screen.getByRole('textbox', { name: '关键词搜索' })
    fireEvent.change(input, { target: { value: 'curl' } })
    fireEvent.change(input, { target: { value: 'curl --token EXACT' } })
    expect(api.events).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, search: 'curl --token EXACT' }, expect.any(AbortSignal)))
    expect(api.events).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'zhong' } })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
    expect(api.events).toHaveBeenCalledTimes(3)
    fireEvent.compositionEnd(input, { target: { value: '中文_100%' } })
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, search: '中文_100%' }, expect.any(AbortSignal)))

    fireEvent.change(input, { target: { value: 'task-123' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, search: 'task-123' }, expect.any(AbortSignal)))
    fireEvent.change(input, { target: { value: '' } })
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, search: undefined }, expect.any(AbortSignal)))

    fireEvent.change(input, { target: { value: 'pending' } })
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)) })
    expect(input).toHaveValue('')
    expect(api.events).toHaveBeenLastCalledWith({ limit: 50 }, expect.any(AbortSignal))
  })

  it('新关键词取消旧查询，旧结果不能覆盖新结果', async () => {
    const api = gateway()
    let finishOld: (page: AuditPage) => void = () => undefined
    let oldSignal: AbortSignal | undefined
    api.events = vi.fn(async (query, signal) => {
      if (query.search === 'old') {
        oldSignal = signal
        return new Promise<AuditPage>((resolve) => { finishOld = resolve })
      }
      return { items: [{ ...event, actor_name: query.search === 'new' ? '新结果' : '初始结果' }] }
    })
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('初始结果')
    const input = screen.getByRole('textbox', { name: '关键词搜索' })
    fireEvent.change(input, { target: { value: 'old' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(oldSignal).toBeDefined())
    fireEvent.change(input, { target: { value: 'new' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await screen.findByText('新结果')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { finishOld({ items: [{ ...event, actor_name: '旧结果' }] }) })
    expect(screen.queryByText('旧结果')).not.toBeInTheDocument()
    expect(screen.getByText('新结果')).toBeInTheDocument()
  })

  it('命令详情保留原始凭据参数、长文本和 HTML 字面量', async () => {
    const api = gateway()
    const command = `curl --token KEEP_EXACT\n${'x'.repeat(6000)}\n<script>literal</script>`
    api.event = vi.fn(async () => ({ ...event, action: 'termous.commands.dispatch', details: { parameters: { command } } }))
    render(<ConfigProvider><AuditDetailsPanel api={api} id="one" onClose={vi.fn()} onSelect={vi.fn()} /></ConfigProvider>)
    await screen.findByText('操作参数')
    const fields = screen.getByRole('dialog').querySelector('dd')
    expect(fields?.textContent).toBe(command)
    expect(screen.getByRole('dialog').querySelector('script')).toBeNull()
  })

  it('手动刷新、游标翻页及重置保留明确的请求边界', async () => {
    const api = gateway()
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('列出主机')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: 'next' }, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByRole('button', { name: '上一页' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '上一页' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined }, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByRole('button', { name: '刷新' })).not.toHaveClass('ant-btn-loading'))
    fireEvent.click(screen.getByRole('button', { name: '刷新' }))
    await waitFor(() => expect(api.events).toHaveBeenCalledTimes(4))
  })

  it('详情按需获取，关联事件与未知版本 JSON 作为文本呈现', async () => {
    const api = gateway()
    api.event = vi.fn(async () => ({ ...event, details_version: 2, details: { content: '<img src=x onerror=alert(1)>' } }))
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    fireEvent.click(await screen.findByText('列出主机'))
    expect(api.event).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: event.action })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '详情' }))
    await screen.findByText('详情版本 2 暂不支持结构化展示，以下提供只读 JSON')
    expect(api.event).toHaveBeenCalledWith('one', expect.any(AbortSignal))
    await waitFor(() => expect(api.events).toHaveBeenCalledWith({ correlation_id: 'call', from: new Date(0).toISOString(), limit: 50, sort_by: 'received_at', sort_order: 'asc' }, expect.any(AbortSignal)))
    fireEvent.click(screen.getByText('查看审计 JSON'))
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument()
    expect(document.querySelector('img[src="x"]')).toBeNull()
    expect(screen.getByText(event.action)).toBeInTheDocument()
  })

  it('持久化降级与查询失败不会伪装为空的正常列表', async () => {
    const api = gateway()
    api.events = vi.fn(async () => { throw new Error('unavailable') })
    api.status = vi.fn(async () => ({ state: 'degraded', queued: 2, queued_bytes: 512, dropped: 3, write_failures: 1, written: 0, retention_days: 90 }))
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('无法读取审计记录，请刷新重试')
    expect(screen.getByText('审计记录可能不完整')).toBeInTheDocument()
    expect(screen.getByText('积压 2 条 · 丢弃 3 条 · 写入失败 1 次')).toBeInTheDocument()
  })

  it('切换到另一关联链取消旧翻页，旧错误不会污染新记录', async () => {
    const api = gateway()
    let rejectMore: (error: Error) => void = () => undefined
    let oldSignal: AbortSignal | undefined
    api.events = vi.fn(async (query, signal) => {
      if (query.cursor) {
        oldSignal = signal
        return new Promise<AuditPage>((_resolve, reject) => { rejectMore = reject })
      }
      return { items: [event], next_cursor: 'next' }
    })
    api.event = vi.fn(async (id) => ({ ...event, id, correlation_id: id === 'one' ? 'call' : 'other-call' }))
    const props = { api, onClose: vi.fn(), onSelect: vi.fn() }
    const view = render(<ConfigProvider><AuditDetailsPanel {...props} id="one" /></ConfigProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    await waitFor(() => expect(oldSignal).toBeDefined())
    view.rerender(<ConfigProvider><AuditDetailsPanel {...props} id="two" /></ConfigProvider>)
    await screen.findByText('two')
    expect(oldSignal?.aborted).toBe(true)
    await act(async () => { rejectMore(new Error('旧请求失败')) })
    expect(screen.queryByText('关联事件读取失败，已加载的记录仍保留')).not.toBeInTheDocument()
  })

  it('同链切换保留已加载页，明确标记当前事件并定位详情', async () => {
    const api = gateway()
    const next = { ...event, id: 'two', outcome: 'failed' }
    api.events = vi.fn(async (query) => query.cursor ? { items: [next] } : { items: [event], next_cursor: 'next' })
    api.event = vi.fn(async (id) => ({ ...event, id }))
    const props = { api, onClose: vi.fn(), onSelect: vi.fn() }
    const scroll = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    const view = render(<ConfigProvider><AuditDetailsPanel {...props} id="one" /></ConfigProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    await screen.findByText('已加载 2 条')
    const list = screen.getByRole('list', { name: '关联事件' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('aria-current', 'step')
    fireEvent.click(within(rows[1]).getByRole('button', { name: '查看详情' }))
    expect(props.onSelect).toHaveBeenCalledWith('two')
    view.rerender(<ConfigProvider><AuditDetailsPanel {...props} id="two" /></ConfigProvider>)
    await screen.findByText('two')
    expect(api.events).toHaveBeenCalledTimes(2)
    expect(within(screen.getByRole('list', { name: '关联事件' })).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'step')
    expect(scroll).toHaveBeenCalledWith({ block: 'start' })
    expect(document.activeElement).toHaveAttribute('aria-label', '审计详情')
  })

  it('关联事件加载和失败不显示空结果，重试后恢复，关闭时取消请求', async () => {
    const api = gateway()
    let reject: (error: Error) => void = () => undefined
    api.events = vi.fn().mockImplementationOnce(() => new Promise((_resolve, rejectRequest) => { reject = rejectRequest })).mockResolvedValue({ items: [event] })
    const view = render(<ConfigProvider><AuditRelatedEvents api={api} correlationId="call" selectedId="one" onSelect={vi.fn()} /></ConfigProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('正在加载关联事件')
    expect(screen.queryByText('暂无关联事件')).not.toBeInTheDocument()
    await act(async () => { reject(new Error('offline')) })
    expect(screen.queryByText('暂无关联事件')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    await screen.findByText('当前事件')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    const signal = vi.mocked(api.events).mock.calls[1][1]
    view.unmount()
    expect(signal?.aborted).toBe(true)
  })

  it('关联翻页失败保留已有记录，重试相同游标并去重', async () => {
    const api = gateway()
    api.events = vi.fn().mockResolvedValueOnce({ items: [event], next_cursor: 'next' }).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ items: [event, { ...event, id: 'two' }] })
    render(<ConfigProvider><AuditRelatedEvents api={api} correlationId="call" selectedId="one" onSelect={vi.fn()} /></ConfigProvider>)
    fireEvent.click(await screen.findByRole('button', { name: '加载更多' }))
    await screen.findByRole('alert')
    expect(screen.getByText('当前事件')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }))
    await screen.findByText('已加载 2 条')
    expect(api.events).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next', sort_order: 'asc' }), expect.any(AbortSignal))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '加载更多' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: '关联事件' })).getAllByRole('listitem')).toHaveLength(2)
  })

  it('来源选择立即刷新，退出游标页并取消旧请求', async () => {
    const api = gateway()
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('列出主机')
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: 'next' }, expect.any(AbortSignal)))
    const calls = vi.mocked(api.events).mock.calls
    const previousSignal = calls[calls.length - 1]?.[1]
    const select = screen.getByRole('combobox', { name: '来源' })
    fireEvent.mouseDown(select)
    fireEvent.click(await screen.findByText('AI 助手', { selector: '.select-option-content span' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, source: 'ai_assistant', cursor: undefined }, expect.any(AbortSignal)))
    expect(previousSignal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: '应用筛选' })).not.toBeInTheDocument()
  })

  it('文本筛选与重置自动查询，较慢的旧响应不能覆盖新结果', async () => {
    const api = gateway()
    let resolveOld: (page: AuditPage) => void = () => undefined
    api.events = vi.fn(async (query) => {
      if (query.action === 'old') return new Promise<AuditPage>((resolve) => { resolveOld = resolve })
      return { items: [event] }
    })
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('列出主机')
    fireEvent.click(screen.getByRole('button', { name: '更多筛选' }))
    const input = await screen.findByRole('textbox', { name: '操作' })
    fireEvent.change(input, { target: { value: 'old' } })
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, action: 'old', cursor: undefined }, expect.any(AbortSignal)))
    fireEvent.change(input, { target: { value: event.action } })
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, action: event.action, cursor: undefined }, expect.any(AbortSignal)))
    await act(async () => { resolveOld({ items: [{ ...event, id: 'old', action: 'outdated.action' }] }) })
    expect(screen.queryByText('outdated.action')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50 }, expect.any(AbortSignal)))
  })

  it('AntD 表头排序查询完整结果并重置游标，后续翻页保留排序', async () => {
    const api = gateway()
    render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('列出主机')
    expect(screen.getByRole('columnheader', { name: /接收时间/ })).not.toHaveAttribute('aria-sort')
    fireEvent.click(screen.getByRole('columnheader', { name: /接收时间/ }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, sort_by: 'received_at', sort_order: 'asc' }, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('columnheader', { name: /耗时/ }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, sort_by: 'duration_ms', sort_order: 'asc' }, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: 'next', sort_by: 'duration_ms', sort_order: 'asc' }, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('columnheader', { name: /耗时/ }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, sort_by: 'duration_ms', sort_order: 'desc' }, expect.any(AbortSignal)))
    expect(screen.getByRole('columnheader', { name: /耗时/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('columnheader', { name: /详情/ })).not.toHaveAttribute('aria-sort')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: '来源' }))
    fireEvent.click(await screen.findByText('AI 助手', { selector: '.select-option-content span' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, source: 'ai_assistant', sort_by: 'duration_ms', sort_order: 'desc' }, expect.any(AbortSignal)))
    fireEvent.click(screen.getByRole('button', { name: '重置' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, sort_by: 'duration_ms', sort_order: 'desc' }, expect.any(AbortSignal)))

    fireEvent.click(screen.getByRole('columnheader', { name: /耗时/ }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: undefined, sort_by: undefined, sort_order: undefined }, expect.any(AbortSignal)))
    expect(screen.getByRole('columnheader', { name: /耗时/ })).not.toHaveAttribute('aria-sort')
    expect(screen.getByRole('columnheader', { name: /接收时间/ })).not.toHaveAttribute('aria-sort')
    await waitFor(() => expect(screen.getByRole('button', { name: '下一页' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(api.events).toHaveBeenLastCalledWith({ limit: 50, cursor: 'next', sort_by: undefined, sort_order: undefined }, expect.any(AbortSignal)))
  })

  it('拖拽和键盘调整列宽不触发排序，宽度受限且固定详情列从左侧调整', async () => {
    const api = gateway()
    const view = render(<ConfigProvider><AuditWorkspace api={api} /></ConfigProvider>)
    await screen.findByText('列出主机')
    const actionResize = screen.getByRole('separator', { name: '调整操作列宽' })
    fireEvent.mouseDown(actionResize, { button: 0, clientX: 200 })
    fireEvent.mouseMove(window, { clientX: 300 })
    fireEvent.mouseUp(window)
    expect(actionResize).toHaveAttribute('aria-valuenow', '320')
    fireEvent.click(screen.getByRole('columnheader', { name: /操作/ }))
    fireEvent.click(actionResize)
    fireEvent.keyDown(actionResize, { key: 'Enter', keyCode: 13 })
    expect(screen.getByRole('columnheader', { name: /操作/ })).not.toHaveAttribute('aria-sort')
    fireEvent.keyDown(actionResize, { key: 'ArrowLeft' })
    expect(actionResize).toHaveAttribute('aria-valuenow', '304')
    fireEvent.mouseDown(actionResize, { button: 0, clientX: 300 })
    fireEvent.mouseMove(window, { clientX: -1000 })
    fireEvent.mouseUp(window)
    expect(actionResize).toHaveAttribute('aria-valuenow', '140')

    const detailsResize = screen.getByRole('separator', { name: '调整详情列宽' })
    fireEvent.mouseDown(detailsResize, { button: 0, clientX: 400 })
    fireEvent.mouseMove(window, { clientX: 360 })
    fireEvent.mouseUp(window)
    expect(detailsResize).toHaveAttribute('aria-valuenow', '130')
    expect(api.events).toHaveBeenCalledTimes(1)

    fireEvent.mouseDown(detailsResize, { button: 0, clientX: 360 })
    view.unmount()
    fireEvent.mouseMove(window, { clientX: 320 })
    fireEvent.mouseUp(window)
    expect(api.events).toHaveBeenCalledTimes(1)
  })
})
