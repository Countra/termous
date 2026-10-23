import { Alert, Button } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisRecord } from '#common/contracts'
import { useVisibleQuery } from '../model/useVisibleQuery'
import styles from './Analysis.module.scss'

export function AnalysisDiagnostics({ record, gateway, active }: { record: AnalysisRecord; gateway: AnalysisGateway; active: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const query = useVisibleQuery(record.id, signal => gateway.analysisDiagnostics(record.id, signal), active && open)
  const d = query.data?.diagnostics
  return <details className={styles.diagnostics} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t('desktopWorkflow.analysis.diagnostics')}</summary>
    <p>{t('desktopWorkflow.analysis.boundary')}</p>
    {query.error != null && <Alert type="error" title={t('analysisCenter.readFailed')} action={<Button onClick={query.reload}>{t('app.retry')}</Button>} />}
    {d && <dl>
      <dt>{t('desktopWorkflow.analysis.device')}</dt><dd>{d.device} · {query.data?.identity.precision}</dd>
      <dt>{t('desktopWorkflow.analysis.settingsRevision')}</dt><dd>{record.settings_revision ?? '—'}</dd>
      {Object.entries(d.models).map(([name, value]) => <div key={name}><dt>{t(`desktopWorkflow.analysis.models.${name}`)}</dt><dd>{value}</dd></div>)}
      {Object.entries(d.parameters).map(([name, value]) => <div key={name}><dt>{t(`settings.screenAnalysis.${name}`)}</dt><dd>{String(value)}</dd></div>)}
      {Object.entries(d.timings_ms).map(([name, value]) => <div key={name}><dt>{t(`desktopWorkflow.analysis.timings.${name}`)}</dt><dd>{value.toFixed(2)} ms</dd></div>)}
      <dt>{t('analysisCenter.identity')}</dt><dd>{query.data?.identity.fingerprint}</dd>
      {Object.entries(query.data?.identity.runtime ?? {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}
    </dl>}
  </details>
}
