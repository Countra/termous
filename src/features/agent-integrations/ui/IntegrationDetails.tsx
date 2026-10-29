import { useEffect, useRef, useState } from 'react'
import { Alert, Empty, Input, Modal, Select, Switch, Table, Tag, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import { modalSurfaceStyles } from '#shared/ui'
import type { AgentIntegrationSource, AgentIntegrationsGateway, IntegrationToolSummary } from '#entities/agent-integrations'
import styles from './AssistantExtensions.module.scss'
import { SkillFilePreview } from './SkillFilePreview'
import { MCPDependencyPanel } from './MCPDependencyPanel'

export function IntegrationDetails({source,gateway,onClose,onChanged}: {source:AgentIntegrationSource;gateway:AgentIntegrationsGateway;onClose():void;onChanged(source:AgentIntegrationSource):void}) {
  const { t } = useTranslation()
  const [tools,setTools] = useState<IntegrationToolSummary[]>([])
  const [path,setPath] = useState('SKILL.md')
  const [search,setSearch] = useState('')
  const [busy,setBusy] = useState(true)
  const [error,setError] = useState('')
  const [permissions,setPermissions] = useState<Array<{tool:string;trusted:boolean}>>([])
  const [updating,setUpdating] = useState('')
  const [missing,setMissing] = useState<string[]>([])
  const mutation=useRef<AbortController | null>(null)
  useEffect(() => () => mutation.current?.abort(),[])
  const changePermission=async (tool:string,trusted:boolean) => {
    if (mutation.current) return
    const abort=new AbortController();mutation.current=abort
    setUpdating(tool);setError('')
    try {
      await gateway.setPermission(source.id,source.revision,tool,trusted,abort.signal)
      if (!abort.signal.aborted) setPermissions(current => [...current.filter(item=>item.tool!==tool),{tool,trusted}])
    } catch(error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t('extensions.failed')) }
    finally { if (mutation.current===abort) mutation.current=null;if (!abort.signal.aborted) setUpdating('') }
  }
  useEffect(() => {
    const abort = new AbortController()
    setBusy(true);setError('')
    const load = async () => {
      if (source.kind === 'mcp') {
        const [tools,permissions]=await Promise.all([gateway.tools(source.id,source.revision,abort.signal),gateway.permissions(source.id,source.revision,abort.signal)])
        if (!abort.signal.aborted) {setTools(tools);setPermissions(permissions)}
      } else if (source.skill) {
        const values = await gateway.skillDependencies(source.id,source.skill.version,abort.signal)
        if (!abort.signal.aborted) setMissing(values)
      }

    }
    void load().catch(error => {if (!abort.signal.aborted) setError(error instanceof Error ? error.message : t('extensions.failed'))})
      .finally(() => {if (!abort.signal.aborted) setBusy(false)})
    return () => abort.abort()
  },[gateway,source,t])
  return <Modal open centered width={820} rootClassName={modalSurfaceStyles.root} title={source.name} onCancel={onClose} footer={null} destroyOnHidden>
    <div className={styles.details}>
      {source.kind === 'mcp' ? <>
        {source.mcp?.transport === 'stdio' && (source.mcp.dependency_id || /(?:^|[/\\])npx(?:\.cmd|\.exe)?$/iu.test(source.mcp.command ?? '')) &&
          <MCPDependencyPanel key={`${source.id}:${source.revision}`} source={source} gateway={gateway} onChanged={onChanged} />}
        <Input.Search value={search} onChange={event => setSearch(event.target.value)} placeholder={t('extensions.searchTools')} allowClear />
        <Table rowKey="name" size="small" loading={busy} dataSource={tools.filter(tool => `${tool.name} ${tool.description ?? ''}`.toLowerCase().includes(search.toLowerCase()))}
          pagination={{pageSize:12,showSizeChanger:false}} locale={{emptyText:<Empty description={t('extensions.noTools')} />}}
          columns={[{title:t('extensions.tool'),dataIndex:'name',render:(_,tool:IntegrationToolSummary) => <div className={styles.tool}><strong>{tool.title || tool.name}</strong><code>{tool.name}</code><span>{tool.description}</span></div>},
            {title:t('extensions.status'),width:100,render:(_,tool:IntegrationToolSummary) => tool.unavailable_reason ? <Tag color="warning" title={tool.unavailable_reason}>{t('extensions.unavailable')}</Tag> : <Tag>{t('extensions.available')}</Tag>},
            {title:t('extensions.trusted'),width:110,render:(_,tool:IntegrationToolSummary)=><Tooltip title={t('extensions.trustHint')}><Switch size="small" aria-label={`${t('extensions.trusted')} ${tool.name}`}
              checked={permissions.some(item=>item.tool===tool.name && item.trusted)} loading={updating===tool.name} disabled={Boolean(updating || tool.unavailable_reason)} onChange={value=>void changePermission(tool.name,value)}/></Tooltip>}]} />
      </> : <>
        {!busy && missing.length > 0 && <Alert type="info" showIcon title={t('extensions.dependenciesMissing',{names:missing.join(', ')})}/>}
        <Select value={path} showSearch optionFilterProp="label" onChange={setPath} options={source.skill?.files.map(file => ({value:file.path,label:file.path}))} />
        <SkillFilePreview key={path} source={source} path={path} gateway={gateway} />
      </>}
      {error && <Alert type="error" title={error} showIcon />}
    </div>
  </Modal>
}
