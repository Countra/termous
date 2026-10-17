import { createRoot } from 'react-dom/client'
import { Button } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from '@bufbuild/protobuf'
import { ResponseSchema, SessionSchema } from '@termous/remote-protocol'
import { DesktopExchangeSchema } from '@termous/remote-protocol/desktop-protocol'
import type { DesktopFileBridge, SystemFileClipboardContext } from '#common/contracts'
import '#shared/styles'
import { TermousUiProvider } from '#app/ui-runtime'
import { AppShell } from '#app/app-shell'
import { UpdateRuntimeProvider } from '#app/update-runtime'
import type { TransferTask } from '#entities/file'
import type { DesktopExchange, DesktopFilesState, RemoteDesktopSession } from '#entities/remote-desktop'
import { systemClipboardCapabilities } from '#entities/system-clipboard'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import { isActiveTransferTask, TransferRuntimeContext, type TransferRuntimeValue } from '#features/transfers'
import { RemoteError, type RemoteClient } from '#entities/remote-control'
import { DesktopFilesPanel, type DesktopFilesTab } from '../../src/widgets/remote-desktop-workspace/ui/files/DesktopFilesPanel'
import { RemoteDesktopStatusBar } from '../../src/widgets/remote-desktop-workspace/ui/RemoteDesktopStatusBar'
import { RemoteDesktopConnectionMetricsContext, RemoteDesktopConnectionMetricsStore } from '../../src/features/remote-desktop/runtime/core/connectionMetricsStore'
import { RemoteDesktopFiles } from '../../src/features/remote-control/ui/RemoteDesktopFiles'
import { createRdpSystemFiles } from '../../src/features/remote-desktop/runtime/protocols/rdp/systemFiles'

// 仅供本机视觉验收：复用正式组件，不读取凭据、连接真实桌面或接触用户文件。
const parameters = new URLSearchParams(location.search)
const dense = parameters.has('dense')
const empty = parameters.has('empty')
const systemClipboardPreview = parameters.has('system-clipboard')
let published = !systemClipboardPreview
const exchange: DesktopExchange = { id: 'fixture-exchange', session_id: 'fixture', resource_generation: 1, state: 'active', name: '文件交换', kind: 'exchange', target_path: '\\\\tsclient\\TRM00001', created_at: new Date().toISOString() }
const state: DesktopFilesState = {
  capabilities: { directory_mapping: true, exchange: true, file_clipboard: true },
  mappings: empty ? [] : Array.from({ length: dense ? 8 : 1 }, (_, index) => ({ id: `mapping-${index}`, name: 'TRM00002', label: index ? '开发项目与共享文档目录-2026年第四季度完整交付资料' : '项目资料', state: index % 2 ? 'paused' : 'registered', remembered: true, target_path: '\\\\tsclient\\TRM00002', operation_id: 'fixture', target_access_observed: false, pending_io: 0 })),
  exchanges: empty ? [] : parameters.has('multiple') ? [exchange, { ...exchange, id: 'fixture-exchange-2', name: '发布文件' }] : [exchange],
}
const task: TransferTask = { id: 'task-active', desktop_session_id: 'fixture', type: 'upload_directory', status: 'running', source_paths: ['项目文档与发布说明.zip'], target_path: '/', total_bytes: 100 * 1024 * 1024, transferred_bytes: 42 * 1024 * 1024, remaining_bytes: 58 * 1024 * 1024, total_files: 8, completed_files: 3, progress_percent: 42, speed_bytes_per_sec: 1024 * 1024, average_speed_bytes_per_sec: 1024 * 1024, elapsed_seconds: 42, cancellable: true, retryable: false, overwrite_policy: 'rename', created_at: new Date().toISOString() }
const clipboardFiles = [{ index: 0, name: '项目文档', directory: true, size: 0 }, { index: 1, name: '项目文档/这是一份用于验证长文件名截断与勾选排版的交付说明.txt', directory: false, size: 2048 }]
const unavailable = async (): Promise<never> => { throw new Error('fixture_operation_unavailable') }
const refreshPreviewTransfers = async () => {}
const api: DesktopFilesGateway = {
  describe: async () => structuredClone(state),
  retained: async () => empty ? [] : [{ ...exchange, id: 'retained', state: 'retained', name: '上次会话的文件', expires_at: new Date(Date.now() + 23 * 3600_000).toISOString() }],
  tasks: async () => empty ? [] : [task, { ...task, id: 'task-complete', status: 'completed', progress_percent: 100, completed_files: 8, transferred_bytes: task.total_bytes, remaining_bytes: 0, cancellable: false }, { ...task, id: 'task-failed', status: 'failed', cancellable: false, retryable: true, error_message: '测试文件读取失败' }],
  entries: async () => empty || parameters.has('empty-directory') ? [] : [{ name: '项目文档', path: '/项目文档', kind: 'directory', size: 0, version: '1', modified_at: '2026-10-17T08:00:00Z' }, ...Array.from({ length: parameters.has('paginated') ? 124 : dense ? 24 : 2 }, (_, index) => ({ name: index ? `项目交付说明-包含中文与较长名称的归档文件-${index}.zip` : '交付说明.txt', path: `/文件-${index}`, kind: 'file' as const, size: index ? 100 * 1024 * 1024 : 2048, version: '1', modified_at: '2026-10-17T08:00:00Z' }))],
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
  cancelTask: unavailable, retryTask: unavailable,
  transferClipboard: async () => {
    if (!systemClipboardPreview) return unavailable()
    await new Promise(resolve => setTimeout(resolve, 250))
    published = true
    return { ...task, id: 'clipboard-prepared', status: 'completed', cancellable: false }
  },
  clipboard: async (_id, query) => ({ available: true, huge_files: true, locking: true, offered: true, published, serving: false, provided_bytes: 0, content_generation: 1, total_files: clipboardFiles.length, files: query.limit ? clipboardFiles : [], operation: query.operation_id ? { id: query.operation_id, state: 'completed', completed_bytes: 0, completed_files: 0 } : undefined }),
  requestClipboard: async (_id, query) => ({ id: query.operation_id!, state: 'completed', completed_bytes: 0, completed_files: 0 }),
}

// 系统剪贴板验收只使用模拟授权，不读取操作系统剪贴板或用户文件。
if (systemClipboardPreview) {
  const context: SystemFileClipboardContext = { sessionId: 'fixture', generation: 1, subscriptionId: 'fixture-viewer', controlGeneration: 1 }
  const bridge: DesktopFileBridge = {
    configure: async () => ({ ok: true, value: { supported: true, enabled: true, import_enabled: true, publish_enabled: true, files: [] } }),
    importClipboard: async () => parameters.get('system-clipboard') === 'text'
      ? { ok: true, value: { kind: 'text' } }
      : parameters.get('system-clipboard') === 'failed' ? { ok: false, code: 'desktop_file_clipboard_failed' }
        : { ok: true, value: { kind: 'files', sequence: 1, grant: { id: 'fixture-grant', items: [] } } },
    releaseSelection: async () => ({ ok: true, value: undefined }), consumeDrop: unavailable,
  }
  Object.defineProperty(window, 'termous', { configurable: true, value: { desktopFiles: bridge } })
  const disconnect = systemClipboardCapabilities.connect({
    get: async () => ({ version: 1, status: 'connected', snapshot: { schema_version: 1, instance_id: 'fixture', revision: 1, capabilities: { import_files: { state: 'ready' }, publish_files: { state: 'ready' } } } }),
    subscribe: () => () => {},
  })
  const runtime = createRdpSystemFiles({ id: 'fixture', api, context: () => context, focused: () => false, inputEpoch: () => 0, paste: () => { throw new Error('fixture_unexpected_remote_paste') } })
  const cleanup = () => {
    window.removeEventListener('pagehide', cleanup)
    runtime.dispose()
    disconnect()
  }
  window.addEventListener('pagehide', cleanup, { once: true })
  import.meta.hot?.dispose(cleanup)
}

export function Preview() {
  const [open, setOpen] = useState(true)
  const session = { id: 'fixture', protocol: 'rdp', profile_name: dense ? 'Windows · 开发工作站与项目文件传输测试环境-长连接名称' : 'Windows · 开发工作站', connection_generation: 1 } as RemoteDesktopSession
  const viewer = { connection: 'connected', controlOwned: true, viewOnly: parameters.has('readonly'), controlLease: { id: 'fixture-viewer', generation: 1 } } as RemoteDesktopViewerState
  return <><Button onClick={() => setOpen(true)}>打开文件面板</Button><DesktopFilesPanel open={open} api={api} session={parameters.has('no-session') ? undefined : session} viewer={viewer} onClose={() => setOpen(false)} /></>
}

function TransferStatusPreview() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<DesktopFilesTab>('exchange')
  const [connected, setConnected] = useState(true)
  const [mode, setMode] = useState<'running' | 'queued' | 'completed'>('running')
  const [progress, setProgress] = useState(42)
  useEffect(() => {
    if (mode !== 'running' || !connected) return
    const timer = setInterval(() => setProgress(value => value >= 88 ? 42 : value + 1), 1200)
    return () => clearInterval(timer)
  }, [mode, connected])
  const metrics = useMemo(() => {
    const store = new RemoteDesktopConnectionMetricsStore()
    store.activateGeneration('fixture', 1)
    store.publish('fixture', 1, { connectedAt: Date.now() - 60_000, sampledAt: Date.now(), receivedBytes: 10485760,
      sentBytes: 102400, receiveBytesPerSecond: 24576, sendBytesPerSecond: 2048, bufferedAmount: 0, outboundMeasured: true })
    store.publishSshRtt('fixture', 1, 23, Date.now())
    return store
  }, [])
  const session = { id: 'fixture', protocol: 'rdp', profile_name: 'Windows · 开发工作站', host_name: '开发主机', status: 'streaming', route: 'ssh_tunnel', connection_generation: 1 } as RemoteDesktopSession
  const viewer = { connection: 'connected', controlOwned: true, controlLease: { id: 'fixture-viewer', generation: 1 } } as RemoteDesktopViewerState
  const transfers = [task, { ...task, id: 'download', type: 'download_file' as const }].map((item, index) => ({ ...item, status: mode,
    progress_percent: mode === 'completed' ? 100 : progress, transferred_bytes: item.total_bytes * (mode === 'completed' ? 1 : progress / 100),
    speed_bytes_per_sec: index ? 524288 : 1048576, cancellable: mode !== 'completed' }))
  const runtime: TransferRuntimeValue = { transfers, activeTransfers: transfers.filter(isActiveTransferTask), connected, initialized: true,
    refresh: refreshPreviewTransfers, upsertTransfer: () => {}, removeTransfer: () => {}, remoteCopyRefreshVersion: 0, consumeRemoteCopyRefreshEvents: () => [] }
  const content = <div style={{ height: parameters.has('shell') ? '100%' : '100vh', display: 'grid', gridTemplateRows: 'auto minmax(0, 1fr)', padding: 16, gap: 12, background: 'var(--app-bg)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Button onClick={() => setOpen(true)}>打开文件面板</Button>
        <Button onClick={() => setMode('running')}>模拟传输</Button><Button onClick={() => setMode('queued')}>模拟排队</Button>
        <Button onClick={() => setMode('completed')}>模拟完成</Button><Button onClick={() => setConnected(value => !value)}>切换实时连接</Button>
      </div>
      <section data-remote-desktop-workspace="" style={{ position: 'relative', display: 'grid', minWidth: 0, gridTemplateRows: 'minmax(0, 1fr) 36px', containerName: 'remote-desktop-workspace', containerType: 'inline-size', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ display: 'grid', placeContent: 'center', background: 'var(--surface-subtle)', color: 'var(--text-muted)', fontSize: 13 }}>远程桌面预览 · 模拟文件传输</div>
        <RemoteDesktopStatusBar session={session} viewerState={viewer} filesOpen={open} onOpenTransfers={() => { setTab('tasks'); setOpen(true) }} />
        <DesktopFilesPanel open={open} api={api} session={session} viewer={viewer} activeTab={tab} onTabChange={setTab} onClose={() => setOpen(false)} />
      </section>
    </div>
  return <TransferRuntimeContext.Provider value={runtime}><RemoteDesktopConnectionMetricsContext.Provider value={metrics}>
    {parameters.has('shell') ? <UpdateRuntimeProvider bridge={null} notificationStorage={null}><AppShell page="remote-desktop" appVersion="0.0.0" windowCloseBehavior="exit" sidebarCollapsed actionBusy={false}
      onNavigate={() => {}} onOpenConnectionLauncher={() => {}} onOpenLocalTerminal={() => {}} onOpenProductTour={() => {}} onToggleSidebar={() => {}}>{content}</AppShell></UpdateRuntimeProvider> : content}
  </RemoteDesktopConnectionMetricsContext.Provider></TransferRuntimeContext.Provider>
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

const root = createRoot(document.getElementById('root')!)
root.render(<TermousUiProvider language={parameters.has('en') ? 'en-US' : 'zh-CN'} theme={parameters.has('light') ? 'light' : 'dark'}>{parameters.has('remote') ? <RemotePreview /> : parameters.has('transfer-status') ? <TransferStatusPreview /> : <Preview />}</TermousUiProvider>)
import.meta.hot?.dispose(() => root.unmount())
