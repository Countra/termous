import { afterEach, expect, it, vi } from 'vitest'
import { screenAnalysisDefaults, type AnalysisRecord, type WorkflowDetachedMedia } from '#common/contracts'
import type { DetachedClient } from '#shared/detached-window'
import { WorkflowClient } from '../../api/WorkflowClient'
import { WorkflowRemoteAdapter } from '../window/WorkflowRemoteAdapter'
import { WorkflowSurfaceAdapter } from '../window/WorkflowSurfaceAdapter'
import { WorkflowController } from './WorkflowController'

const root = '/api/v1/screen-analyses'
const record: AnalysisRecord = {
  id: 'analysis', state: 'queued', stage: 'queued', creator: { origin: 'local' }, source: { kind: 'preview', id: 'preview' },
  parameters: screenAnalysisDefaults, parameter_source: 'settings', settings_revision: 1,
  created_at: '2026-10-23T00:00:00Z', expires_at: '2026-10-30T00:00:00Z',
  reused: false, reuse_allowed: true, duration_ms: 0, inference_ms: 0, schema_version: 2,
}

// 只替换 HTTP 边界，保留客户端原型方法、控制器装配与独立窗口的实际转发链。
function fixture(surface: 'embedded' | 'detached') {
  const fetch = vi.fn(async (input: URL | RequestInfo, options?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/api/v1/desktop-workflow-previews') return Response.json({ id: 'preview', state: 'ready' })
    if (url.pathname === root) return options?.method === 'POST'
      ? Response.json(record, { status: 202 })
      : Response.json({ items: [record], total: 1, limited_by_inference: false })
    if (url.pathname === `${root}/analysis`) return Response.json(record)
    throw new Error(`未声明的测试请求：${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetch)
  const controller = new WorkflowController(new WorkflowClient({ apiBaseUrl: 'http://127.0.0.1:8122', apiToken: '' }))
  controller.configure({ sessions: [{ id: 'desktop', profile_name: '桌面', protocol: 'vnc', status: 'streaming', connection_generation: 1 }], profiles: [] },
    { scripts: [], runs: [], loading: false })
  const host = new WorkflowSurfaceAdapter(controller)
  const request = (operation: 'binary', payload: WorkflowDetachedMedia) => host.handle({
    connection: { module: 'desktop-workflow', instance: 'workspace', generation: 'test' },
    kind: 'request', operation, payload: structuredClone(payload),
  })
  const remote = new WorkflowRemoteAdapter({ peer: { request } } as unknown as DetachedClient, vi.fn())
  return { controller, fetch, media: surface === 'embedded' ? controller.media : remote.media }
}

afterEach(() => vi.unstubAllGlobals())

it.each(['embedded', 'detached'] as const)('%s 通过真实控制器和客户端提交画面分析并读取状态', async surface => {
  const { controller, fetch, media } = fixture(surface)
  try {
    const preview = await media.openPreview('desktop', 1)
    const input = { request_id: 'request', source: { kind: 'preview' as const, id: preview.id } }
    await expect(media.submitAnalysis(input)).resolves.toEqual(record)
    const submission = fetch.mock.calls.find(([url, options]) => new URL(String(url)).pathname === root && options?.method === 'POST')
    expect(JSON.parse(submission![1]!.body as string)).toEqual(input)
    await expect(media.getAnalysis(record.id)).resolves.toEqual(record)
  } finally { controller.dispose() }
})

it.each(['embedded', 'detached'] as const)('%s 通过真实控制器和客户端查询历史并保留接口错误', async surface => {
  const { controller, fetch, media } = fixture(surface)
  try {
    const { listAnalyses } = media
    await expect(listAnalyses({ q: '测试桌面', state: 'queued', limit: 20 })).resolves.toMatchObject({ items: [record], total: 1 })
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.pathname).toBe(root)
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '测试桌面', state: 'queued', limit: '20' })
    fetch.mockResolvedValueOnce(Response.json({ error: { code: 'analysis_storage_unavailable', message: '记录存储暂不可用' } }, { status: 503 }))
    await expect(listAnalyses()).rejects.toMatchObject({ code: 'analysis_storage_unavailable', status: 503, message: '记录存储暂不可用' })
  } finally { controller.dispose() }
})
