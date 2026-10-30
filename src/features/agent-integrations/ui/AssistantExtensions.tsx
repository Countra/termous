import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Empty, Popconfirm, Space, Switch, Table, Tabs, Tag, Tooltip } from 'antd'
import { FileInput, Plus, RefreshCw, Settings2, Trash2, Unplug } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'
import { MCPSourceEditor } from './MCPSourceEditor'
import { IntegrationImport } from './IntegrationImport'
import { IntegrationDetails } from './IntegrationDetails'
import styles from './AssistantExtensions.module.scss'
import type { IntegrationConnectionStatus } from '#common/agent-integrations'
import { MCPProvisionDialog } from './MCPProvisionDialog'
import { invokeIntegration } from '../model/nativeOperation'
import { integrationFailure } from '../model/errors'

export function AssistantExtensions({gateway,active = true}: {gateway?:AgentIntegrationsGateway;active?:boolean}) {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [kind,setKind] = useState<'mcp' | 'skill'>('mcp')
  const [sources,setSources] = useState<AgentIntegrationSource[]>([])
  const [connections,setConnections] = useState<IntegrationConnectionStatus[]>([])
  const [loading,setLoading] = useState(false)
  const [busy,setBusy] = useState('')
  const [error,setError] = useState('')
  const [editor,setEditor] = useState<AgentIntegrationSource | 'new'>()
  const [importing,setImporting] = useState<AgentIntegrationSource | 'new'>()
  const [provision,setProvision] = useState<AgentIntegrationSource[]>([])
  const [details,setDetails] = useState<AgentIntegrationSource>()
  const controller = useRef<AbortController | null>(null)
  const loadController = useRef<AbortController | null>(null)
  const native = getTermousBridge()?.agentIntegrations
  const reload = useCallback(async () => {
    if (!gateway || !active) return
    loadController.current?.abort()
    const abort = new AbortController();loadController.current = abort
    setLoading(true)
    try {
      const [values, status] = await Promise.all([gateway.sources(abort.signal), native?.status() ?? []])
      if (!abort.signal.aborted) {setSources(values);setConnections(status)}
    }
    catch (error) { if (!abort.signal.aborted) setError(integrationFailure(error, t)) }
    finally { if (!abort.signal.aborted) setLoading(false) }
  },[gateway,active,t,native])
  useEffect(() => {
    setBusy(''); setLoading(false)
    void reload()
    return () => {loadController.current?.abort();controller.current?.abort();controller.current=null}
  },[reload])
  useEffect(() => {
    if (!active || !native) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = async () => {
      try { const status = await native.status(); if (!disposed) setConnections(status) }
      catch (cause) { if (!disposed) setError(integrationFailure(cause, t)) }
      finally { if (!disposed) timer = setTimeout(() => { void update() }, 2000) }
    }
    timer = setTimeout(() => { void update() }, 2000)
    return () => { disposed = true; clearTimeout(timer) }
  }, [active, native, t])
  const perform = async (id:string, operation:(signal:AbortSignal)=>Promise<unknown>) => {
    if (controller.current) return
    const abort = new AbortController();controller.current=abort
    setBusy(id);setError('')
    try {await operation(abort.signal)}
    catch (error) {if (!abort.signal.aborted) setError(integrationFailure(error, t))}
    finally {
      if (controller.current===abort) {
        controller.current=null;setBusy('')
        // 登录取消也可能已使旧认证版本失效，始终重新读取实际状态。
        await reload()
      }
    }
  }
  const nativeOperation = async (source:AgentIntegrationSource,operation:'test' | 'login' | 'reconnect',signal:AbortSignal) => {
    if (!native) throw new Error(t('extensions.desktopRequired'))
    return invokeIntegration(native,source,operation,signal)
  }
  const test = async (source:AgentIntegrationSource,signal:AbortSignal) => nativeOperation(source,'test',signal) as Promise<{tools:unknown[]}>
  const completed = (saved?: AgentIntegrationSource | AgentIntegrationSource[]) => {setEditor(undefined);setImporting(undefined); if (saved) setProvision(Array.isArray(saved) ? saved : [saved]); void reload()}
  if (!gateway) return <Empty description={t('extensions.unavailable')} />
  return <section className={styles.root}>
    <div className={styles.toolbar}>
      <Tabs activeKey={kind} onChange={value => setKind(value as typeof kind)} items={[{key:'mcp',label:'MCP'},{key:'skill',label:'Skills'}]} />
      <Space><Tooltip title={t('extensions.refresh')}><Button aria-label={t('extensions.refresh')} icon={<RefreshCw size={15}/>} loading={loading} disabled={Boolean(busy)} onClick={() => void reload()} /></Tooltip>
        <Button icon={<FileInput size={15}/>} disabled={Boolean(busy)} onClick={() => setImporting('new')}>{t('extensions.import')}</Button>
        {kind==='mcp' && <Button type="primary" icon={<Plus size={15}/>} disabled={Boolean(busy)} onClick={() => setEditor('new')}>{t('extensions.addMCP')}</Button>}</Space>
    </div>
    <p className={styles.hint}>{t(kind==='mcp' ? 'extensions.mcpHint' : 'extensions.skillHint')}</p>
    {busy && <Button onClick={() => controller.current?.abort()}>{t('extensions.cancel')}</Button>}
    {error && <Alert type="error" title={error} showIcon closable onClose={() => setError('')} />}
    <Table rowKey="id" size="small" tableLayout="fixed" scroll={{x:560}} loading={loading} dataSource={sources.filter(source => source.kind===kind)} pagination={{pageSize:12,showSizeChanger:false}}
      locale={{emptyText:<Empty image={<Unplug size={30}/>} description={t('extensions.empty')} />}}
      columns={[
        {title:t('extensions.name'),dataIndex:'name',render:(_,source:AgentIntegrationSource) => <button className={styles.source} onClick={() => setDetails(source)}><strong>{source.name}</strong>
          <span title={source.kind==='skill' ? source.skill?.description : source.mcp?.transport==='stdio' ? source.mcp.command : source.mcp?.url}>{source.kind==='skill' ? source.skill?.description : source.mcp?.transport==='stdio' ? source.mcp.command : source.mcp?.url}</span>
          <span>{source.kind==='mcp' ? source.mcp?.transport==='http' ? 'HTTP' : 'stdio' : 'Skill'}</span></button>},
        {title:t('extensions.status'),width:88,render:(_,source:AgentIntegrationSource)=>{
          const status=connections.filter(value=>value.source===source.id && value.revision===source.revision)
          const current = status.find(value => value.state === 'connected') ?? status.sort((a,b) => (b.status_revision ?? 0) - (a.status_revision ?? 0))[0]
          return source.kind==='mcp' ? <Tooltip title={current?.diagnostic?.message}><Tag>{t(source.auth_state==='required' ? 'extensions.loginRequired' : current ? `mcpPreparation.connectionStates.${current.state}` : 'extensions.idle')}</Tag></Tooltip> : null
        }},
        {title:t('extensions.enabled'),width:64,render:(_,source:AgentIntegrationSource)=><Switch size="small" checked={source.enabled} loading={busy===source.id} disabled={Boolean(busy)}
          aria-label={`${t('extensions.enabled')} ${source.name}`} onChange={enabled => { if (enabled && source.kind==='mcp') { setProvision([source]); return }; void perform(source.id, signal => gateway.enabled(source,enabled,signal)) }} />},
        {title:t('extensions.actions'),width:208,render:(_,source:AgentIntegrationSource)=><Space size={4} wrap>
          {source.mcp?.auth==='oauth' && <Button size="small" disabled={Boolean(busy)} onClick={() => void perform(source.id,signal => nativeOperation(source,'login',signal))}>{t(source.auth_state==='authorized' ? 'extensions.relogin' : 'extensions.login')}</Button>}
          {source.kind==='mcp' && source.enabled && <Popconfirm title={t('extensions.reconnectConfirm')} onConfirm={()=>perform(source.id,signal=>nativeOperation(source,'reconnect',signal))}>
            <Button size="small" disabled={Boolean(busy)}>{t('extensions.reconnect')}</Button></Popconfirm>}
          {source.kind==='mcp' ? <Button size="small" disabled={Boolean(busy)} onClick={() => { if (!source.startup_confirmed || source.mcp?.mode === 'managed_npm' && !source.mcp.dependency_id) { setProvision([source]); return }; void perform(source.id,async signal => {const result=await test(source,signal);void message.success(t('extensions.connected',{count:result.tools.length}))}) }}>{t('extensions.test')}</Button>
            : <Button size="small" disabled={Boolean(busy)} onClick={() => setImporting(source)}>{t('extensions.update')}</Button>}
          {source.kind==='mcp' && <Button size="small" aria-label={t('extensions.edit')} icon={<Settings2 size={14}/>} disabled={Boolean(busy)} onClick={() => setEditor(source)} />}
          <Popconfirm title={t('extensions.deleteConfirm',{name:source.name})} onConfirm={() => perform(source.id,signal => gateway.remove(source,signal))}>
            <Button size="small" danger aria-label={t('extensions.delete')} icon={<Trash2 size={14}/>} disabled={Boolean(busy)} /></Popconfirm>
        </Space>},
      ]} />
    {provision.length > 0 && <MCPProvisionDialog sources={provision} gateway={gateway} onClose={() => {setProvision([]);void reload()}} onChanged={() => void reload()} />}
    {editor && <MCPSourceEditor gateway={gateway} source={editor==='new' ? undefined : editor} onClose={() => setEditor(undefined)} onSaved={completed} />}
    {importing && <IntegrationImport kind={kind} gateway={gateway} source={importing==='new' ? undefined : importing} onClose={() => setImporting(undefined)} onImported={completed} />}
    {details && <IntegrationDetails source={details} gateway={gateway} onClose={() => {setDetails(undefined);void reload()}} onChanged={source => {setDetails(source);void reload()}} />}
  </section>
}
