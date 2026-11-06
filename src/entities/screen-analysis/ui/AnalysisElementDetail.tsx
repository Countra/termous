import { Button, Collapse, Skeleton } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Copy, Type } from 'lucide-react'
import type { AnalysisElementView, AnalysisSpanView, AnalysisGateway, AnalysisQuery } from '#common/contracts'
import { writeClipboardText } from '#shared/clipboard'
import { useVisibleQuery } from '../model/useVisibleQuery'
import { useAnalysisError, type AnalysisErrorReporter } from '../model/useAnalysisError'
import styles from './AnalysisElementDetail.module.scss'

export function AnalysisElementDetail({ gateway, id, selected, span, filter, active, onError, onSelectSpan }: {
  gateway: AnalysisGateway; id: string; selected: number; span?: number; filter: AnalysisQuery; active: boolean; onError: AnalysisErrorReporter; onSelectSpan?: (id: number) => void
}) {
  const { t } = useTranslation()
  const [offsets, setOffsets] = useState([0])
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const [showSpans, setShowSpans] = useState(false)
  const cursor = cursors[cursors.length - 1]
  const offset = offsets[offsets.length - 1]
  const detail = useVisibleQuery<AnalysisElementView | AnalysisSpanView>(`${id}:${selected}:${span}:${offset}`, signal => span === undefined
    ? gateway.analysisElement(id, selected, offset, signal) : gateway.analysisSpan(id, span, offset, signal), active)
  const spans = useVisibleQuery(JSON.stringify([id, selected, filter, cursor]), signal => gateway.analysisSpans(id,
    { q: filter.q, text_min: filter.text_min, text_max: filter.text_max, text_gt: filter.text_gt, text_lt: filter.text_lt, element_id: selected, cursor, limit: 20 }, signal), active && span === undefined && showSpans)
  useAnalysisError(detail.error, onError, detail.reload)
  useAnalysisError(spans.error, onError, spans.reload)
  const current = detail.data
  const element = current && 'kind' in current ? current : undefined
  return <div className={styles.detail} aria-busy={detail.loading}>
    {!current && detail.loading && <Skeleton active title={false} paragraph={{ rows: 4 }} />}
    {current && <>
      <div className={styles.identity}><strong>{element ? t(`desktopWorkflow.analysis.${element.kind}`) : t('desktopWorkflow.analysisWorkspace.ocr')}</strong>
        {'element_id' in current && <span>{t('desktopWorkflow.analysisWorkspace.parent', { id: current.element_id })}</span>}</div>
      <dl className={styles.geometry}>
        <div><dt>{t('desktopWorkflow.analysis.center')}</dt><dd>{current.center_xy.join(', ')}</dd></div>
        <div><dt>{t('desktopWorkflow.analysis.bounds')}</dt><dd>{current.bbox_xyxy.join(', ')}</dd></div>
        {element?.detection_confidence != null && <div><dt>{t('desktopWorkflow.analysis.detectionScore')}</dt><dd>{element.detection_confidence.toFixed(3)}</dd></div>}
        {current.text_confidence != null && <div><dt>{t('desktopWorkflow.analysis.textScore')}</dt><dd>{current.text_confidence.toFixed(3)}</dd></div>}
      </dl>
      <section className={styles.text}>
        <header><Type size={14} /><strong>{t('desktopWorkflow.analysisWorkspace.recognizedText')}</strong>
          {current.text && <Button type="text" size="small" icon={<Copy size={13} />} onClick={() => void writeClipboardText(current.text).catch(() => onError(new Error('analysis_copy_failed')))}>{t(current.text_truncated ? 'analysisCenter.copyPart' : 'desktopWorkflow.analysis.copy')}</Button>}</header>
        <p>{current.text || t('desktopWorkflow.analysis.unlabelled')}</p>
      {current.text_truncated && <small>{t('analysisCenter.textPart', { offset: current.text_offset, count: current.text_length })}</small>}
      <div className={styles.actions}>
        {offsets.length > 1 && <Button size="small" onClick={() => setOffsets(offsets.slice(0, -1))}>{t('desktopWorkflow.analysis.previous')}</Button>}
        {current.text_next_offset !== undefined && <Button size="small" onClick={() => setOffsets([...offsets, current.text_next_offset!])}>{t('analysisCenter.moreText')}</Button>}
      </div>
      </section>
    </>}
    {element && <Collapse ghost activeKey={showSpans ? ['ocr'] : []} onChange={keys => setShowSpans(keys.includes('ocr'))} items={[{ key: 'ocr', label: t('desktopWorkflow.analysisWorkspace.relatedText'), children: <div className={styles.related} aria-busy={spans.loading}>
      {spans.loading && !spans.data && <Skeleton title={false} paragraph={{ rows: 2 }} />}
      {spans.data?.items.map(item => <article key={item.id}>
        <header><span>OCR #{item.id}</span><small>{item.text_confidence.toFixed(3)}</small>{onSelectSpan && <Button type="text" size="small" icon={<ChevronRight size={13} />} aria-label={t('desktopWorkflow.analysisWorkspace.viewOCR', { id: item.id })} onClick={() => onSelectSpan(item.id)} />}</header>
        <p>{item.text}{item.text_truncated && '…'}</p>
      </article>)}
      {spans.data?.total === 0 && <small>{t('desktopWorkflow.analysis.empty')}</small>}
      <div className={styles.actions}>
        {cursors.length > 1 && <Button size="small" disabled={spans.loading} onClick={() => setCursors(cursors.slice(0, -1))}>{t('desktopWorkflow.analysis.previous')}</Button>}
        {spans.data?.next_cursor && <Button size="small" disabled={spans.loading} onClick={() => setCursors([...cursors, spans.data!.next_cursor])}>{t('analysisCenter.moreOCR')}</Button>}
      </div>
    </div> }]} />}
  </div>
}
