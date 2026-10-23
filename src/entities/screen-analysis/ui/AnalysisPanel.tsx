import { Alert, Button, Segmented } from 'antd'
import { Download, FileJson } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisGateway, AnalysisRecord, AnalysisQuery, AnalysisPage, AnalysisElementView, AnalysisSpanView } from '#common/contracts'
import { useVisibleQuery } from '../model/useVisibleQuery'
import { AnalysisFilters } from './AnalysisFilters'
import { AnalysisDiagnostics } from './AnalysisDiagnostics'
import { AnalysisElementDetail, type AnalysisActions } from './AnalysisElementDetail'
import styles from './Analysis.module.scss'

export function AnalysisPanel({ analysis, gateway, selected, hovered, onSelect, onHover, onExport, active = true, ...actions }: AnalysisActions & {
  analysis: AnalysisRecord; gateway: AnalysisGateway; selected?: number; hovered?: number; active?: boolean
  onSelect: (id: number) => void; onHover: (id?: number) => void; onExport: (kind: 'json' | 'png') => void
}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'elements' | 'spans'>('elements')
  const [filter, setFilter] = useState<AnalysisQuery>({})
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [spanSelection, setSpanSelection] = useState<{ id: number; element: number }>()
  const span = spanSelection?.element === selected ? spanSelection?.id : undefined
  const query = { ...filter, cursor: cursors[cursors.length - 1] }
  const result = useVisibleQuery<AnalysisPage<AnalysisElementView | AnalysisSpanView>>(JSON.stringify([analysis.id, mode, query]), signal => mode === 'spans'
    ? gateway.analysisSpans(analysis.id, query, signal) : gateway.analysisElements(analysis.id, query, signal), active)
  const counts = analysis.summary!
  const choose = (item: AnalysisElementView | AnalysisSpanView) => {
    setSpanSelection('element_id' in item ? { id: item.id, element: item.element_id } : undefined); onSelect('element_id' in item ? item.element_id : item.id)
  }
  return <section className={styles.panel} aria-label={t('desktopWorkflow.analysis.title')}>
    <header className={styles.heading}>
      <strong>{t('desktopWorkflow.analysis.title')}</strong>
      <span>{t('desktopWorkflow.analysis.counts', { regions: counts.region_count, texts: counts.text_count, spans: counts.ocr_span_count })}
        {' · '}{t('analysisCenter.taskTime', { seconds: (analysis.duration_ms / 1000).toFixed(2) })}
        {analysis.reused && <> · {t('analysisCenter.reused')} · {t('analysisCenter.originalTime', { seconds: (analysis.inference_ms / 1000).toFixed(2) })}</>}
      </span>
      <Button size="small" type="text" aria-label={t('desktopWorkflow.analysis.exportJSON')} icon={<FileJson size={14} />} onClick={() => onExport('json')} />
      <Button size="small" type="text" aria-label={t('desktopWorkflow.analysis.exportPNG')} icon={<Download size={14} />} onClick={() => onExport('png')} />
    </header>
    <p className={styles.notice}>{t('analysisCenter.originalThresholds', { detection: analysis.parameters.confidence, ocr: analysis.parameters.text_confidence })}</p>
    {counts.truncated && <p className={styles.notice}>{counts.truncation_reasons.map(reason => t(`desktopWorkflow.analysis.truncation.${reason}`)).join(' · ')}</p>}
    <Segmented size="small" value={mode} options={[{ value: 'elements', label: t('desktopWorkflow.analysis.elements') }, { value: 'spans', label: t('analysisCenter.ocrSpans') }]}
      onChange={value => { setMode(value as 'elements' | 'spans'); setFilter({}); setCursors([undefined]); setSpanSelection(undefined) }} />
    <AnalysisFilters key={mode} value={filter} spans={mode === 'spans'} onChange={value => { setFilter(value); setCursors([undefined]) }} />
    {result.error != null && <Alert type="error" title={t('analysisCenter.readFailed')} action={<Button size="small" onClick={result.reload}>{t('app.retry')}</Button>} />}
    {result.data?.limited_by_inference && <p className={styles.notice}>{t('analysisCenter.inferenceLimited')}</p>}
    <small>{t('analysisCenter.matches', { count: result.data?.total ?? 0 })}</small>
    <div className={styles.list} role="listbox" aria-busy={result.loading} aria-label={t('desktopWorkflow.analysis.elements')}>
      {result.data?.items.map(item => {
        const element = 'element_id' in item ? item.element_id : item.id
        return <button type="button" role="option" key={item.id} aria-selected={mode === 'spans' ? span === item.id : selected === item.id}
          data-active={element === hovered} onClick={() => choose(item)} onPointerEnter={() => onHover(element)} onPointerLeave={() => onHover(undefined)}>
          <span className={styles.number}>{mode === 'spans' ? `OCR ${item.id} → #${element}` : item.id}</span>
          <span className={styles.text}>{item.text || t('desktopWorkflow.analysis.unlabelled')}{item.text_truncated && '…'}</span>
          <small>{'kind' in item ? t(`desktopWorkflow.analysis.${item.kind}`) : item.text_confidence.toFixed(3)}
            {'matched_ocr_spans' in item && item.matched_ocr_spans > 0 && ` · OCR ${item.matched_ocr_spans}`}</small>
        </button>
      })}
      {result.data?.items.length === 0 && <p className={styles.empty}>{t('desktopWorkflow.analysis.empty')}</p>}
    </div>
    <div className={styles.pages}>
      <Button size="small" disabled={cursors.length === 1 || result.loading} onClick={() => setCursors(cursors.slice(0, -1))}>{t('desktopWorkflow.analysis.previous')}</Button>
      <span>{cursors.length}</span><Button size="small" disabled={!result.data?.next_cursor || result.loading} onClick={() => setCursors([...cursors, result.data!.next_cursor])}>{t('desktopWorkflow.analysis.next')}</Button>
    </div>
    {selected !== undefined && <AnalysisElementDetail key={`${analysis.id}:${mode}:${selected}:${span}:${JSON.stringify(filter)}`} id={analysis.id} gateway={gateway}
      selected={selected} span={mode === 'spans' ? span : undefined} filter={filter} active={active} {...actions} />}
    <AnalysisDiagnostics record={analysis} gateway={gateway} active={active} />
  </section>
}
