import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { Button } from 'antd'
import '#shared/styles'
import '#shared/i18n'
import { TermousUiProvider } from '#app/ui-runtime'
import { WorkflowWorkspace } from '#features/desktop-workflows'
import type { Definition, Run, Script, StartInput, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'

// 仅使用合成元数据验证生产编辑器，不创建网络桌面或申请控制权。
const script: Script = { id: 'fixture', name: '登录界面回归', description: '等待入口出现，点击后确认主界面', tags: ['回归', '桌面'], revision: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
const definition: Definition = { schema_version: 1, parameters: [], steps: [
  { id: 'wait', name: '等待登录入口', kind: 'image.wait', image: { asset_id: 'template', threshold: .95, scales: [1] }, action: {} },
  { id: 'click', name: '点击登录', kind: 'pointer.click', target: { kind: 'point', x: 820, y: 440, reference_width: 1920, reference_height: 1080 }, action: { button: 'left', count: 1 } },
  { id: 'condition', name: '检查首页', kind: 'if', image: { asset_id: 'template', threshold: .95 }, action: {}, steps: [{ id: 'capture', name: '保存画面', kind: 'capture', action: {} }], else: [{ id: 'pause', name: '暂停检查', kind: 'breakpoint', action: {} }] },
] }
const unavailable = async (): Promise<never> => { throw new Error('界面夹具不执行桌面操作') }
const gateway: WorkflowGateway = { list: async () => [script], get: async () => ({ script, version: { script_id: script.id, number: 3, definition, created_at: script.created_at } }), listRuns: async () => [], save: async () => script, validate: async () => [], remove: unavailable, versions: async () => [], restore: unavailable, upload: unavailable, asset: unavailable, openPreview: unavailable, closePreview: unavailable, capture: unavailable, match: unavailable, run: unavailable, start: unavailable, control: unavailable, eventsURL: () => 'ws://127.0.0.1:1/workflow-fixture' }
const reuse = new URLSearchParams(location.search).has('reuse')
const sessions: RemoteDesktopSession[] = ['win', 'VM-Debian12'].map((name) => ({
  id: `fixture-${name}`, profile_id: `profile-${name}`, profile_name: name, host_id: `host-${name}`, host_name: name,
  route: 'direct', route_config_version: 1, protocol: 'vnc', protocol_config_version: 1,
  vnc: { target_host: '127.0.0.1', port: 5900, shared: true, default_view_only: true, default_display_mode: 'fit' },
  status: 'streaming', phase: 'streaming', connection_generation: 1, viewer_attached: true, created_at: '', updated_at: '',
}))
const profiles: RemoteDesktopAccessProfile[] = sessions.map((session) => ({
  id: session.profile_id, host_id: session.host_id, name: session.profile_name, description: '', is_default: true,
  sort_order: 0, target_auth: null, created_at: '', updated_at: '', route: 'direct', route_config_version: 1,
  protocol: 'vnc', protocol_config_version: 1, vnc: session.vnc,
}))
const runs = new Map<string, Run>()
let lastInput: StartInput | undefined
const reuseGateway: WorkflowGateway = {
  ...gateway,
  openPreview: async (id) => ({ id, state: 'ready' }), closePreview: async () => undefined,
  listRuns: async () => [...runs.values()],
  run: async (id) => { const run = runs.get(id); if (!run) throw new Error('夹具运行不存在'); return { run, steps: [] } },
  start: async (input) => {
    lastInput = input
    const session = sessions.find((item) => item.id === input.session_id || item.profile_id === input.profile_id)
    if (!session) throw new Error('夹具目标不存在')
    const run: Run = { id: crypto.randomUUID(), script_id: script.id, version: script.revision, name: script.name,
      session_id: session.id, target_name: session.profile_name, protocol: session.protocol, state: input.debug ? 'paused' : 'completed',
      phase: input.debug ? 'paused' : 'finished', executed: input.debug ? 0 : 1, assertions: 0, revision: 1, started_at: new Date().toISOString() }
    runs.set(run.id, run); return run
  },
  control: async (id, _request, action) => {
    const current = runs.get(id); if (!current) throw new Error('夹具运行不存在')
    const run = { ...current, revision: current.revision + 1, state: action === 'cancel' ? 'cancelled' : 'completed', phase: 'finished', executed: 1 }
    runs.set(id, run); return run
  },
}
export function Fixture() {
  const [view, setView] = useState<'scripts' | 'runs'>('scripts')
  const [active, setActive] = useState(sessions[0]!.id)
  const [generation, setGeneration] = useState(1)
  const currentSessions = sessions.map((session) => ({ ...session, connection_generation: generation }))
  return <div style={{ height: '100vh', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div><strong>远程桌面</strong> <Button type="text" onClick={() => setView('scripts')}>脚本</Button><Button type="text" onClick={() => setView('runs')}>运行记录</Button></div>
    {reuse && <div><Button onClick={() => setActive(sessions.find((item) => item.id !== active)!.id)}>模拟后台选中会话变化</Button><Button onClick={() => setGeneration((value) => value + 1)}>模拟重连代次变化</Button><span>当前桌面：{active}；已有会话：{sessions.length}；连接代次：{generation}</span><output aria-label="验收请求">{JSON.stringify(lastInput)}</output></div>}
    <div style={{ minHeight: 0, flex: 1 }}><WorkflowWorkspace gateway={reuse ? reuseGateway : gateway} sessions={reuse ? currentSessions : []} profiles={reuse ? profiles : []} activeSessionId={reuse ? active : undefined} view={view} onViewChange={setView} onDirtyChange={() => undefined} onViewDesktop={() => undefined} /></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<TermousUiProvider language="zh-CN" theme={location.search.includes('light') ? 'light' : 'dark'}><Fixture /></TermousUiProvider>)
