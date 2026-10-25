import { Alert, Button, Collapse, Skeleton } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisRecord } from '#common/contracts'
import { useVisibleQuery } from '../model/useVisibleQuery'
import { AnalysisParameterFacts } from './AnalysisParameterFacts'
import styles from './AnalysisDetails.module.scss'

export function AnalysisDiagnostics({ record, gateway, active }: { record: AnalysisRecord; gateway: AnalysisGateway; active: boolean }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const query = useVisibleQuery(record.id, signal => gateway.analysisDiagnostics(record.id, signal), active && open)
  const d = query.data?.diagnostics
  const text = (key: string) => t(`desktopWorkflow.analysisWorkspace.detail.${key}`)
  return <Collapse className={styles.collapse} ghost onChange={keys => setOpen(keys.includes('diagnostics'))} items={[{
    key: 'diagnostics', label: t('desktopWorkflow.analysis.diagnostics'), children: <>
      {query.loading && <Skeleton active title={false} paragraph={{ rows: 3 }} />}
      {query.error != null && <Alert type="error" showIcon title={t('analysisCenter.readFailed')} action={<Button size="small" onClick={query.reload}>{t('app.retry')}</Button>} />}
      {d && <div className={styles.diagnostic}>
        <dl className={styles.facts}>
          <div><dt>{t('desktopWorkflow.analysis.device')}</dt><dd>{d.device}</dd></div>
          <div><dt>{text('precision')}</dt><dd>{query.data?.identity.precision}</dd></div>
          <div><dt>{text('computed')}</dt><dd>{query.data?.computed_at ? new Date(query.data.computed_at).toLocaleString() : '—'}</dd></div>
        </dl>
        <section><h4>{text('models')}</h4><dl className={styles.facts}>{Object.entries(d.models).map(([name, value]) => <div key={name}><dt>{t(`desktopWorkflow.analysis.models.${name}`)}</dt><dd>{value}</dd></div>)}</dl></section>
        <section><h4>{text('timings')}</h4><dl className={styles.facts}>{Object.entries(d.timings_ms).map(([name, value]) => <div key={name}><dt>{t(`desktopWorkflow.analysis.timings.${name}`)}</dt><dd>{value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ms</dd></div>)}</dl></section>
        <section><h4>{text('actualParameters')}</h4><AnalysisParameterFacts parameters={d.parameters} /></section>
        <section><h4>{text('runtime')}</h4><dl className={styles.facts}>{Object.entries(query.data?.identity.runtime ?? {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
          <div className={styles.identifier}><span>{t('analysisCenter.identity')}</span><code>{query.data?.identity.fingerprint}</code></div>
        </section>
      </div>}
    </>,
  }]} />
}
