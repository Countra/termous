import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { describe, expect, it, vi } from 'vitest'
import type { Run, Script, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import { useState } from 'react'
import { sessionTarget, type WorkflowTarget } from '../model/target'
import { RunDialog } from './RunDialog'
import { WorkflowWorkspace } from './WorkflowWorkspace'
import { RunReport } from './RunReport'
import { ParameterDialog } from './ParameterDialog'
import { ScreenshotEditor } from './ScreenshotEditor'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
class SocketFixture {
  static current: SocketFixture
  constructor() { SocketFixture.current = this }
  onopen?: () => void; onclose?: () => void; onmessage?: () => void
  close() {}
}
function gateway(): WorkflowGateway {
  return { list: vi.fn().mockResolvedValue([]), listRuns: vi.fn().mockResolvedValue([]), get: vi.fn(), save: vi.fn(), remove: vi.fn(), versions: vi.fn(), restore: vi.fn(), validate: vi.fn().mockResolvedValue([]), upload: vi.fn(), asset: vi.fn(), openPreview: vi.fn(), closePreview: vi.fn(), capture: vi.fn(), match: vi.fn(), run: vi.fn(), start: vi.fn(), control: vi.fn(), eventsURL: () => 'ws://127.0.0.1/events' }
}
const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider theme={{ token: { motion: false } }}><App>{children}</App></ConfigProvider>

describe('桌面脚本手动管理', () => {
  it('截图与运行共用选中会话，手动选择不被后台更新覆盖', async () => {
    vi.stubGlobal('WebSocket', SocketFixture)
    const api = gateway()
    const script: Script = { id: 'reuse', name: '复用脚本', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
    vi.mocked(api.list).mockResolvedValue([script])
    vi.mocked(api.get).mockResolvedValue({ script, version: { script_id: script.id, number: 1, created_at: '', definition: { schema_version: 1, parameters: [], steps: [] } } })
    vi.mocked(api.openPreview).mockResolvedValue({ id: 'preview' } as Awaited<ReturnType<WorkflowGateway['openPreview']>>)
    vi.mocked(api.capture).mockRejectedValue(new Error('fixture'))
    vi.mocked(api.closePreview).mockResolvedValue(undefined)
    vi.mocked(api.start).mockResolvedValue({ id: 'run' } as Run)
    const sessions = [desktopSession('one', 'win'), desktopSession('two', 'linux')]
    const props = { gateway: api, sessions, profiles: [], activeSessionId: 'one', view: 'scripts' as const, onViewChange: vi.fn(), onDirtyChange: vi.fn(), onViewDesktop: vi.fn() }
    const view = render(<WorkflowWorkspace {...props} />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: /复用脚本/ }))
    await waitFor(() => expect(api.openPreview).toHaveBeenCalledWith('one', 1))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'desktopWorkflow.selectSession' }))
    fireEvent.click(await screen.findByText('linux · VNC · two'))
    await waitFor(() => expect(api.openPreview).toHaveBeenCalledWith('two', 1))
    view.rerender(<WorkflowWorkspace {...props} activeSessionId="one" sessions={[{ ...sessions[0]!, updated_at: 'later' }, sessions[1]!]} />)
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.run' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText('linux · VNC · two')).toBeVisible())
    fireEvent.click(within(dialog).getByRole('button', { name: 'desktopWorkflow.run' }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'two', connection_generation: 1, keep_connection: true })))
    view.unmount(); vi.unstubAllGlobals()
  })
  it('代次变化不静默切换，未确认请求重试保留原始目标与参数', async () => {
    const api = gateway()
    const sessions = [desktopSession('one', 'win')]
    const script: Script = { id: 'reuse', name: '复用脚本', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
    vi.mocked(api.start).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue({ id: 'run' } as Run)
    function TestDialog({ current }: { current: RemoteDesktopSession[] }) {
      const [target, setTarget] = useState(() => sessionTarget(sessions, 'one'))
      return <RunDialog gateway={api} target={target} onTargetChange={setTarget} script={script} definition={{ schema_version: 1, parameters: [], steps: [] }} sessions={current} profiles={[]} debug onStarted={() => undefined} onClose={() => undefined} />
    }
    const view = render(<TestDialog current={sessions} />, { wrapper })
    view.rerender(<TestDialog current={[{ ...sessions[0]!, connection_generation: 2 }]} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.run' })).toBeDisabled()
    await waitFor(() => expect(screen.getByText('desktopWorkflow.targetUnavailable')).toBeVisible())
    view.rerender(<TestDialog current={sessions} />)
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.run' }))
    await screen.findByText('desktopWorkflow.requestUnconfirmed')
    view.rerender(<TestDialog current={[{ ...sessions[0]!, connection_generation: 2 }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.run' }))
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.start).mock.calls[1]).toEqual(vi.mocked(api.start).mock.calls[0])
    expect(vi.mocked(api.start).mock.calls[1]?.[0]).toMatchObject({ session_id: 'one', connection_generation: 1, keep_connection: true, debug: true })
  })
  it('运行目标失效后允许明确重选同一会话的新代次', async () => {
    const api = gateway()
    const session = desktopSession('one', 'win')
    const script: Script = { id: 'reuse', name: '复用脚本', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
    vi.mocked(api.start).mockResolvedValue({ id: 'run' } as Run)
    function TestDialog({ current }: { current: RemoteDesktopSession }) {
      const [target, setTarget] = useState(() => sessionTarget([session], session.id))
      return <RunDialog gateway={api} target={target} onTargetChange={setTarget} script={script} definition={{ schema_version: 1, parameters: [], steps: [] }} sessions={[current]} profiles={[]} debug={false} onStarted={() => undefined} onClose={() => undefined} />
    }
    const view = render(<TestDialog current={session} />, { wrapper })
    view.rerender(<TestDialog current={{ ...session, connection_generation: 2 }} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.run' })).toBeDisabled()
    fireEvent.mouseDown(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByText('win · VNC · one', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'desktopWorkflow.run' })).not.toBeDisabled())
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.run' }))
    await waitFor(() => expect(api.start).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'one', connection_generation: 2 })))
  })
  it('截图目标失效后必须重选新代次，清空选择会释放观察', async () => {
    const api = gateway()
    const session = desktopSession('one', 'win')
    vi.mocked(api.openPreview).mockImplementation(async (_id, generation) => ({ id: `preview-${generation}`, state: 'ready' }))
    vi.mocked(api.capture).mockRejectedValue(new Error('fixture'))
    vi.mocked(api.closePreview).mockResolvedValue(undefined)
    function TestEditor({ current }: { current: RemoteDesktopSession }) {
      const [target, setTarget] = useState(() => sessionTarget([session], session.id))
      return <ScreenshotEditor gateway={api} sessions={[current]} target={target} onTargetChange={setTarget} onChange={() => undefined} />
    }
    const view = render(<TestEditor current={session} />, { wrapper })
    await waitFor(() => expect(api.openPreview).toHaveBeenCalledWith('one', 1))
    view.rerender(<TestEditor current={{ ...session, connection_generation: 2 }} />)
    await waitFor(() => expect(api.closePreview).toHaveBeenCalledWith('preview-1'))
    expect(api.openPreview).toHaveBeenCalledTimes(1)
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'desktopWorkflow.selectSession' }))
    fireEvent.click(await screen.findByText('win · VNC · one', { selector: '.ant-select-item-option-content' }))
    await waitFor(() => expect(api.openPreview).toHaveBeenCalledWith('one', 2))
    fireEvent.mouseDown(screen.getByRole('img', { name: 'close-circle' }))
    await waitFor(() => expect(api.closePreview).toHaveBeenCalledWith('preview-2'))
    expect(api.openPreview).toHaveBeenCalledTimes(2)
  })
  it('Profile 被移除后禁用新启动，但允许原样重试未确认请求', async () => {
    const api = gateway()
    const session = desktopSession('one', 'win')
    const profile: RemoteDesktopAccessProfile = { id: 'win', host_id: 'host', name: 'win', description: '', is_default: true, sort_order: 0, target_auth: null, created_at: '', updated_at: '', route: 'direct', route_config_version: 1, protocol: 'vnc', protocol_config_version: 1, vnc: session.vnc }
    const script: Script = { id: 'reuse', name: '复用脚本', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
    vi.mocked(api.start).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue({ id: 'run' } as Run)
    function TestDialog({ current }: { current: RemoteDesktopAccessProfile[] }) {
      const [target, setTarget] = useState<WorkflowTarget>({ mode: 'profile', id: profile.id })
      return <RunDialog gateway={api} target={target} onTargetChange={setTarget} script={script} definition={{ schema_version: 1, parameters: [], steps: [] }} sessions={[]} profiles={current} debug={false} onStarted={() => undefined} onClose={() => undefined} />
    }
    const view = render(<TestDialog current={[profile]} />, { wrapper })
    view.rerender(<TestDialog current={[]} />)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.run' })).toBeDisabled()
    expect(api.start).not.toHaveBeenCalled()
    view.rerender(<TestDialog current={[profile]} />)
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.run' }))
    await screen.findByText('desktopWorkflow.requestUnconfirmed')
    view.rerender(<TestDialog current={[]} />)
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.run' }))
    await waitFor(() => expect(api.start).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.start).mock.calls[1]).toEqual(vi.mocked(api.start).mock.calls[0])
  })
  it('外部保存新版本时保留本地草稿，加载前仍要求确认', async () => {
    vi.stubGlobal('WebSocket', SocketFixture)
    const api = gateway()
    const script: Script = { id: 'script', name: '原脚本', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
    vi.mocked(api.list).mockResolvedValue([script])
    vi.mocked(api.get).mockResolvedValue({ script, version: { script_id: 'script', number: 1, created_at: '', definition: { schema_version: 1, parameters: [], steps: [] } } })
    const view = render(<WorkflowWorkspace gateway={api} sessions={[]} profiles={[]} view="scripts" onViewChange={() => undefined} onDirtyChange={() => undefined} onViewDesktop={() => undefined} />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: /原脚本/ }))
    const input = await screen.findByRole('textbox', { name: 'desktopWorkflow.scriptName' })
    fireEvent.change(input, { target: { value: '未保存草稿' } })
    vi.mocked(api.list).mockResolvedValue([{ ...script, revision: 2, name: 'MCP 更新' }])
    act(() => SocketFixture.current.onmessage?.())
    expect(await screen.findByText('desktopWorkflow.externalUpdate')).toBeVisible()
    expect(input).toHaveValue('未保存草稿')
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.loadLatest' }))
    await waitFor(() => expect(screen.getByText('desktopWorkflow.unsavedDescription')).toBeVisible())
    expect(api.get).toHaveBeenCalledTimes(1)
    view.unmount(); vi.unstubAllGlobals()
  })
  it('保存期间完成的模板上传保留为未保存修改，不被旧请求覆盖', async () => {
    vi.stubGlobal('WebSocket', SocketFixture)
    const api = gateway(); const dirty = vi.fn()
    const script: Script = { id: 'script', name: '图像脚本', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
    vi.mocked(api.list).mockResolvedValue([script])
    vi.mocked(api.get).mockResolvedValue({ script, version: { script_id: script.id, number: 1, created_at: '', definition: { schema_version: 1, parameters: [], steps: [{ id: 'image', name: '图像校验', kind: 'image.assert', action: {} }] } } })
    let upload!: (value: Awaited<ReturnType<WorkflowGateway['upload']>>) => void
    let save!: (value: Script) => void
    vi.mocked(api.upload).mockImplementation(() => new Promise((resolve) => { upload = resolve }))
    vi.mocked(api.save).mockImplementationOnce(() => new Promise((resolve) => { save = resolve })).mockResolvedValue({ ...script, revision: 3 })
    const view = render(<WorkflowWorkspace gateway={api} sessions={[]} profiles={[]} view="scripts" onViewChange={() => undefined} onDirtyChange={dirty} onViewDesktop={() => undefined} />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: /图像脚本/ }))
    fireEvent.click(await screen.findByRole('button', { name: /图像校验/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'desktopWorkflow.scriptName' }), { target: { value: '更新名称' } })
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['fixture'], 'template.png', { type: 'image/png' })] } })
    await waitFor(() => expect(api.upload).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.save' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledOnce())
    await act(async () => { upload({ id: 'template', width: 16, height: 16, size: 100, sha256: '', created_at: '' }) })
    await act(async () => { save({ ...script, revision: 2 }) })
    expect(screen.getByRole('button', { name: 'desktopWorkflow.save' })).not.toBeDisabled()
    expect(dirty).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.save' }))
    await waitFor(() => expect(api.save).toHaveBeenLastCalledWith('script', expect.objectContaining({ expected_revision: 2, definition: expect.objectContaining({ steps: [expect.objectContaining({ image: expect.objectContaining({ asset_id: 'template' }) })] }) })))
    view.unmount(); vi.unstubAllGlobals()
  })
  it('单步响应丢失后重用操作标识，避免执行下一步', async () => {
    const api = gateway()
    const run: Run = { id: 'run', script_id: 'script', version: 1, name: '夹具', state: 'paused', phase: 'paused', executed: 1, assertions: 0, revision: 1, started_at: new Date().toISOString() }
    vi.mocked(api.run).mockResolvedValue({ run, steps: [] })
    vi.mocked(api.control).mockRejectedValueOnce(new TypeError('network')).mockResolvedValue(run)
    render(<RunReport gateway={api} id="run" revision={1} onView={() => undefined} />, { wrapper })
    const button = await screen.findByRole('button', { name: 'desktopWorkflow.singleStep' })
    fireEvent.click(button)
    await waitFor(() => expect(button).not.toBeDisabled())
    fireEvent.click(button)
    await waitFor(() => expect(api.control).toHaveBeenCalledTimes(2))
    const calls = vi.mocked(api.control).mock.calls
    expect(calls[0]?.[1]).toEqual(calls[1]?.[1])
  })
  it('未选择会话时的模板导入在卸载后不能修改下一份脚本', async () => {
    const api = gateway(); const change = vi.fn()
    let resolve!: (value: Awaited<ReturnType<WorkflowGateway['upload']>>) => void
    vi.mocked(api.upload).mockImplementation(() => new Promise((done) => { resolve = done }))
    const view = render(<ScreenshotEditor gateway={api} sessions={[]} target={{ mode: 'session' }} onTargetChange={() => undefined} step={{ id: 'image', name: '', kind: 'image.assert', action: {} }} onChange={change} />, { wrapper })
    fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['fixture'], 'template.png', { type: 'image/png' })] } })
    await waitFor(() => expect(api.upload).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => { resolve({ id: 'asset', width: 16, height: 16, size: 100, sha256: '', created_at: '' }) })
    expect(change).not.toHaveBeenCalled()
  })
  it('草稿编辑不会申请控制，保存后才允许启动，关闭页面不取消运行', async () => {
    vi.stubGlobal('WebSocket', SocketFixture)
    const api = gateway(); const dirty = vi.fn()
    const script: Script = { id: 'saved', name: 'desktopWorkflow.newScript', description: '', tags: [], revision: 1, created_at: '', updated_at: '' }
    vi.mocked(api.save).mockResolvedValue(script)
    const view = render(<WorkflowWorkspace gateway={api} sessions={[]} profiles={[]} view="scripts" onViewChange={() => undefined} onDirtyChange={dirty} onViewDesktop={() => undefined} />, { wrapper })
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    fireEvent.click(screen.getAllByRole('button', { name: 'desktopWorkflow.create' })[0]!)
    expect(screen.getByRole('button', { name: 'desktopWorkflow.run' })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'desktopWorkflow.scriptName' }), { target: { value: '回归' } })
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true))
    fireEvent.click(screen.getByRole('button', { name: 'desktopWorkflow.save' }))
    await waitFor(() => expect(api.save).toHaveBeenCalledWith(undefined, expect.objectContaining({ name: '回归', expected_revision: 0 })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'desktopWorkflow.run' })).not.toBeDisabled())
    expect(api.start).not.toHaveBeenCalled(); expect(api.control).not.toHaveBeenCalled()
    view.unmount(); expect(api.control).not.toHaveBeenCalled(); vi.unstubAllGlobals()
  })
  it('敏感参数切换后清除默认值，不能把旧默认文本保存回定义', async () => {
    const save = vi.fn()
    render(<ParameterDialog value={[{ id: 'secret', name: '密码', type: 'string', default: 'old' }]} onSave={save} onClose={() => undefined} />, { wrapper })
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: /OK/ }))
    await waitFor(() => expect(save).toHaveBeenCalledWith([expect.objectContaining({ sensitive: true, default: undefined })]))
  })
  it('报告区分执行完成和断言通过，只发出明确的取消操作', async () => {
    const api = gateway()
    const run: Run = { id: 'run', script_id: 'script', version: 1, name: '夹具', state: 'paused', phase: 'paused', executed: 1, assertions: 0, revision: 1, started_at: new Date().toISOString() }
    vi.mocked(api.run).mockResolvedValue({ run, steps: [] }); vi.mocked(api.control).mockResolvedValue({ ...run, state: 'cancelled' })
    const view = render(<RunReport gateway={api} id="run" revision={1} onView={() => undefined} />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'desktopWorkflow.cancel' }))
    await waitFor(() => expect(api.control).toHaveBeenCalledWith('run', expect.any(String), 'cancel'))
    vi.mocked(api.run).mockResolvedValue({ run: { ...run, state: 'completed', phase: 'finished' }, steps: [] })
    await act(async () => { view.rerender(<RunReport gateway={api} id="run" revision={2} onView={() => undefined} />) })
    expect(await screen.findByText('desktopWorkflow.executionCompleted')).toBeVisible()
    expect(screen.queryByText('desktopWorkflow.assertionsPassed')).not.toBeInTheDocument()
  })
})

function desktopSession(id: string, name: string): RemoteDesktopSession {
  return { id, profile_id: name, profile_name: name, host_id: 'host', host_name: 'fixture', route: 'direct', route_config_version: 1, protocol: 'vnc', protocol_config_version: 1, vnc: { target_host: '127.0.0.1', port: 5900, shared: true, default_view_only: true, default_display_mode: 'fit' }, status: 'ready', phase: 'ready', connection_generation: 1, viewer_attached: false, created_at: '', updated_at: '' }
}
