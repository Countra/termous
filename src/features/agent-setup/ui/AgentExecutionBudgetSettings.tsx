import { useState } from 'react'
import { InputNumber, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { defaultExecutionBudget, type ExecutionBudget, type ExecutionLimits } from '#common/contracts'
import type { AgentSetupController } from '../model/useAgentSetupController.ts'
import styles from './AgentSetup.module.scss'

const fields = [
  ['model_requests', 1, 500], ['total_tokens', 10_000, 10_000_000],
  ['consecutive_failures', 1, 10], ['selection_attempts', 1, 20],
] as const

export function AgentExecutionBudgetSettings({ runtime }: { runtime: AgentSetupController }) {
  const { t } = useTranslation()
  const policy = runtime.readiness?.settings.execution_budget ?? defaultExecutionBudget
  const busy = runtime.loading || runtime.mutation !== null
  const save = async (value: ExecutionBudget) => {
    try { await runtime.updateSettings({ execution_budget: value }); return true } catch {
      // 控制器统一展示保存失败与修订冲突，字段撤销未保存的输入。
      return false
    }
  }
  return <section className={styles.surface} aria-labelledby="agent-execution-budget-title">
    <header className={styles['section-header']}>
      <div>
        <div className={styles['section-title']}><h2 id="agent-execution-budget-title">{t('settings.agent.executionLimits.title')}</h2></div>
        <p className={styles['section-hint']}>{t('settings.agent.executionLimits.description')}</p>
      </div>
      <Switch aria-label={t('settings.agent.executionLimits.toggle')} checked={policy.enabled} disabled={busy}
        loading={runtime.mutation === 'settings'} onChange={(enabled) => { void save({ ...policy, enabled }) }} />
    </header>
    {policy.enabled && <div className={styles['agent-setting-list']}>{fields.map(([field, min, max]) =>
      <BudgetField key={`${field}-${runtime.readiness?.settings.revision}`} field={field} value={policy.limits[field]} min={min} max={max}
        disabled={busy} onSave={(value) => save({ ...policy, limits: { ...policy.limits, [field]: value } })} />)}</div>}
  </section>
}

function BudgetField({ field, value, min, max, disabled, onSave }: {
  field: keyof ExecutionLimits; value: number; min: number; max: number; disabled: boolean; onSave(value: number): Promise<boolean>
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<number | null>(value)
  const valid = draft !== null && Number.isSafeInteger(draft) && draft >= min && draft <= max
  const save = () => {
    if (valid && draft !== value) void onSave(draft).then((saved) => { if (!saved) setDraft(value) })
  }
  return <section className={styles['agent-setting-row']}>
    <div className={styles['agent-setting-copy']}>
      <strong>{t(`settings.agent.executionLimits.${field}.title`)}</strong>
      <span>{t(`settings.agent.executionLimits.${field}.description`)}</span>
      {!valid && <span role="alert">{t('settings.agent.executionLimits.validation', { min, max })}</span>}
    </div>
    <InputNumber aria-label={t(`settings.agent.executionLimits.${field}.title`)} aria-invalid={!valid}
      value={draft} changeOnBlur={false} disabled={disabled} status={valid ? undefined : 'error'}
      onChange={setDraft} onBlur={save} onPressEnter={(event) => event.currentTarget.blur()} />
  </section>
}
