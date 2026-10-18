import { Button, Tooltip } from 'antd'
import { Activity, RefreshCw, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentSetupController } from '../model/useAgentSetupController'
import styles from './AgentSetup.module.scss'

export function AgentReadinessSection({ runtime, dirty }: { runtime: AgentSetupController; dirty: boolean }) {
  const { t } = useTranslation()
  const readiness = runtime.readiness!
  const busy = runtime.loading || runtime.mutation !== null
  const state = readiness.status === 'ready' ? 'ready' : readiness.status === 'blocked' ? 'unavailable'
    : readiness.status === 'needs_repair' ? 'outdated' : 'missing'
  const fields = [['mcpRuntime', readiness.mcp_runtime], ['mcpClient', readiness.mcp_client],
    ['skills', readiness.skills_bundle], ['defaultModel', readiness.default_model]] as const
  return <section className={styles.surface}>
    <div className={styles['section-title']}><Activity size={16} aria-hidden="true" /><h2>{t('settings.agent.readiness.title')}</h2></div>
    <div className={styles['section-body']}>
      <header className={`${styles['section-header']} ${styles['runtime-header']}`}>
        <div className={styles['runtime-heading']}>
          <p className={styles['section-hint']}>{t('settings.agent.readiness.description')}</p>
        </div>
        <div className={styles['runtime-controls']}>
          <span className={`${styles['runtime-status']} ${styles[`is-${state}`]}`} role="status">
            <i aria-hidden="true" />{t(`settings.agent.componentState.${state}`)}
          </span>
          <Tooltip title={dirty ? t('settings.agent.configuration.saveBeforeCheck') : undefined}>
            <span><Button icon={readiness.status === 'ready' ? <RefreshCw size={14} /> : <Wrench size={14} />}
              loading={busy} disabled={busy || dirty}
              onClick={() => { void (readiness.status === 'ready' ? runtime.load() : runtime.setup()).catch(() => undefined) }}>
              {t(readiness.status === 'ready' ? 'settings.agent.readiness.checkAgain' : 'settings.agent.readiness.setup')}
            </Button></span>
          </Tooltip>
        </div>
      </header>
      <div className={styles['readiness-grid']}>{fields.map(([field, component]) =>
        <div key={field} className={styles['readiness-item']}>
          <span className={styles['readiness-copy']}><strong>{t(`settings.agent.readiness.${field}`)}</strong>
            <span className={`${styles['readiness-state']} ${styles[`is-${component.status}`]}`}>
              <i aria-hidden="true" />{t(`settings.agent.componentState.${component.status}`)}
            </span>
          </span>
        </div>)}</div>
    </div>
  </section>
}
