import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentIntegrationsGateway, AgentIntegrationSource, IntegrationSelection } from '#entities/agent-integrations'
import { AssistantExtensions } from './AssistantExtensions'
import { IntegrationSourcePicker } from './IntegrationSourcePicker'
import { MCPSourceEditor } from './MCPSourceEditor'
import { IntegrationImport } from './IntegrationImport'
import { MCPDependencyPanel } from './MCPDependencyPanel'
import { MCPProvisionDialog } from './MCPProvisionDialog'
import type { ReactNode } from 'react'

const translate=(key:string)=>key
const native = vi.hoisted(() => ({ value: undefined as unknown }))
afterEach(() => { native.value = undefined })
vi.mock('react-i18next',()=>({useTranslation:()=>({t:translate})}))
vi.mock('#shared/bridge',()=>({getTermousBridge:()=>native.value}))
const source:AgentIntegrationSource={id:'ext_fixture',revision:1,name:'Fixture MCP',kind:'mcp',enabled:false,mcp:{transport:'http',url:'https://example.test/mcp'},secret_configured:true,created_at:'',updated_at:''}
function wrapper({children}:{children:ReactNode}) {return <ConfigProvider theme={{token:{motion:false}}}><App>{children}</App></ConfigProvider>}
function gateway(overrides:Partial<AgentIntegrationsGateway>={}):AgentIntegrationsGateway {
  return {sources:vi.fn(async()=>[source]),saveMCP:vi.fn(async()=>source),previewMCP:vi.fn(async()=>[]),enabled:vi.fn(async()=>source),remove:vi.fn(async()=>{}),
    confirmLaunch:vi.fn(async()=>source),repairDependency:vi.fn(),dependency:vi.fn(async()=>null),previewDependency:vi.fn(),confirmDependency:vi.fn(),cancelDependency:vi.fn(),dependencyOutput:vi.fn(),
    previewSkill:vi.fn(),publishSkill:vi.fn(),skillFile:vi.fn(),skillDependencies:vi.fn(async()=>[]),tools:vi.fn(async()=>[]),permissions:vi.fn(async()=>[]),setPermission:vi.fn(async()=>{}),policies:vi.fn(async()=>[]),setPolicy:vi.fn(async()=>{}),...overrides}
}

it('管理页只读取配置，打开时不会启动外部进程',async()=>{
  const api=gateway()
  render(<AssistantExtensions gateway={api}/>,{wrapper})
  expect(await screen.findByText('Fixture MCP')).toBeInTheDocument()
  expect(api.sources).toHaveBeenCalledOnce()
  expect(api.enabled).not.toHaveBeenCalled()
  expect(api.saveMCP).not.toHaveBeenCalled()
})

it('编辑凭据留空不会上传已有密钥，重复保存只有一次请求',async()=>{
  let complete!:(value:AgentIntegrationSource)=>void
  const api=gateway({saveMCP:vi.fn(()=>new Promise<AgentIntegrationSource>(resolve=>{complete=resolve}))})
  const saved=vi.fn()
  render(<MCPSourceEditor source={source} gateway={api} onClose={()=>{}} onSaved={saved}/>,{wrapper})
  const save=screen.getByRole('button',{name:'extensions.save'})
  fireEvent.click(save);fireEvent.click(save)
  await waitFor(()=>expect(api.saveMCP).toHaveBeenCalledOnce())
  expect(vi.mocked(api.saveMCP).mock.calls[0][0]).not.toHaveProperty('secret')
  await act(async()=>complete(source))
  expect(saved).toHaveBeenCalledOnce()
})

it('会话切换期间旧策略保存完成不会写入新会话状态',async()=>{
  let complete!:()=>void
  const read=vi.fn(async():Promise<IntegrationSelection>=>({sources:[{id:source.id,name:source.name,kind:'mcp',enabled:true}],policies:[]}))
  const change=vi.fn(()=>new Promise<void>(resolve=>{complete=resolve}))
  const view=render(<IntegrationSourcePicker sessionKey="first" read={read} change={change}/>,{wrapper})
  fireEvent.click(screen.getByRole('button',{name:'extensions.title'}))
  const toggle=await screen.findByRole('switch',{name:'extensions.sessionEnabled Fixture MCP'})
  fireEvent.click(toggle)
  expect(change).toHaveBeenCalledOnce()
  view.rerender(<IntegrationSourcePicker sessionKey="second" read={read} change={change}/>)
  await waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  await act(async()=>complete())
  expect(screen.getByRole('switch',{name:'extensions.sessionEnabled Fixture MCP'})).toBeChecked()
})

it('导入先预览，确认之前不保存来源',async()=>{
  const api=gateway({previewMCP:vi.fn(async()=>[{name:source.name,mcp:source.mcp!,expected_revision:0}])})
  render(<IntegrationImport kind="mcp" gateway={api} onClose={()=>{}} onImported={()=>{}}/>,{wrapper})
  fireEvent.change(screen.getByRole('textbox'),{target:{value:'{"mcpServers":{"fixture":{"url":"https://example.test/mcp"}}}'}})
  fireEvent.click(screen.getByRole('button',{name:'extensions.preview'}))
  expect(await screen.findByText('Fixture MCP')).toBeInTheDocument()
  expect(api.saveMCP).not.toHaveBeenCalled()
  const confirm=await screen.findByRole('button',{name:'extensions.import'})
  fireEvent.click(confirm);fireEvent.click(confirm)
  await waitFor(()=>expect(api.saveMCP).toHaveBeenCalledOnce())
})

it('依赖准备需要先预览再确认，重复确认只发送一次', async () => {
  const managed: AgentIntegrationSource = { ...source, mcp: { transport: 'stdio', mode: 'managed_npm', command: 'npx', args: ['@playwright/mcp'] } }
  const item = { id: `prep_${'a'.repeat(32)}`, source_id: source.id, revision: 1, state: 'preview' as const,
    package: { name: '@playwright/mcp', version: '0.0.83', entry: 'cli.js', arguments: ['--headless'], integrity: 'sha512-fixture' },
    runtime: { node: 'C:\\node\\node.exe', npm: 'C:\\node\\npm-cli.js', identity: 'fixture' } }
  let complete!: (value: AgentIntegrationSource) => void
  let installed = false
  native.value = { agentIntegrations: { test: vi.fn(async () => ({ tools: [], generation: 'fixture', source: { ...managed, revision: 2, enabled: true } })), cancel: vi.fn() } }
  const api = gateway({ sources: vi.fn(async () => [{ ...managed, revision: 2 }]), dependency: vi.fn(async () => installed ? { ...item, state: 'ready' as const, activation_requested: true } : null), previewDependency: vi.fn(async () => item), confirmDependency: vi.fn(() => new Promise<AgentIntegrationSource>(resolve => { complete = value => { installed = true; resolve(value) } })) })
  const changed = vi.fn()
  render(<MCPDependencyPanel source={managed} gateway={api} onChanged={changed} />, { wrapper })
  fireEvent.click(screen.getByRole('button', { name: /mcpPreparation.title/u }))
  fireEvent.click(await screen.findByRole('button', { name: 'mcpPreparation.prepare' }))
  expect(await screen.findByText('@playwright/mcp@0.0.83')).toBeInTheDocument()
  expect(api.confirmDependency).not.toHaveBeenCalled()
  const confirm = await screen.findByRole('button', { name: 'mcpPreparation.confirm' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(api.confirmDependency).toHaveBeenCalledOnce()
  expect(vi.mocked(api.confirmDependency).mock.calls[0]?.slice(0, 3)).toEqual([source.id, source.revision, item.id])
  await act(async () => complete({ ...source, revision: 2 }))
  await waitFor(() => expect(changed).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 })))
  native.value = undefined
})

it('连接失败保留明确诊断，不提前启用来源', async () => {
  const test = vi.fn(async () => ({ failure: { code: 'INTEGRATION_CONNECT_TIMEOUT', phase: 'handshaking', message: 'timeout', detail: 'bounded fixture diagnostic' } }))
  native.value = { agentIntegrations: { test, cancel: vi.fn() } }
  const api = gateway()
  render(<MCPProvisionDialog sources={[source]} gateway={api} onClose={() => {}} onChanged={() => {}} />, { wrapper })
  const activate = await screen.findByRole('button', { name: 'mcpPreparation.activate' })
  await waitFor(() => expect(activate).toBeEnabled())
  fireEvent.click(activate)
  expect(await screen.findByText(/bounded fixture diagnostic/u)).toBeInTheDocument()
  expect(api.confirmLaunch).toHaveBeenCalledOnce()
  expect(api.enabled).not.toHaveBeenCalled()
})

it('已有启动确认复用同一确认记录，连接验证成功后才启用', async () => {
  native.value = { agentIntegrations: { test: vi.fn(async () => ({ tools: [], generation: 'fixture' })), cancel: vi.fn() } }
  const api = gateway()
  const onChanged = vi.fn()
  render(<MCPProvisionDialog sources={[{ ...source, startup_confirmed: true }]} gateway={api} onClose={() => {}} onChanged={onChanged} />, { wrapper })
  const activate = await screen.findByRole('button', { name: 'mcpPreparation.activate' })
  await waitFor(() => expect(activate).toBeEnabled())
  fireEvent.click(activate)
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  expect(api.confirmLaunch).not.toHaveBeenCalled()
  expect(api.enabled).toHaveBeenCalledOnce()
})

it('关闭准备界面仅结束观察，不取消已确认的后台安装', async () => {
  const managed: AgentIntegrationSource = { ...source, mcp: { transport: 'stdio', mode: 'managed_npm', command: 'npx', args: ['fixture'] } }
  const api = gateway({ dependency: vi.fn(async () => ({ id: 'prep_fixture', source_id: source.id, revision: 1, state: 'preparing' as const,
    package: { name: 'fixture', version: '1.0.0', entry: 'index.js', arguments: [], integrity: 'fixture' }, runtime: { node: 'node', npm: 'npm', identity: 'fixture' } })) })
  const close = vi.fn()
  const view = render(<MCPProvisionDialog sources={[managed]} gateway={api} onClose={close} onChanged={() => {}} />, { wrapper })
  await waitFor(() => expect(api.dependency).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'mcpPreparation.close' }))
  expect(close).toHaveBeenCalledOnce()
  view.unmount()
  expect(api.cancelDependency).not.toHaveBeenCalled()
})

it('后台已激活原候选时仅对账，父级刷新不会自动再次升级', async () => {
  const managed: AgentIntegrationSource = { ...source, enabled: true, startup_confirmed: true,
    mcp: { transport: 'stdio', mode: 'managed_npm', command: 'npx', args: ['fixture'], dependency_id: 'prep_old' } }
  const candidate = { id: `prep_${'b'.repeat(32)}`, source_id: source.id, revision: 1, state: 'preview' as const,
    package: { name: 'fixture', version: '2.0.0', entry: 'index.js', arguments: [], integrity: 'fixture' },
    runtime: { node: 'node', npm: 'npm', identity: 'fixture' } }
  const published = { ...managed, revision: 2, mcp: { ...managed.mcp!, dependency_id: candidate.id } }
  let activated = false
  const test = vi.fn()
  native.value = { agentIntegrations: { test, cancel: vi.fn() } }
  const api = gateway({ dependency: vi.fn(async () => { if (activated) throw new Error('MCP_DEPENDENCY_CONFLICT'); return null }),
    previewDependency: vi.fn(async () => candidate), confirmDependency: vi.fn(async () => { activated = true; return managed }),
    sources: vi.fn(async () => [published]) })
  const onChanged = vi.fn()
  const view = render(<MCPProvisionDialog sources={[managed]} gateway={api} operation="upgrade" onClose={() => {}} onChanged={onChanged} />, { wrapper })
  fireEvent.click(await screen.findByRole('button', { name: 'mcpPreparation.confirm' }))
  expect(await screen.findByText('mcpPreparation.done')).toBeInTheDocument()
  expect(test).not.toHaveBeenCalled()
  expect(api.enabled).not.toHaveBeenCalled()
  expect(onChanged).toHaveBeenCalledOnce()
  view.rerender(<MCPProvisionDialog sources={[published]} gateway={api} operation="upgrade" onClose={() => {}} onChanged={onChanged} />)
  expect(screen.getByText('mcpPreparation.done')).toBeInTheDocument()
  expect(api.previewDependency).toHaveBeenCalledOnce()
  expect(api.confirmDependency).toHaveBeenCalledOnce()
})

it('切换安装任务后从零读取日志，不混入旧任务输出', async () => {
  const managed: AgentIntegrationSource = { ...source, mcp: { transport: 'stdio', mode: 'managed_npm', command: 'npx', args: ['fixture'] } }
  const first = { id: 'prep_first', source_id: source.id, revision: 1, state: 'failed' as const, task_id: 'task_first',
    package: { name: 'fixture', version: '1.0.0', entry: 'index.js', arguments: [], integrity: 'fixture' }, runtime: { node: 'node', npm: 'npm', identity: 'fixture' } }
  let current = first
  const stream = (text: string) => ({ text, next_offset: 10, truncated: false })
  const api = gateway({ dependency: vi.fn(async () => current), dependencyOutput: vi.fn(async () => ({
    stdout: stream(current.id), stderr: stream(''),
  })) })
  const view = render(<MCPDependencyPanel source={managed} gateway={api} onChanged={() => {}} />, { wrapper })
  fireEvent.click(screen.getByRole('button', { name: /mcpPreparation.title/u }))
  fireEvent.click(await screen.findByRole('button', { name: 'mcpPreparation.logs' }))
  expect(await screen.findByText(/^prep_first/u)).toBeInTheDocument()
  current = { ...first, id: 'prep_second', task_id: 'task_second', revision: 2, package: { ...first.package, version: '2.0.0' } }
  view.rerender(<MCPDependencyPanel source={{ ...managed, revision: 2 }} gateway={api} onChanged={() => {}} />)
  expect(await screen.findByText('fixture@2.0.0')).toBeInTheDocument()
  expect(screen.queryByText(/^prep_first/u)).not.toBeInTheDocument()
  fireEvent.click(await screen.findByRole('button', { name: 'mcpPreparation.logs' }))
  expect(await screen.findByText(/^prep_second/u)).toBeInTheDocument()
  expect(vi.mocked(api.dependencyOutput).mock.calls[1]?.slice(0, 4)).toEqual([source.id, 2, 0, 0])
})
