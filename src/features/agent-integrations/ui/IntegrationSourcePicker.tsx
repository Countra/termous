import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Empty, Popover, Space, Spin, Switch, Tabs, Tooltip } from 'antd'
import { Blocks } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { IntegrationPolicy, IntegrationSelection } from '#entities/agent-integrations'
import styles from './AssistantExtensions.module.scss'

export function IntegrationSourcePicker({sessionKey,read,change,disabled}: {
  sessionKey:string;read?:()=>Promise<IntegrationSelection>;change?:(policy:IntegrationPolicy)=>Promise<void>;disabled?:boolean
}) {
  const { t }=useTranslation()
  const [open,setOpen]=useState(false)
  const [kind,setKind]=useState('mcp')
  const [data,setData]=useState<IntegrationSelection>()
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const epoch = useRef(0)
  const mutation = useRef(false)
  useEffect(() => {
    const readEpoch = ++epoch.current
    mutation.current = false
    setData(undefined);setBusy(false)
    if (!open || !read) return
    let active=true
    setBusy(true);setError('')
    void read().then(value => {if (active) setData(value)},error => {if (active) setError(error instanceof Error ? error.message : t('extensions.failed'))})
      .finally(() => {if (active) setBusy(false)})
    return () => {active=false;epoch.current=readEpoch+1}
  },[open,sessionKey,read,t])
  const update=async (policy:IntegrationPolicy) => {
    if (!change || busy || mutation.current) return
    const currentEpoch = epoch.current
    mutation.current = true
    setBusy(true);setError('')
    try {await change(policy);if (epoch.current === currentEpoch) setData(current => current && {...current,policies:[...current.policies.filter(value => value.source_id!==policy.source_id),policy]})}
    catch(error) {if (epoch.current === currentEpoch) setError(error instanceof Error ? error.message : t('extensions.failed'))}
    finally {if (epoch.current === currentEpoch) {mutation.current = false;setBusy(false)}}
  }
  if (!read || !change) return null
  return <Popover open={open && !disabled} onOpenChange={setOpen} trigger="click" placement="topLeft" destroyOnHidden content={<div className={styles.picker}>
    <Tabs activeKey={kind} onChange={setKind} items={[{key:'mcp',label:'MCP'},{key:'skill',label:'Skills'}]}/>
    <Spin spinning={busy}><div className={styles['picker-items']}>
      {data?.sources.filter(source => source.kind===kind).map(source => {
        const policy=data.policies.find(policy => policy.source_id===source.id) ?? {source_id:source.id,disabled:false}
        return <div className={styles['picker-item']} key={source.id}><Space><Switch size="small" checked={source.enabled && !policy.disabled} disabled={!source.enabled || busy}
          aria-label={`${t('extensions.sessionEnabled')} ${source.name}`} onChange={checked => void update({...policy,disabled:!checked})}/><strong>{source.name}</strong></Space>
          {source.kind==='skill' && <Checkbox disabled={!source.enabled || policy.disabled || busy} checked={Boolean(source.version && policy.skill_version===source.version)}
            onChange={event => void update({...policy,skill_version:event.target.checked ? source.version : ''})}>{t('extensions.selectSkill')}</Checkbox>}
          {!source.enabled && <span className={styles.muted}>{t('extensions.enableInSettings')}</span>}
        </div>
      })}
      {data && !data.sources.some(source=>source.kind===kind) && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('extensions.empty')}/>}
    </div></Spin>
    {error && <Alert type="error" title={error} />}
  </div>}><Tooltip title={t('extensions.title')}><Button type="text" icon={<Blocks size={15}/>} disabled={disabled} aria-label={t('extensions.title')}/></Tooltip></Popover>
}
