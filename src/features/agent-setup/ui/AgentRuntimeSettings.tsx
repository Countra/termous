import { useState } from 'react'
import { Button, Switch } from 'antd'
import {
  BrainCircuit,
  ChartNoAxesColumnIncreasing,
  Check,
  CircleAlert,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentReadinessComponent } from '#entities/agent'
import { ConfirmDialog } from '#shared/ui'
import type { AgentSetupController } from '../model/useAgentSetupController.ts'
import { AgentGlobalModelDefaults } from './AgentGlobalModelDefaults.tsx'
import styles from './AgentSetup.module.scss'

export function AgentRuntimeSettings({
  runtime,
  onDefaultsConflictVisibilityChange,
}: {
  runtime: AgentSetupController
  onDefaultsConflictVisibilityChange: (visible: boolean) => void
}) {
  const { t } = useTranslation()
  const [confirmBypass, setConfirmBypass] = useState(false)
  const readiness = runtime.readiness
  if (!readiness) return null

  const busy = runtime.loading || runtime.mutation !== null
  const readinessState = readiness.status === 'ready'
    ? 'ready'
    : readiness.status === 'blocked'
      ? 'unavailable'
      : readiness.status === 'needs_repair'
        ? 'outdated'
        : 'missing'

  return (
    <>
      <section className={`${styles.surface} ${styles['runtime-surface']}`}>
        <header className={`${styles['section-header']} ${styles['runtime-header']}`}>
          <div className={styles['runtime-heading']}>
            <span className={styles['runtime-icon']} aria-hidden="true">
              <BrainCircuit size={18} />
            </span>
            <div>
              <div className={styles['section-title']}>
                <h2>{t('settings.agent.readiness.title')}</h2>
              </div>
              <p className={styles['section-hint']}>{t('settings.agent.readiness.description')}</p>
            </div>
          </div>
          <div className={styles['runtime-controls']}>
            <span
              className={`${styles['runtime-status']} ${styles[`is-${readinessState}`]}`}
              role="status"
            >
              <i aria-hidden="true" />
              {t(`settings.agent.componentState.${readinessState}`)}
            </span>
            <Button
              type={readiness.status === 'ready' ? 'default' : 'primary'}
              icon={readiness.status === 'ready' ? <RefreshCw size={15} /> : <Wrench size={15} />}
              loading={runtime.mutation === 'setup'}
              disabled={busy && runtime.mutation !== 'setup'}
              onClick={() => consume(runtime.setup())}
            >
              {t(readiness.status === 'ready'
                ? 'settings.agent.readiness.checkAgain'
                : 'settings.agent.readiness.setup')}
            </Button>
          </div>
        </header>

        <div className={styles['readiness-grid']}>
          <ReadinessItem label={t('settings.agent.readiness.mcpRuntime')} component={readiness.mcp_runtime} />
          <ReadinessItem label={t('settings.agent.readiness.mcpClient')} component={readiness.mcp_client} />
          <ReadinessItem label={t('settings.agent.readiness.skills')} component={readiness.skills_bundle} />
          <ReadinessItem label={t('settings.agent.readiness.defaultModel')} component={readiness.default_model} />
        </div>

        <div className={styles['agent-setting-list']}>
          <AgentGlobalModelDefaults
            runtime={runtime}
            onConflictVisibilityChange={onDefaultsConflictVisibilityChange}
          />

          <section className={styles['agent-setting-row']} aria-labelledby="agent-turn-usage-title">
            <span className={styles['agent-setting-icon']} aria-hidden="true">
              <ChartNoAxesColumnIncreasing size={16} />
            </span>
            <div className={styles['agent-setting-copy']}>
              <strong id="agent-turn-usage-title">{t('settings.agent.turnUsage.title')}</strong>
              <span>{t('settings.agent.turnUsage.description')}</span>
            </div>
            <div className={styles['toggle-control']}>
              <span>{t(readiness.settings.show_turn_token_usage
                ? 'settings.agent.turnUsage.visible'
                : 'settings.agent.turnUsage.hidden')}</span>
              <Switch
                aria-label={t('settings.agent.turnUsage.toggle')}
                checked={readiness.settings.show_turn_token_usage}
                loading={runtime.mutation === 'settings'}
                disabled={busy}
                onChange={(checked) => consume(runtime.updateSettings({
                  show_turn_token_usage: checked,
                }))}
              />
            </div>
          </section>

          <section className={styles['agent-setting-row']} aria-labelledby="agent-policy-title">
            <span className={styles['agent-setting-icon']} aria-hidden="true">
              <ShieldCheck size={16} />
            </span>
            <div className={styles['agent-setting-copy']}>
              <strong id="agent-policy-title">{t('settings.agent.policy.title')}</strong>
              <span>{t('settings.agent.policy.description')}</span>
            </div>
            {readiness.mcp_policy ? (
              <div className={styles['toggle-control']}>
                <span>{t(readiness.mcp_policy.approval_bypass
                  ? 'settings.agent.policy.bypass'
                  : 'settings.agent.policy.review')}</span>
                <Switch
                  aria-label={t('settings.agent.policy.approval')}
                  checked={readiness.mcp_policy.approval_bypass}
                  loading={runtime.mutation === 'policy'}
                  disabled={busy}
                  onChange={(checked) => checked
                    ? setConfirmBypass(true)
                    : consume(runtime.updatePolicy(false))}
                />
              </div>
            ) : <p className={styles.empty}>{t('settings.agent.policy.unavailable')}</p>}
            {readiness.mcp_policy?.scope_sync_required ? (
              <div className={styles['scope-sync']}>
                <div>
                  <CircleAlert size={16} aria-hidden="true" />
                  <span>{t('settings.agent.policy.scopeOutdated', {
                    current: readiness.mcp_policy.scope_count,
                    required: readiness.mcp_policy.required_scope_count,
                  })}</span>
                </div>
                <Button
                  size="small"
                  disabled={busy}
                  loading={runtime.mutation === 'policy'}
                  onClick={() => consume(runtime.updatePolicy(
                    readiness.mcp_policy?.approval_bypass ?? false,
                    true,
                  ))}
                >
                  {t('settings.agent.policy.sync')}
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <ConfirmDialog
        open={confirmBypass}
        title={t('settings.agent.confirmBypass.title')}
        description={t('settings.agent.confirmBypass.description')}
        confirmLabel={t('settings.agent.confirmBypass.confirm')}
        danger
        confirmLoading={runtime.mutation === 'policy'}
        onCancel={() => setConfirmBypass(false)}
        onConfirm={() => consume(runtime.updatePolicy(true).then(() => setConfirmBypass(false)))}
      />
    </>
  )
}

function ReadinessItem({ label, component }: {
  label: string
  component: AgentReadinessComponent
}) {
  const { t } = useTranslation()
  return (
    <div className={styles['readiness-item']}>
      <span
        className={`${styles['readiness-icon']} ${styles[`is-${component.status}`]}`}
        aria-hidden="true"
      >
        {component.status === 'ready' ? <Check size={14} /> : <CircleAlert size={14} />}
      </span>
      <span className={styles['readiness-copy']}>
        <strong>{label}</strong>
        <span className={`${styles['readiness-state']} ${styles[`is-${component.status}`]}`}>
          <i aria-hidden="true" />
          {t(`settings.agent.componentState.${component.status}`)}
        </span>
      </span>
    </div>
  )
}

function consume(promise: Promise<unknown>) {
  void promise.catch(() => undefined)
}
