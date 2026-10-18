import { useId } from 'react'
import { BookOpen, Bot, BrainCircuit, Check, CircleAlert, LoaderCircle, RefreshCw, Server, ShieldCheck, Wrench } from 'lucide-react'
import { Button, Skeleton } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentReadiness } from '#entities/agent'
import styles from './AgentReadinessSurface.module.scss'

export function AgentReadinessSurface({
  readiness,
  loading,
  onPrepare,
  onRefresh,
  remote = false,
}: {
  readiness: AgentReadiness | null
  loading: boolean
  onPrepare?: () => void
  remote?: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const checking = !readiness && loading
  const titleKey = !readiness
    ? checking ? 'nav.agent' : 'agent.readiness.unavailableTitle'
    : remote ? 'agent.readiness.remoteTitle' : 'agent.readiness.title'
  const components = readiness ? [
    ['mcpRuntime', readiness.mcp_runtime, Server],
    ['mcpClient', readiness.mcp_client, ShieldCheck],
    ['skills', readiness.skills_bundle, BookOpen],
    ['defaultModel', readiness.default_model, BrainCircuit],
  ] as const : []
  const actions = <>
    <Button type={remote ? 'primary' : 'default'} icon={<RefreshCw size={15} />} loading={loading && (remote || !onPrepare)} disabled={loading} onClick={onRefresh}>{t('agent.readiness.refreshStatus')}</Button>
    {!remote && onPrepare ? <Button type="primary" icon={<Wrench size={15} />} loading={loading} onClick={onPrepare}>
      {t('agent.readiness.prepare')}
    </Button> : null}
  </>
  return (
    <section className={styles.surface} aria-labelledby={titleId} aria-busy={loading}>
      <div className={styles.panel}>
        <header className={styles.heading}>
          <span className={styles.mark}><Bot size={23} aria-hidden="true" /></span>
          <div className={styles.intro}>
            <h1 id={titleId}>{t(titleKey)}</h1>
            <p>{t(remote ? 'agent.readiness.remoteDescription' : 'agent.readiness.description')}</p>
          </div>
        </header>
        {readiness ? <ul className={styles.components}>
          {components.map(([key, component, Icon]) => <li key={key} data-ready={component.status === 'ready'}>
            <span className={styles['component-mark']}><Icon size={17} aria-hidden="true" /></span>
            <strong>{t(`settings.agent.readiness.${key}`)}</strong>
            <span className={styles.status}>
              {component.status === 'ready' ? <Check size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}
              {t(`settings.agent.componentState.${component.status}`)}
            </span>
          </li>)}
        </ul> : checking ? <div className={styles.checking} role="status" aria-label={t('agent.readiness.checking')}>
          <Skeleton active title={false} paragraph={{ rows: 4, width: '100%' }} />
        </div> : <div className={styles.error} role="alert"><CircleAlert size={18} /><p>{t('agent.readiness.loadFailed')}</p></div>}
        <footer className={styles.footer}>
          {!remote && readiness && readiness.default_model.status !== 'ready' && <p className={styles.hint}>{t('agent.readiness.modelHint')}</p>}
          {checking ? <span className={styles.progress}><LoaderCircle size={15} aria-hidden="true" />{t('agent.readiness.checking')}</span>
            : <div className={styles.actions}>{actions}</div>}
        </footer>
      </div>
    </section>
  )
}
