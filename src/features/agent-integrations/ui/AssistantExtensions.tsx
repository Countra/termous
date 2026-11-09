import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { App, Button, Space, Tabs, Tooltip } from 'antd'
import { ChevronRight, FileInput, Plus, RefreshCw, Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getTermousBridge } from '#shared/bridge'
import { FeedbackMessage, FeedbackMessageScope } from '#shared/ui'
import type { AgentIntegrationSource, AgentIntegrationsGateway } from '#entities/agent-integrations'
import { MCPSourceEditor } from './MCPSourceEditor'
import { IntegrationImport } from './IntegrationImport'
import { IntegrationDetails } from './IntegrationDetails'
import styles from './AssistantExtensions.module.scss'
import type { IntegrationConnectionStatus } from '#common/agent-integrations'
import { MCPProvisionDialog } from './MCPProvisionDialog'
import { invokeIntegration } from '../model/nativeOperation'
import { integrationFailure } from '../model/errors'
import { IntegrationSourceList, type IntegrationSourceAction } from './IntegrationSourceList'
import { IntegrationEmptyState } from './IntegrationEmptyState'

type IntegrationOperation = 'toggle' | 'test' | 'login' | 'reconnect' | 'remove'

export function AssistantExtensions({gateway,active = true, installationSettings, searchSettings, onBusyChange}: {
  gateway?:AgentIntegrationsGateway;active?:boolean;installationSettings?:ReactNode;searchSettings?:ReactNode;onBusyChange?: (busy: boolean) => void
}) {
  const { t } = useTranslation()
  const { message, modal } = App.useApp()
  const [kind,setKind] = useState<'mcp' | 'skill' | 'search'>('mcp')
  const [sources,setSources] = useState<AgentIntegrationSource[]>([])
  const [connections,setConnections] = useState<IntegrationConnectionStatus[]>([])
  const [loading,setLoading] = useState(false)
  const [busy,setBusy] = useState<{ id: string; operation: IntegrationOperation; cancelling?: boolean }>()
  const [error,setError] = useState('')
  const [editor,setEditor] = useState<AgentIntegrationSource | 'new'>()
  const [importing,setImporting] = useState<AgentIntegrationSource | 'new'>()
  const [provision,setProvision] = useState<AgentIntegrationSource[]>([])
  const [details,setDetails] = useState<AgentIntegrationSource>()
  const interactionBusy = Boolean(busy || editor || importing || provision.length || details)
  useLayoutEffect(() => { onBusyChange?.(interactionBusy) }, [interactionBusy, onBusyChange])
  useLayoutEffect(() => () => onBusyChange?.(false), [onBusyChange])
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
    setBusy(undefined); setLoading(false)
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
  const perform = async (id:string, operation:(signal:AbortSignal)=>Promise<unknown>, activity: IntegrationOperation) => {
    if (controller.current) return
    const abort = new AbortController();controller.current=abort
    setBusy({ id, operation: activity });setError('')
    if (activity === 'toggle') {
      // 旧查询不能覆盖本次开关操作已确认的新版本。
      loadController.current?.abort();setLoading(false)
    }
    let reconcile = true
    try {await operation(abort.signal);reconcile = activity !== 'toggle'}
    catch (error) {
      if (controller.current === abort && (!abort.signal.aborted || error !== abort.signal.reason)) {
        setError(abort.signal.aborted ? t('extensions.cancelFailed') : integrationFailure(error, t))
      }
    }
    finally {
      if (controller.current===abort) {
        // 失败或取消后仍需对账；登录取消也可能已使旧认证版本失效。
        if (reconcile) await reload()
        if (controller.current===abort) {controller.current=null;setBusy(undefined)}
      }
    }
  }
  const cancelOperation = () => {
    const abort = controller.current
    if (!abort || abort.signal.aborted) return
    setBusy(value => value ? { ...value, cancelling: true } : value)
    abort.abort()
  }
  const nativeOperation = async (source:AgentIntegrationSource,operation:'test' | 'login' | 'reconnect',signal:AbortSignal) => {
    if (!native) throw new Error(t('extensions.desktopRequired'))
    return invokeIntegration(native,source,operation,signal)
  }
  const test = async (source:AgentIntegrationSource,signal:AbortSignal) => nativeOperation(source,'test',signal) as Promise<{tools:unknown[]}>
  const completed = (saved?: AgentIntegrationSource | AgentIntegrationSource[]) => {setEditor(undefined);setImporting(undefined); if (saved) setProvision(Array.isArray(saved) ? saved : [saved]); void reload()}
  const toggle = (source: AgentIntegrationSource, enabled: boolean) => {
    if (!gateway || controller.current) return
    if (enabled && source.kind === 'mcp') { setProvision([source]); return }
    void perform(source.id, async signal => {
      const updated = await gateway.enabled(source, enabled, signal)
      if (!signal.aborted) {
        // 操作期间详情关闭也可能触发查询，确认回执后使这些旧快照一并失效。
        loadController.current?.abort();setLoading(false)
        setSources(values => values.map(value => value.id === updated.id && value.revision <= updated.revision ? updated : value))
      }
    }, 'toggle')
  }
  const action = (source: AgentIntegrationSource, action: IntegrationSourceAction) => {
    if (!gateway || busy) return
    if (action === 'edit') { setEditor(source); return }
    if (action === 'update') { setImporting(source); return }
    if (action === 'remove' || action === 'reconnect') {
      modal.confirm({ title: t(action === 'remove' ? 'extensions.deleteConfirm' : 'extensions.reconnectConfirm', { name: source.name }),
        okText: t(action === 'remove' ? 'extensions.delete' : 'extensions.reconnect'), cancelText: t('extensions.cancel'), okButtonProps: { danger: action === 'remove' },
        onOk: () => perform(source.id, signal => action === 'remove' ? gateway.remove(source, signal) : nativeOperation(source, 'reconnect', signal), action) })
      return
    }
    if (action === 'test' && (!source.startup_confirmed || source.mcp?.mode === 'managed_npm' && !source.mcp.dependency_id)) { setProvision([source]); return }
    void perform(source.id, async signal => {
      if (action === 'login') await nativeOperation(source, 'login', signal)
      else { const result = await test(source, signal); void message.success(t('extensions.connected', { count: result.tools.length })) }
    }, action)
  }
  const content = <div className={styles.content} data-tour={`extensions-${kind}`}>{kind === 'search' ? searchSettings : <>
    <div className={styles.toolbar}>
      <div><h3>{t(kind === 'mcp' ? 'extensions.mcpHeading' : 'extensions.skillHeading')}</h3><p>{t(kind === 'mcp' ? 'extensions.mcpHint' : 'extensions.skillHint')}</p></div>
      <Space size={8}><Tooltip title={t('extensions.refresh')}><Button type="text" aria-label={t('extensions.refresh')} icon={<RefreshCw size={15}/>} loading={loading} disabled={Boolean(busy) || !gateway} onClick={() => { setError(''); void reload() }} /></Tooltip>
        <Button type={kind === 'skill' ? 'primary' : 'default'} icon={<FileInput size={15}/>} disabled={Boolean(busy) || !gateway} onClick={() => setImporting('new')}>{t(kind === 'skill' ? 'extensions.importSkills' : 'extensions.importJSON')}</Button>
        {kind==='mcp' && <Button type="primary" icon={<Plus size={15}/>} disabled={Boolean(busy) || !gateway} onClick={() => setEditor('new')}>{t('extensions.addMCP')}</Button>}</Space>
    </div>
    {error && <FeedbackMessage type="error" title={error} onClose={() => setError('')} />}
    {gateway ? <IntegrationSourceList key={kind} sources={sources.filter(source => source.kind === kind)} connections={connections} kind={kind} loading={loading} busy={busy?.id ?? ''} toggling={busy?.operation === 'toggle'} onInspect={setDetails} onToggle={toggle} onAction={action} /> : <IntegrationEmptyState kind={kind} title={t('extensions.unavailable')} description={t('extensions.unavailableHint')} />}
    {kind === 'mcp' && installationSettings && <details className={styles.runtime}><summary data-tour="extensions-installation"><Settings2 size={15} /><span>{t('extensions.installationTitle')}</span><small>{t('extensions.installationHint')}</small><ChevronRight size={14} /></summary><div>{installationSettings}</div></details>}
    </>}</div>
  return <FeedbackMessageScope active={active} scope="settings:extensions"><section className={styles.root} data-editing={Boolean(editor) || undefined}>
    {busy && busy.operation !== 'toggle' && <FeedbackMessage type="loading" title={t(busy.cancelling ? 'extensions.cancelling' : `extensions.operation.${busy.operation}`)} description={sources.find(source => source.id === busy.id)?.name}
      action={<Button size="small" disabled={busy.cancelling} onClick={cancelOperation}>{t('extensions.cancel')}</Button>} />}
    {gateway && editor ? <MCPSourceEditor gateway={gateway} source={editor==='new' ? undefined : editor} onClose={() => setEditor(undefined)} onSaved={completed} /> : <Tabs className={styles.tabs} activeKey={kind} onChange={value => setKind(value as typeof kind)} destroyOnHidden items={[
      { key: 'mcp', label: <span data-tour="extensions-mcp-tab">{t('extensions.mcpTab')}<small>{sources.filter(source => source.kind === 'mcp').length}</small></span>, children: kind === 'mcp' ? content : undefined },
      { key: 'skill', label: <span data-tour="extensions-skill-tab">{t('extensions.skillTab')}<small>{sources.filter(source => source.kind === 'skill').length}</small></span>, children: kind === 'skill' ? content : undefined },
      ...(searchSettings ? [{ key: 'search', label: <span data-tour="extensions-search-tab">{t('webSearch.title')}</span>, children: kind === 'search' ? content : undefined }] : []),
    ]} />}
    {gateway && <>
      {provision.length > 0 && <MCPProvisionDialog sources={provision} gateway={gateway} onClose={() => {setProvision([]);void reload()}} onChanged={() => void reload()} />}
      {importing && <IntegrationImport kind={kind === 'skill' ? 'skill' : 'mcp'} gateway={gateway} source={importing==='new' ? undefined : importing} onClose={() => setImporting(undefined)} onImported={completed} />}
      {details && <IntegrationDetails source={details} gateway={gateway} onClose={() => {setDetails(undefined);void reload()}} onChanged={source => {setDetails(source);void reload()}} />}
    </>}
  </section></FeedbackMessageScope>
}
