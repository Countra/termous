import { InputNumber, Switch } from 'antd'
import { Gauge } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { executionBudgetFields, type AgentConfigurationDraft } from '../model/agentConfigurationDraft'
import type { AgentConfigurationEditor } from '../model/useAgentConfiguration'
import styles from './AgentSetup.module.scss'

export function AgentExecutionBudgetSettings({ editor }: { editor: AgentConfigurationEditor }) {
  const { t } = useTranslation()
  const { draft, errors, busy, change } = editor
  return <section className={styles.surface} aria-labelledby="agent-execution-budget-title">
    <div className={styles['section-title']}><Gauge size={16} aria-hidden="true" /><h2 id="agent-execution-budget-title">{t('settings.agent.executionLimits.title')}</h2></div>
    <div className={styles['section-body']}>
      <header className={`${styles['section-header']} ${styles['budget-header']}`}>
        <div>
          <p className={styles['section-hint']}>{t('settings.agent.executionLimits.description')}</p>
        </div>
        <Switch aria-label={t('settings.agent.executionLimits.toggle')} checked={draft.budgetEnabled} disabled={busy}
          onChange={budgetEnabled => change({ budgetEnabled })} />
      </header>
      {(draft.budgetEnabled || executionBudgetFields.some(([field]) => errors[field])) &&
        <div className={styles['agent-setting-list']}>{executionBudgetFields.map(([field, min, max]) =>
          <section className={styles['agent-setting-row']} key={field}>
            <div className={styles['agent-setting-copy']}>
              <label htmlFor={`agent-budget-${field}`}>{t(`settings.agent.executionLimits.${field}.title`)}</label>
              <span>{t(`settings.agent.executionLimits.${field}.description`)}</span>
              {errors[field] && <span id={`agent-budget-${field}-error`} className={styles['field-error']} role="alert">{errors[field]}</span>}
            </div>
            <InputNumber id={`agent-budget-${field}`} aria-label={t(`settings.agent.executionLimits.${field}.title`)}
              aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `agent-budget-${field}-error` : undefined}
              value={draft[field]} disabled={busy} status={errors[field] ? 'error' : undefined}
              aria-valuemin={min} aria-valuemax={max} changeOnBlur={false}
              onChange={(value: number | null) => change({ [field]: value } as Partial<AgentConfigurationDraft>)} />
          </section>)}</div>}
    </div>
  </section>
}
