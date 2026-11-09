import { Alert } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisRecordQuery } from '#common/contracts'
import { CustomSelect, DateTimePicker } from '#shared/ui'
import styles from './AnalysisFilterEditor.module.scss'

export function AnalysisHistoryFilters({ value, onChange }: { value: AnalysisRecordQuery; onChange: (patch: AnalysisRecordQuery) => void }) {
  const { t } = useTranslation()
  const [after, setAfter] = useState(value.after ? new Date(value.after) : null)
  const [before, setBefore] = useState(value.before ? new Date(value.before) : null)
  const [error, setError] = useState(false)
  const dates = (start: Date | null, end: Date | null) => {
    setAfter(start); setBefore(end)
    const a = start?.getTime()
    const b = end?.getTime()
    const valid = [a, b].every(n => n === undefined || Number.isFinite(n)) && (a === undefined || b === undefined || a <= b)
    setError(!valid)
    if (valid) onChange({ after: a === undefined ? undefined : new Date(a).toISOString(), before: b === undefined ? undefined : new Date(b).toISOString() })
  }
  return <div className={styles.fields}>
    <CustomSelect label={t('analysisCenter.state')} value={value.state ?? 'all'} options={['all', 'preparing', 'queued', 'running', 'cancelling', 'succeeded', 'failed', 'cancelled', 'interrupted'].map(state => ({ value: state, label: t(`analysisCenter.states.${state}`) }))}
      onChange={state => onChange({ state: state === 'all' ? undefined : state as AnalysisRecordQuery['state'] })} />
    <CustomSelect label={t('analysisCenter.source')} value={value.source ?? 'all'} options={['all', 'preview', 'analysis', 'attachment'].map(source => ({ value: source, label: t(`analysisCenter.sources.${source}`) }))}
      onChange={source => onChange({ source: source === 'all' ? undefined : source as AnalysisRecordQuery['source'] })} />
    <label>{t('analysisCenter.after')}<DateTimePicker needConfirm={false} ariaLabel={t('analysisCenter.after')} value={after} onChange={date => dates(date, before)} /></label>
    <label>{t('analysisCenter.before')}<DateTimePicker needConfirm={false} ariaLabel={t('analysisCenter.before')} value={before} onChange={date => dates(after, date)} status={error ? 'error' : undefined} /></label>
    {error && <Alert type="error" title={t('desktopWorkflow.analysisWorkspace.invalidDates')} />}
  </div>
}
