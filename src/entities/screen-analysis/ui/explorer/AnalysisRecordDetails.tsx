import { Alert, Button, Collapse, Tag, Typography } from 'antd'
import { ArrowLeft, Clock3, ScanSearch } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { analysisMode, type AnalysisGateway, type AnalysisRecord } from '#common/contracts'
import { analysisTerminal } from '../../model/useVisibleQuery'
import type { AnalysisErrorReporter } from '../../model/useAnalysisError'
import { AnalysisDiagnostics } from '../AnalysisDiagnostics'
import { AnalysisParameterFacts } from '../AnalysisParameterFacts'
import styles from '../AnalysisDetails.module.scss'

export function AnalysisRecordDetails({ record, gateway, onBack, onError }: { record: AnalysisRecord; gateway: AnalysisGateway; onBack: () => void; onError: AnalysisErrorReporter }) {
  const { t } = useTranslation()
  const text = (key: string) => t(`desktopWorkflow.analysisWorkspace.detail.${key}`)
  const time = (value?: string) => value ? new Date(value).toLocaleString() : '—'
  const distribution = record.confidence_distribution
  const maximum = Math.max(1, ...(distribution?.detection ?? []), ...(distribution?.ocr ?? []))
  return <section className={styles.panel} aria-label={t('desktopWorkflow.analysisWorkspace.details')}>
    <header className={styles.header}><Button type="text" size="small" icon={<ArrowLeft size={14} />} onClick={onBack}>{t('desktopWorkflow.analysisWorkspace.back')}</Button><strong>{t('desktopWorkflow.analysisWorkspace.details')}</strong></header>
    <div className={styles.scroll}>
      <section className={styles.section}>
        <div className={styles.status}><Tag>{t(`analysisCenter.states.${record.state}`)}</Tag>{record.reused && <Tag>{t('analysisCenter.reused')}</Tag>}<span>{t(`settings.screenAnalysis.modes.${analysisMode(record.parameters)}`)}</span></div>
        <div className={styles.metrics}>
          <div><span><Clock3 size={13} />{text('taskDuration')}</span><strong>{analysisTerminal(record.state) ? `${record.duration_ms.toLocaleString()} ms` : '—'}</strong></div>
          <div><span><ScanSearch size={13} />{text('inferenceDuration')}</span><strong>{record.state === 'succeeded' ? `${record.inference_ms.toLocaleString()} ms` : '—'}</strong></div>
        </div>
        {record.reused && <p className={styles.hint}>{text('reuseHint')}</p>}
        {record.summary && <dl className={styles.counts}>
          <div><dt>{t('desktopWorkflow.analysis.region')}</dt><dd>{record.summary.region_count}</dd></div>
          <div><dt>{text('independentText')}</dt><dd>{record.summary.text_count}</dd></div>
          <div><dt>{t('analysisCenter.ocrSpans')}</dt><dd>{record.summary.ocr_span_count}</dd></div>
        </dl>}
        {record.summary?.truncated && <Alert type="warning" showIcon title={record.summary.truncation_reasons.map(reason => t(`desktopWorkflow.analysis.truncation.${reason}`)).join(' · ')} />}
      </section>
      <section className={styles.section}>
        <h3>{text('source')}</h3>
        <dl className={styles.facts}>
          <div><dt>{t('analysisCenter.source')}</dt><dd>{record.source.name || t(`analysisCenter.sources.${record.source.kind}`)}</dd></div>
          <div><dt>{text('imageSize')}</dt><dd>{record.image ? `${record.image.width} × ${record.image.height} px` : '—'}</dd></div>
          {record.metadata?.captured_at && <div><dt>{text('captured')}</dt><dd>{time(record.metadata.captured_at)}</dd></div>}
          <div><dt>{text('created')}</dt><dd>{time(record.created_at)}</dd></div>
          <div><dt>{text('finished')}</dt><dd>{time(record.finished_at)}</dd></div>
        </dl>
        <div className={styles.identifier}><span>{t('analysisCenter.id')}</span><Typography.Text copyable={{ text: record.id }} code>{record.id}</Typography.Text></div>
      </section>
      <Collapse className={styles.collapse} ghost items={[
        { key: 'parameters', label: text('parameters'), children: <><AnalysisParameterFacts parameters={record.parameters} /><dl className={styles.facts}><div><dt>{t('desktopWorkflow.analysis.settingsRevision')}</dt><dd>{record.settings_revision ?? '—'}</dd></div></dl></> },
        ...(distribution ? [{ key: 'confidence', label: text('distribution'), children: <><p className={styles.hint}>{text('distributionHint')}</p><table className={styles.distribution}>
          <thead><tr><th scope="col">{text('interval')}</th><th scope="col">{t('desktopWorkflow.analysisWorkspace.detectionShort')}</th><th scope="col">OCR</th></tr></thead>
          <tbody>{distribution.detection.map((count, index) => <tr key={index}><th scope="row">{index * 10}–{(index + 1) * 10}%</th>{[count, distribution.ocr[index] ?? 0].map((value, column) => <td key={column}><span className={styles.bar} data-kind={column === 0 ? 'detection' : 'ocr'} style={{ width: `${value / maximum * 100}%` }} /><span className={styles.value}>{value}</span></td>)}</tr>)}</tbody>
        </table></> }] : []),
      ]} />
      {record.state === 'succeeded' && <AnalysisDiagnostics record={record} gateway={gateway} active onError={onError} />}
    </div>
  </section>
}
