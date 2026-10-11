import { createRoot } from 'react-dom/client'
import { Button } from 'antd'
import { useMemo, useRef, useState } from 'react'
import { create } from '@bufbuild/protobuf'
import { ResponseSchema, SessionSchema } from '@termous/remote-protocol'
import { DesktopExchangeSchema } from '@termous/remote-protocol/desktop-protocol'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import type { TransferTask } from '#entities/file'
import type { DesktopExchange, DesktopFilesState, RemoteDesktopSession } from '#entities/remote-desktop'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import { RemoteError, type RemoteClient } from '#entities/remote-control'
import { DesktopFilesPanel } from '../../src/widgets/remote-desktop-workspace/ui/DesktopFilesPanel'
import { RemoteDesktopFiles } from '../../src/features/remote-control/ui/RemoteDesktopFiles'

// 仅供本机视觉验收：复用正式组件，不读取凭据、连接真实桌面或接触用户文件。
const parameters = new URLSearchParams(location.search)
const dense = parameters.has('dense')
const empty = parameters.has('empty')
const exchange: DesktopExchange = { id: 'fixture-exchange', session_id: 'fixture', resource_generation: 1, state: 'active', name: '文件交换', kind: 'exchange', target_path: '\\\\tsclient\\TRM00001', created_at: new Date().toISOString() }
const state: DesktopFilesState = {
  capabilities: { directory_mapping: true, exchange: true, file_clipboard: true },
  mappings: Array.from({ length: dense ? 8 : 1 }, (_, index) => ({ id: `mapping-${index}`, name: 'TRM00002', label: index ? '开发项目与共享文档目录-2026年第四季度完整交付资料' : '项目资料', state: index % 2 ? 'paused' : 'registered', remembered: true, target_path: '\\\\tsclient\\TRM00002', operation_id: 'fixture', target_access_observed: false, pending_io: 0 })),
  exchanges: empty ? [] : [exchange],
}
const task: TransferTask = { id: 'task-active', desktop_session_id: 'fixture', type: 'upload_directory', status: 'running', source_paths: ['项目文档与发布说明.zip'], target_path: '/', total_bytes: 100 * 1024 * 1024, transferred_bytes: 42 * 1024 * 1024, remaining_bytes: 58 * 1024 * 1024, total_files: 8, completed_files: 3, progress_percent: 42, speed_bytes_per_sec: 1024 * 1024, average_speed_bytes_per_sec: 1024 * 1024, elapsed_seconds: 42, cancellable: true, retryable: false, overwrite_policy: 'rename', created_at: new Date().toISOString() }
const clipboardFiles = [{ index: 0, name: '项目文档', directory: true, size: 0 }, { index: 1, name: '项目文档/这是一份用于验证长文件名截断与勾选排版的交付说明.txt', directory: false, size: 2048 }]
const unavailable = async (): Promise<never> => { throw new Error('fixture_operation_unavailable') }
const api: DesktopFilesGateway = {
  describe: async () => structuredClone(state),
  retained: async () => [{ ...exchange, id: 'retained', state: 'retained', name: '上次会话的文件', expires_at: new Date(Date.now() + 23 * 3600_000).toISOString() }],
  tasks: async () => empty ? [] : [task, { ...task, id: 'task-complete', status: 'completed', progress_percent: 100, completed_files: 8, transferred_bytes: task.total_bytes, remaining_bytes: 0, cancellable: false }, { ...task, id: 'task-failed', status: 'failed', cancellable: false, retryable: true, error_message: '测试文件读取失败' }],
  entries: async () => empty ? [] : [{ name: '项目文档', path: '/项目文档', kind: 'directory', size: 0, version: '1', modified_at: '' }, ...Array.from({ length: dense ? 24 : 2 }, (_, index) => ({ name: index ? `项目交付说明-包含中文与较长名称的归档文件-${index}.zip` : '交付说明.txt', path: `/文件-${index}`, kind: 'file' as const, size: index ? 100 * 1024 * 1024 : 2048, version: '1', modified_at: '' }))],
  mapping: async (_id, _generation, action, id) => {
    const value = state.mappings.find(mapping => mapping.id === id)
    if (!value) return unavailable()
    value.state = action === 'pause' ? 'paused' : 'registered'
    if (action === 'remove') state.mappings = state.mappings.filter(mapping => mapping.id !== id)
    return { ...value }
  },
  rememberMapping: async (_id, _generation, id, remember) => { const value = state.mappings.find(mapping => mapping.id === id); if (value) value.remembered = remember },
  createExchange: async () => exchange,
  rebindExchange: async () => exchange,
  mutate: unavailable, transfer: unavailable, clean: unavailable, grant: unavailable, releaseGrant: unavailable,
  cancelTask: unavailable, retryTask: unavailable, transferClipboard: unavailable,
  clipboard: async (_id, query) => ({ available: true, huge_files: true, locking: true, offered: true, published: true, serving: false, provided_bytes: 0, content_generation: 1, total_files: clipboardFiles.length, files: query.limit ? clipboardFiles : [], operation: query.operation_id ? { id: query.operation_id, state: 'completed', completed_bytes: 0, completed_files: 0 } : undefined }),
  requestClipboard: async (_id, query) => ({ id: query.operation_id!, state: 'completed', completed_bytes: 0, completed_files: 0 }),
}

export function Preview() {
  const [open, setOpen] = useState(true)
  const session = { id: 'fixture', protocol: 'rdp', profile_name: dense ? 'Windows · 开发工作站与项目文件传输测试环境-长连接名称' : 'Windows · 开发工作站', connection_generation: 1 } as RemoteDesktopSession
  const viewer = { connection: 'connected', controlOwned: true, viewOnly: false, controlLease: { id: 'fixture-viewer', generation: 1 } } as RemoteDesktopViewerState
  return <><Button onClick={() => setOpen(true)}>打开文件面板</Button>{open && <DesktopFilesPanel api={api} session={session} viewer={viewer} onClose={() => setOpen(false)} />}</>
}

// 首次模拟独立文件授权失败，显式重试成功；用于确认文件提示不会影响桌面视图。
export function RemotePreview() {
  const root = useRef<HTMLDivElement>(null)
  const fixture = useMemo(() => {
    let opened = false
    return {
      session: create(SessionSchema, { id: 'fixture', kind: 'desktop', engine: 'rdp', generation: 1n, state: 'streaming' }),
      desktop: { openFileExchange: async () => {
        if (!opened) { opened = true; throw new RemoteError('desktop_files_unauthorized') }
        return create(DesktopExchangeSchema, { id: 'fixture-exchange', resourceGeneration: 1n, targetPath: exchange.target_path })
      } },
      client: { request: async () => create(ResponseSchema, { result: { case: 'directory', value: { entries: [{ name: '交付说明.txt', path: '/交付说明.txt', kind: 'file', size: 2048n }] } } }) } as unknown as RemoteClient,
    }
  }, [])
  return <div ref={root} style={{ height: '100%', background: 'var(--app-bg)', padding: 16 }}>
    <RemoteDesktopFiles {...fixture} available localTasks={[]} changed={() => {}} getContainer={() => root.current!} />
  </div>
}

createRoot(document.getElementById('root')!).render(<TermousUiProvider language={parameters.has('en') ? 'en-US' : 'zh-CN'} theme={parameters.has('light') ? 'light' : 'dark'}>{parameters.has('remote') ? <RemotePreview /> : <Preview />}</TermousUiProvider>)
