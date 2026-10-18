import { Activity } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { afterEach, expect, test, vi } from 'vitest'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { DesktopFilesGateway, RemoteDesktopViewerState } from '#features/remote-desktop'
import { clipboardCapabilitiesFixture } from '../../../../test/systemClipboard'
import type { useDesktopFiles } from '../../model/useDesktopFiles'
import { DesktopFileClipboard } from './DesktopFileClipboard'
import { DesktopFilesPanel } from './DesktopFilesPanel'

const system = vi.hoisted(() => ({
  state: { supported: true, enabled: true, import_enabled: true, files: [], busy: false },
  prepare: vi.fn(async () => {}),
}))
vi.mock('#features/remote-desktop', async importOriginal => ({
  ...await importOriginal<typeof import('#features/remote-desktop')>(),
  useSystemFileClipboard: () => system.state,
  prepareSystemFileClipboard: system.prepare,
}))
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))

const dispose: (() => void)[] = []
afterEach(() => {
  dispose.splice(0).forEach(cleanup => cleanup())
  system.prepare.mockClear()
  system.state = { supported: true, enabled: true, import_enabled: true, files: [], busy: false }
})
function fixture() {
  const capabilities = clipboardCapabilitiesFixture()
  dispose.push(capabilities.disconnect)
  const props = {
    api: { clipboard: vi.fn(async () => ({ available: true, published: false, content_generation: 1, files: [] })) } as unknown as DesktopFilesGateway,
    session: { id: 'rdp', protocol: 'rdp', connection_generation: 1 } as RemoteDesktopSession,
    viewer: { connection: 'connected', controlOwned: true, viewOnly: false, controlLease: { id: 'viewer', generation: 1 } } as RemoteDesktopViewerState,
    operations: { busy: false, tasks: [], run: vi.fn(async action => { await action(); return true }), withGrant: vi.fn() } as unknown as ReturnType<typeof useDesktopFiles>,
    overwrite: 'rename' as const,
  }
  return { props, capabilities }
}
const keydown = (target: Element, options: KeyboardEventInit = {}) => fireEvent.keyDown(target, { key: 'v', code: 'KeyV', ctrlKey: true, ...options })

test('从抽屉导航按 Ctrl+V 准备当前会话文件，不弹文件选择器', async () => {
  const { props } = fixture()
  render(<div role="dialog"><button>文件导航</button><DesktopFileClipboard {...props} /></div>)
  expect(keydown(screen.getByText('文件导航'))).toBe(false)
  await act(async () => {})
  expect(system.prepare).toHaveBeenCalledWith('rdp')
  expect(system.prepare).toHaveBeenCalledOnce()
  expect(props.operations.withGrant).not.toHaveBeenCalled()
  expect(screen.getByText('remoteDesktop.files.systemPasteHint')).toBeVisible()
})

test('文本编辑、其它弹层、画布及非粘贴按键不接管；原生粘贴事件可使用', async () => {
  const { props } = fixture()
  render(<><div role="dialog"><button>文件导航</button><input aria-label="输入" /><div contentEditable suppressContentEditableWarning>编辑区</div><DesktopFileClipboard {...props} /></div>
    <div role="dialog"><button>其它弹窗</button></div><button>桌面画布</button></>)
  for (const target of [screen.getByRole('textbox'), screen.getByText('编辑区'), screen.getByText('其它弹窗'), screen.getByText('桌面画布')]) {
    expect(keydown(target)).toBe(true)
    expect(fireEvent.paste(target)).toBe(true)
  }
  const navigation = screen.getByText('文件导航')
  for (const options of [{ altKey: true }, { shiftKey: true }, { metaKey: true }, { ctrlKey: false }, { isComposing: true }]) expect(keydown(navigation, options)).toBe(true)
  keydown(navigation, { repeat: true })
  expect(system.prepare).not.toHaveBeenCalled()
  expect(fireEvent.paste(navigation)).toBe(false)
  await act(async () => {})
  expect(system.prepare).toHaveBeenCalledOnce()
})

test.each(['readonly', 'lost-control', 'unavailable', 'disabled', 'busy'] as const)('%s 状态不读取系统剪贴板', async condition => {
  const { props, capabilities } = fixture()
  if (condition === 'readonly') props.viewer.viewOnly = true
  if (condition === 'lost-control') props.viewer.controlOwned = false
  if (condition === 'unavailable') capabilities.update({ status: 'disconnected' })
  if (condition === 'disabled') system.state.import_enabled = false
  if (condition === 'busy') system.state.busy = true
  render(<div role="dialog"><button>文件导航</button><DesktopFileClipboard {...props} /></div>)
  keydown(screen.getByText('文件导航'))
  await act(async () => {})
  expect(system.prepare).not.toHaveBeenCalled()
})

test('接收方向、缓存隐藏及卸载时停止侧栏粘贴监听', async () => {
  const { props } = fixture()
  const tree = (visible: boolean) => <div role="dialog"><button>文件导航</button><Activity mode={visible ? 'visible' : 'hidden'}><DesktopFileClipboard {...props} /></Activity></div>
  const view = render(tree(true))
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.receiveFromDesktop' }))
  expect(keydown(screen.getByText('文件导航'))).toBe(true)
  expect(system.prepare).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.sendToDesktop' }))
  await act(async () => { view.rerender(tree(false)) })
  expect(keydown(screen.getByText('文件导航'))).toBe(true)
  expect(system.prepare).not.toHaveBeenCalled()
  await act(async () => { view.rerender(tree(true)) })
  expect(keydown(screen.getByText('文件导航'))).toBe(false)
  await act(async () => {})
  expect(system.prepare).toHaveBeenCalledOnce()
  view.unmount()
  expect(keydown(document.body)).toBe(true)
  expect(system.prepare).toHaveBeenCalledOnce()
})

test('系统文件准备尚未结束时仍能切到传输进度取消任务', async () => {
  const { props } = fixture()
  let finish!: () => void
  system.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  props.api.describe = vi.fn().mockResolvedValue({ capabilities: { file_clipboard: true }, mappings: [], exchanges: [] })
  props.api.retained = vi.fn().mockResolvedValue([])
  props.api.tasks = vi.fn().mockResolvedValue([{
    id: 'preparing', desktop_session_id: 'rdp', type: 'upload_file', status: 'running', cancellable: true,
    source_paths: ['资料.zip'], target_path: '/', total_bytes: 1024, transferred_bytes: 0,
    remaining_bytes: 1024, total_files: 1, completed_files: 0, progress_percent: 0,
    speed_bytes_per_sec: 0, average_speed_bytes_per_sec: 0, elapsed_seconds: 0, created_at: '',
  }])
  props.api.cancelTask = vi.fn().mockResolvedValue(undefined)
  render(<ConfigProvider theme={{ token: { motion: false } }}><App>
    <DesktopFilesPanel api={props.api} session={props.session} viewer={props.viewer} onClose={vi.fn()} />
  </App></ConfigProvider>)
  const clipboard = await screen.findByRole('button', { name: 'remoteDesktop.files.clipboard' })
  await act(async () => {})
  fireEvent.click(clipboard)
  keydown(clipboard)
  expect(system.prepare).toHaveBeenCalledWith('rdp')
  fireEvent.click(screen.getByRole('button', { name: 'remoteDesktop.files.taskTitle' }))
  fireEvent.click(await screen.findByRole('button', { name: 'files.cancelTransfer' }))
  await act(async () => {})
  expect(props.api.cancelTask).toHaveBeenCalledWith('preparing')
  await act(async () => { finish() })
})

test('系统准备入口已释放时显示消息，不产生未处理的异步异常', async () => {
  const { props } = fixture()
  system.prepare.mockRejectedValueOnce(new Error('desktop_not_ready'))
  render(<App><div role="dialog"><button>文件导航</button><DesktopFileClipboard {...props} /></div></App>)
  keydown(screen.getByText('文件导航'))
  await waitFor(() => expect(screen.getByText('remoteDesktop.files.errors.desktop_not_ready')).toBeVisible())
})
