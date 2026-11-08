import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { App, ConfigProvider } from 'antd'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentIntegrationsGateway, AgentIntegrationSource, IntegrationSelection } from '#entities/agent-integrations'
import { AssistantExtensions } from './AssistantExtensions'
import { IntegrationSourcePicker } from './IntegrationSourcePicker'
import { MCPSourceEditor } from './MCPSourceEditor'
import { IntegrationImport } from './IntegrationImport'
import { MCPDependencyPanel } from './MCPDependencyPanel'
import { MCPProvisionDialog } from './MCPProvisionDialog'
import { IntegrationSourceList } from './IntegrationSourceList'
import { contextActionMenuPopupClassName } from '#shared/ui'
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

it('操作错误显示在统一消息层，离开扩展页后撤下消息', async () => {
  const api = gateway({ sources: vi.fn().mockRejectedValue(new Error('合成配置读取失败')) })
  const { container, rerender } = render(<AssistantExtensions gateway={api} />, { wrapper })
  const notice = await screen.findByRole('alert')
  expect(notice).toHaveTextContent('合成配置读取失败')
  expect(container).not.toContainElement(notice)
  rerender(<AssistantExtensions gateway={api} active={false} />)
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
})

it('分区只展示对应资源与设置，编辑在页内呈现并统一保存', async () => {
  const api = gateway()
  render(<AssistantExtensions gateway={api} installationSettings={<div>安装设置内容</div>} searchSettings={<div>搜索设置内容</div>} />, { wrapper })
  expect(await screen.findByText('Fixture MCP')).toBeVisible()
  expect(screen.getByText('安装设置内容')).not.toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'webSearch.title' }))
  expect(within(screen.getByRole('tabpanel')).getByText('搜索设置内容')).toBeVisible()
  expect(screen.queryByText('Fixture MCP')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('tab', { name: /extensions.mcpTab/u }))
  fireEvent.click(screen.getByRole('button', { name: 'extensions.configure' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'extensions.name' })).toHaveValue('Fixture MCP')
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(screen.getAllByRole('button', { name: 'app.save' })).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.backToServers' }))
  expect(screen.getByRole('button', { name: 'extensions.configure' })).toBeVisible()
  expect(api.saveMCP).not.toHaveBeenCalled()
})

it('编辑与弹层向设置导航报告忙碌，返回列表和卸载后释放守卫', async () => {
  const onBusyChange = vi.fn()
  const api = gateway()
  const view = render(<AssistantExtensions gateway={api} onBusyChange={onBusyChange} />, { wrapper })
  await screen.findByText('Fixture MCP')
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.configure' }))
  expect(onBusyChange).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.backToServers' }))
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: 'extensions.configure' }))
  expect(onBusyChange).toHaveBeenLastCalledWith(true)
  view.unmount()
  expect(onBusyChange).toHaveBeenLastCalledWith(false)
  expect(api.saveMCP).not.toHaveBeenCalled()
})

it('页内编辑返回时保护未保存的修改，确认放弃才返回', async () => {
  const close = vi.fn()
  render(<MCPSourceEditor source={source} gateway={gateway()} onClose={close} onSaved={() => {}} />, { wrapper })
  fireEvent.change(screen.getByRole('textbox', { name: 'extensions.name' }), { target: { value: 'Changed name' } })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.backToServers' }))
  expect(close).not.toHaveBeenCalled()
  fireEvent.click(await screen.findByRole('button', { name: 'settings.editor.discard' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
})

it.each(['http', 'stdio'] as const)('恢复 %s 表单的原值后不保留虚假的未保存状态', async transport => {
  const close = vi.fn()
  const current = { ...source, mcp: transport === 'http' ? source.mcp : { transport, command: 'node', args: ['fixture.js'] } }
  render(<MCPSourceEditor source={current} gateway={gateway()} onClose={close} onSaved={() => {}} />, { wrapper })
  const name = screen.getByRole('textbox', { name: 'extensions.name' })
  fireEvent.change(name, { target: { value: 'Changed name' } })
  expect(screen.getByRole('button', { name: 'app.save' })).toBeEnabled()
  fireEvent.change(name, { target: { value: source.name } })
  expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'extensions.backToServers' }))
  expect(close).toHaveBeenCalledOnce()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('新增表单不会把未创建的服务显示为已保存，撤销恢复原始字段', async () => {
  const api = gateway()
  render(<MCPSourceEditor gateway={api} onClose={() => {}} onSaved={() => {}} />, { wrapper })
  expect(screen.getByText('extensions.newServerHint')).toBeVisible()
  expect(screen.queryByText('settings.editor.upToDate')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
  fireEvent.change(screen.getByRole('textbox', { name: 'extensions.name' }), { target: { value: 'New server' } })
  fireEvent.click(screen.getByRole('button', { name: 'settings.editor.reset' }))
  expect(screen.getByRole('textbox', { name: 'extensions.name' })).toHaveValue('')
  expect(screen.getByRole('button', { name: 'app.save' })).toBeDisabled()
  expect(api.saveMCP).not.toHaveBeenCalled()
})

it('编辑凭据留空不会上传已有密钥，重复保存只有一次请求',async()=>{
  let complete!:(value:AgentIntegrationSource)=>void
  const api=gateway({saveMCP:vi.fn(()=>new Promise<AgentIntegrationSource>(resolve=>{complete=resolve}))})
  const saved=vi.fn()
  render(<MCPSourceEditor source={source} gateway={api} onClose={()=>{}} onSaved={saved}/>,{wrapper})
  fireEvent.change(screen.getByRole('textbox', { name: 'extensions.name' }), { target: { value: 'Updated name' } })
  const save=screen.getByRole('button',{name:'app.save'})
  fireEvent.click(save);fireEvent.click(save)
  await waitFor(()=>expect(api.saveMCP).toHaveBeenCalledOnce())
  expect(vi.mocked(api.saveMCP).mock.calls[0][0]).not.toHaveProperty('secret')
  await act(async()=>complete(source))
  expect(saved).toHaveBeenCalledOnce()
})

it('切换连接方式不携带旧凭据，HTTP 保存不校验隐藏的命令参数', async () => {
  const local: AgentIntegrationSource = { ...source, mcp: { transport: 'stdio', command: 'node', args: ['server.js'] } }
  const api = gateway()
  render(<MCPSourceEditor source={local} gateway={api} onClose={() => {}} onSaved={() => {}} />, { wrapper })
  fireEvent.change(screen.getByRole('textbox', { name: 'extensions.args' }), { target: { value: 'invalid JSON' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'extensions.environment' }), { target: { value: '{"FIXTURE":"example"}' } })
  const transport = screen.getByRole('combobox', { name: 'extensions.transport' })
  fireEvent.keyDown(transport, { key: 'ArrowDown', keyCode: 40 })
  fireEvent.keyDown(transport, { key: 'ArrowDown', keyCode: 40 })
  fireEvent.keyDown(transport, { key: 'Enter', keyCode: 13 })
  expect(await screen.findByRole('textbox', { name: 'extensions.headers' })).toHaveValue('')
  fireEvent.change(screen.getByRole('textbox', { name: 'extensions.url' }), { target: { value: 'https://http.example.test/mcp' } })
  fireEvent.click(screen.getByRole('button', { name: 'app.save' }))
  await waitFor(() => expect(api.saveMCP).toHaveBeenCalledOnce())
  expect(vi.mocked(api.saveMCP).mock.calls[0][0]).toEqual({ name: source.name, expected_revision: 1, mcp: { transport: 'http', url: 'https://http.example.test/mcp', auth: 'none' } })
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

it('更多菜单使用公共浮层样式，并将操作交给原来源', async () => {
  const action = vi.fn()
  render(<IntegrationSourceList sources={[source]} connections={[]} kind="mcp" loading={false} busy="" onInspect={() => {}} onToggle={() => {}} onAction={action} />, { wrapper })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.moreActions Fixture MCP' }))
  const test = await screen.findByRole('menuitem', { name: 'extensions.test' })
  expect(test.closest('.ant-dropdown')).toHaveClass(contextActionMenuPopupClassName)
  fireEvent.click(test)
  expect(action).toHaveBeenCalledWith(source, 'test')
})

it('空列表与搜索无结果有不同说明，清除搜索恢复原列表', async () => {
  const props = { connections: [], kind: 'mcp' as const, loading: false, busy: '', onInspect: vi.fn(), onToggle: vi.fn(), onAction: vi.fn() }
  const view = render(<IntegrationSourceList {...props} sources={[]} />, { wrapper })
  expect(screen.getByText('extensions.emptyMCPHint')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'extensions.clearSearch' })).not.toBeInTheDocument()
  view.rerender(<IntegrationSourceList {...props} sources={[source]} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'no-such-fixture' } })
  expect(screen.getByText('extensions.noMatchesHint')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'extensions.clearSearch' }))
  expect(screen.getByText(source.name)).toBeVisible()
  expect(screen.getByRole('textbox')).toHaveValue('')
})

it('导入空配置有明确空状态，修改 JSON 后旧预览失效', async () => {
  const api = gateway({ previewMCP: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ name: source.name, mcp: source.mcp!, expected_revision: 0 }]) })
  render(<IntegrationImport kind="mcp" gateway={api} onClose={() => {}} onImported={() => {}} />, { wrapper })
  const input = screen.getByRole('textbox', { name: 'extensions.jsonConfiguration' })
  fireEvent.change(input, { target: { value: '{"mcpServers":{}}' } })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.preview' }))
  await waitFor(() => expect(screen.getByText('extensions.importEmptyHint')).toBeVisible())
  expect(screen.getByRole('button', { name: 'extensions.import' })).toBeDisabled()
  fireEvent.change(input, { target: { value: '{"mcpServers":{"fixture":{}}}' } })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.preview' }))
  expect(await screen.findByRole('checkbox', { name: source.name })).toBeChecked()
  fireEvent.change(input, { target: { value: '{"mcpServers":{}}' } })
  expect(screen.queryByRole('checkbox', { name: source.name })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'extensions.import' })).toBeDisabled()
  expect(api.saveMCP).not.toHaveBeenCalled()
})

it('部分导入失败后保留成功项，重试只提交失败项', async () => {
  const second = { ...source, id: 'ext_second', name: 'Second MCP' }
  const api = gateway({ previewMCP: vi.fn(async () => [source, second].map(value => ({ name: value.name, mcp: value.mcp!, expected_revision: 0 }))),
    saveMCP: vi.fn().mockResolvedValueOnce(source).mockRejectedValueOnce(new Error('合成导入失败')).mockResolvedValueOnce(second) })
  const imported = vi.fn()
  render(<IntegrationImport kind="mcp" gateway={api} onClose={() => {}} onImported={imported} />, { wrapper })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"mcpServers":{}}' } })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.preview' }))
  await screen.findByRole('checkbox', { name: second.name })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.import' }))
  expect(await screen.findByText('合成导入失败')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: source.name })).toBeDisabled()
  expect(screen.getByRole('textbox')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'extensions.preview' })).toBeDisabled()
  expect(imported).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'extensions.import' }))
  await waitFor(() => expect(imported).toHaveBeenCalledWith([source, second]))
  expect(api.saveMCP).toHaveBeenCalledTimes(3)
  expect(vi.mocked(api.saveMCP).mock.calls.map(call => call[0].name)).toEqual([source.name, second.name, second.name])
})

it('部分成功后可跳过失败项结束导入，父级仍接收成功来源', async () => {
  const api = gateway({ previewMCP: vi.fn(async () => [source.name, 'Failed MCP'].map(name => ({ name, mcp: source.mcp!, expected_revision: 0 }))),
    saveMCP: vi.fn().mockResolvedValueOnce(source).mockRejectedValueOnce(new Error('合成导入失败')) })
  const imported = vi.fn()
  render(<IntegrationImport kind="mcp" gateway={api} onClose={() => {}} onImported={imported} />, { wrapper })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"mcpServers":{}}' } })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.preview' }))
  await screen.findByRole('checkbox', { name: 'Failed MCP' })
  fireEvent.click(screen.getByRole('button', { name: 'extensions.import' }))
  await screen.findByText('合成导入失败')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Failed MCP' }))
  fireEvent.click(screen.getByRole('button', { name: 'extensions.finishImport' }))
  expect(imported).toHaveBeenCalledWith([source])
  expect(api.saveMCP).toHaveBeenCalledTimes(2)
})

it('预览进行中合并重复操作，并禁止 Escape 关闭弹窗', async () => {
  let complete!: (values: []) => void
  const api = gateway({ previewMCP: vi.fn(() => new Promise<[]>(resolve => { complete = resolve })) })
  const close = vi.fn()
  render(<IntegrationImport kind="mcp" gateway={api} onClose={close} onImported={() => {}} />, { wrapper })
  fireEvent.change(screen.getByRole('textbox'), { target: { value: '{"mcpServers":{}}' } })
  const preview = screen.getByRole('button', { name: 'extensions.preview' })
  fireEvent.click(preview); fireEvent.click(preview)
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', keyCode: 27 })
  expect(api.previewMCP).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'extensions.cancel' })).toBeDisabled()
  await act(async () => complete([]))
  await waitFor(() => expect(screen.getByText('extensions.importEmpty')).toBeVisible())
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
  expect(within(screen.getByRole('dialog')).queryByRole('alert')).not.toBeInTheDocument()
  expect(api.confirmLaunch).toHaveBeenCalledOnce()
  expect(api.enabled).not.toHaveBeenCalled()
})

it('HTTP 启用配置只展示地址和认证，不展示本地命令或安装字段', async () => {
  render(<MCPProvisionDialog sources={[{ ...source, mcp: { transport: 'http', url: 'https://example.test/mcp', auth: 'oauth' } }]} gateway={gateway()} onClose={() => {}} onChanged={() => {}} />, { wrapper })
  expect(screen.getByText('https://example.test/mcp')).toBeInTheDocument()
  expect(screen.getByText('OAuth')).toBeInTheDocument()
  expect(screen.queryByText('mcpPreparation.arguments')).not.toBeInTheDocument()
  expect(screen.queryByText('extensions.cwd')).not.toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'mcpPreparation.installationDetails' })).not.toBeInTheDocument()
})

it('托管安装就绪与启用完成分别展示，验证通过后才显示完成操作', async () => {
  const managed: AgentIntegrationSource = { ...source, mcp: { transport: 'stdio', mode: 'managed_npm', command: 'npx', args: ['fixture'] } }
  const installation = { id: 'prep_fixture', source_id: source.id, revision: 1, state: 'ready' as const,
    root: 'D:\\Termous\\packages', package: { name: 'fixture', version: '1.0.0', entry: 'cli.js', arguments: [], integrity: 'fixture' }, runtime: { node: 'node', npm: 'npm', identity: 'fixture' } }
  const api = gateway({ dependency: vi.fn(async () => installation) })
  const close = vi.fn()
  const test = vi.fn(async () => ({ tools: [], generation: 'fixture', source: { ...managed, enabled: true } }))
  native.value = { agentIntegrations: { test, cancel: vi.fn() } }
  render(<MCPProvisionDialog sources={[managed]} gateway={api} onClose={close} onChanged={() => {}} />, { wrapper })
  await waitFor(() => expect(screen.getByRole('button', { name: 'mcpPreparation.activate' })).toBeEnabled())
  expect(screen.getByText('mcpPreparation.states.ready')).toBeInTheDocument()
  expect(screen.getByText('mcpPreparation.awaitingValidation')).toBeInTheDocument()
  expect(screen.queryByText('mcpPreparation.done')).not.toBeInTheDocument()
  expect(screen.queryByText('mcpPreparation.installPolicy')).not.toBeInTheDocument()
  expect(test).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'mcpPreparation.activate' }))
  fireEvent.click(await screen.findByRole('button', { name: 'mcpPreparation.finish' }))
  expect(close).toHaveBeenCalledOnce()
  expect(api.confirmDependency).not.toHaveBeenCalled()
  expect(test).toHaveBeenCalledWith(expect.objectContaining({ candidate_id: installation.id }))
})

it('批量配置完成后显式进入下一项，新来源仍需单独验证', async () => {
  const second = { ...source, id: 'ext_second', name: 'Second MCP' }
  const test = vi.fn(async () => ({ tools: [], generation: 'fixture' }))
  native.value = { agentIntegrations: { test, cancel: vi.fn() } }
  render(<MCPProvisionDialog sources={[source, second]} gateway={gateway()} onClose={() => {}} onChanged={() => {}} />, { wrapper })
  await waitFor(() => expect(screen.getByRole('button', { name: 'mcpPreparation.activate' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'mcpPreparation.activate' }))
  fireEvent.click(await screen.findByRole('button', { name: 'mcpPreparation.next' }))
  expect(await screen.findByText(second.name)).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('button', { name: 'mcpPreparation.activate' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: 'mcpPreparation.finish' })).not.toBeInTheDocument()
  expect(test).toHaveBeenCalledOnce()
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
