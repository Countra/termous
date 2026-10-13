import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { Button } from 'antd'
import '#shared/styles'
import '#shared/i18n'
import { TermousUiProvider } from '#app/ui-runtime'
import { WorkflowWorkspace } from '#features/desktop-workflows'
import type { Definition, Script, WorkflowGateway } from '#entities/desktop-workflow'

// 仅使用合成元数据验证生产编辑器，不创建网络桌面或申请控制权。
const script: Script = { id: 'fixture', name: '登录界面回归', description: '等待入口出现，点击后确认主界面', tags: ['回归', '桌面'], revision: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
const definition: Definition = { schema_version: 1, parameters: [], steps: [
  { id: 'wait', name: '等待登录入口', kind: 'image.wait', image: { asset_id: 'template', threshold: .95, scales: [1] }, action: {} },
  { id: 'click', name: '点击登录', kind: 'pointer.click', target: { kind: 'point', x: 820, y: 440, reference_width: 1920, reference_height: 1080 }, action: { button: 'left', count: 1 } },
  { id: 'condition', name: '检查首页', kind: 'if', image: { asset_id: 'template', threshold: .95 }, action: {}, steps: [{ id: 'capture', name: '保存画面', kind: 'capture', action: {} }], else: [{ id: 'pause', name: '暂停检查', kind: 'breakpoint', action: {} }] },
] }
const unavailable = async (): Promise<never> => { throw new Error('界面夹具不执行桌面操作') }
const gateway: WorkflowGateway = { list: async () => [script], get: async () => ({ script, version: { script_id: script.id, number: 3, definition, created_at: script.created_at } }), listRuns: async () => [], save: async () => script, validate: async () => [], remove: unavailable, versions: async () => [], restore: unavailable, upload: unavailable, asset: unavailable, openPreview: unavailable, closePreview: unavailable, capture: unavailable, match: unavailable, run: unavailable, start: unavailable, control: unavailable, eventsURL: () => 'ws://127.0.0.1:1/workflow-fixture' }
export function Fixture() {
  const [view, setView] = useState<'scripts' | 'runs'>('scripts')
  return <div style={{ height: '100vh', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div><strong>远程桌面</strong> <Button type="text" onClick={() => setView('scripts')}>脚本</Button><Button type="text" onClick={() => setView('runs')}>运行记录</Button></div>
    <div style={{ minHeight: 0, flex: 1 }}><WorkflowWorkspace gateway={gateway} sessions={[]} profiles={[]} view={view} onViewChange={setView} onDirtyChange={() => undefined} onViewDesktop={() => undefined} /></div>
  </div>
}
createRoot(document.getElementById('root')!).render(<TermousUiProvider language="zh-CN" theme={location.search.includes('light') ? 'light' : 'dark'}><Fixture /></TermousUiProvider>)
