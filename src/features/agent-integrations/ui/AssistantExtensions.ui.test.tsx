import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { expect, it, vi } from 'vitest'
import type { AgentIntegrationsGateway, AgentIntegrationSource, IntegrationSelection } from '#entities/agent-integrations'
import { AssistantExtensions } from './AssistantExtensions'
import { IntegrationSourcePicker } from './IntegrationSourcePicker'
import { MCPSourceEditor } from './MCPSourceEditor'
import { IntegrationImport } from './IntegrationImport'
import { MCPDependencyPanel } from './MCPDependencyPanel'
import type { ReactNode } from 'react'

const translate=(key:string)=>key
vi.mock('react-i18next',()=>({useTranslation:()=>({t:translate})}))
vi.mock('#shared/bridge',()=>({getTermousBridge:()=>undefined}))
const source:AgentIntegrationSource={id:'ext_fixture',revision:1,name:'Fixture MCP',kind:'mcp',enabled:false,mcp:{transport:'http',url:'https://example.test/mcp'},secret_configured:true,created_at:'',updated_at:''}
function wrapper({children}:{children:ReactNode}) {return <ConfigProvider theme={{token:{motion:false}}}><App>{children}</App></ConfigProvider>}
function gateway(overrides:Partial<AgentIntegrationsGateway>={}):AgentIntegrationsGateway {
  return {sources:vi.fn(async()=>[source]),saveMCP:vi.fn(async()=>source),previewMCP:vi.fn(async()=>[]),enabled:vi.fn(async()=>source),remove:vi.fn(async()=>{}),
    dependency:vi.fn(async()=>null),previewDependency:vi.fn(),confirmDependency:vi.fn(),cancelDependency:vi.fn(),dependencyOutput:vi.fn(),
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
  const item = { id: `prep_${'a'.repeat(32)}`, source_id: source.id, revision: 1, state: 'preview' as const,
    package: { name: '@playwright/mcp', version: '0.0.83', entry: 'cli.js', arguments: ['--headless'], integrity: 'sha512-fixture' },
    runtime: { node: 'C:\\node\\node.exe', npm: 'C:\\node\\npm-cli.js', identity: 'fixture' } }
  let complete!: (value: AgentIntegrationSource) => void
  const api = gateway({ previewDependency: vi.fn(async () => item), confirmDependency: vi.fn(() => new Promise<AgentIntegrationSource>(resolve => { complete = resolve })) })
  const changed = vi.fn()
  render(<MCPDependencyPanel source={source} gateway={api} onChanged={changed} />, { wrapper })
  fireEvent.click(screen.getByRole('button', { name: /mcpPreparation.title/u }))
  fireEvent.click(await screen.findByRole('button', { name: 'mcpPreparation.prepare' }))
  expect(await screen.findByText('@playwright/mcp@0.0.83')).toBeInTheDocument()
  expect(api.confirmDependency).not.toHaveBeenCalled()
  const confirm = screen.getByRole('button', { name: 'mcpPreparation.confirm' })
  fireEvent.click(confirm); fireEvent.click(confirm)
  expect(api.confirmDependency).toHaveBeenCalledOnce()
  expect(vi.mocked(api.confirmDependency).mock.calls[0]?.slice(0, 3)).toEqual([source.id, source.revision, item.id])
  await act(async () => complete({ ...source, revision: 2 }))
  expect(changed).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 }))
})
