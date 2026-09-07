import { Bot, Check, CircleAlert, RefreshCw, Settings2, Wrench } from 'lucide-react'
import { Button, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentReadiness } from '#entities/agent'
import styles from './AgentPage.module.scss'

export function AgentReadinessSurface({
  readiness,
  loading,
  onPrepare,
  onRefresh,
}: {
  readiness: AgentReadiness | null
  loading: boolean
  onPrepare: () => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  if (!readiness && loading) return <div className={styles.readiness}><Skeleton active paragraph={{ rows: 6 }} /></div>
  const components = readiness ? [
    ['mcpRuntime', readiness.mcp_runtime],
    ['mcpClient', readiness.mcp_client],
    ['skills', readiness.skills_bundle],
    ['defaultModel', readiness.default_model],
  ] as const : []
  return (
    <section className={styles.readiness}>
      <div className={styles['readiness-mark']}><Bot size={24} /></div>
      <h1>{t('agent.readiness.title')}</h1>
      <p>{t('agent.readiness.description', {
        count: readiness?.mcp_policy?.required_scope_count ?? 29,
      })}</p>
      {readiness ? <div className={styles['readiness-list']}>{components.map(([key, component]) => (
        <div key={key}>
          <span className={component.status === 'ready' ? styles['is-ready'] : ''}>
            {component.status === 'ready' ? <Check size={14} /> : <CircleAlert size={14} />}
          </span>
          <strong>{t(`settings.agent.readiness.${key}`)}</strong>
          <em>{t(`settings.agent.componentState.${component.status}`)}</em>
        </div>
      ))}</div> : <p className={styles['readiness-error']}>{t('agent.readiness.loadFailed')}</p>}
      <div className={styles['readiness-actions']}>
        <Button icon={<RefreshCw size={15} />} disabled={loading} onClick={onRefresh}>{t('app.retry')}</Button>
        <Button type="primary" icon={readiness?.status === 'ready' ? <Settings2 size={15} /> : <Wrench size={15} />} loading={loading} onClick={onPrepare}>
          {t('agent.readiness.prepare')}
        </Button>
      </div>
    </section>
  )
}
