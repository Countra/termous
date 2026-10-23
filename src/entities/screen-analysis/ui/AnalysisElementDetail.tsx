import { Alert, Button } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Crosshair, ImagePlus, Scan } from 'lucide-react'
import type { AnalysisElement, AnalysisElementView, AnalysisSpanView, AnalysisGateway, AnalysisQuery } from '#common/contracts'
import { writeClipboardText } from '#shared/clipboard'
import { useVisibleQuery } from '../model/useVisibleQuery'
import styles from './Analysis.module.scss'

export interface AnalysisActions {
  busy?: boolean; canPoint?: boolean; canRegion?: boolean
  onApply?: (kind: 'point' | 'template' | 'region', element: AnalysisElement) => void
  onError: (error: unknown) => void
}
export function AnalysisElementDetail({ gateway, id, selected, span, filter, active, ...actions }: AnalysisActions & {
  gateway: AnalysisGateway; id: string; selected: number; span?: number; filter: AnalysisQuery; active: boolean
}) {
  const { t } = useTranslation()
  const [offsets, setOffsets] = useState([0])
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined])
  const cursor = cursors[cursors.length - 1]
  const offset = offsets[offsets.length - 1]
  const detail = useVisibleQuery<AnalysisElementView | AnalysisSpanView>(`${id}:${selected}:${span}:${offset}`, signal => span === undefined
    ? gateway.analysisElement(id, selected, offset, signal) : gateway.analysisSpan(id, span, offset, signal), active)
  const spans = useVisibleQuery(JSON.stringify([id, selected, filter, cursor]), signal => gateway.analysisSpans(id,
    { q: filter.q, text_min: filter.text_min, text_max: filter.text_max, element_id: selected, cursor, limit: 20 }, signal), active && span === undefined)
  const current = detail.data
  const element = current && 'center_xy' in current ? current : undefined
  return <div className={styles.detail}>
    {detail.error != null && <Alert type="error" title={t('analysisCenter.readFailed')} action={<Button onClick={detail.reload}>{t('app.retry')}</Button>} />}
    {current && <>
      <div><strong>#{current.id}</strong><span>{t('desktopWorkflow.analysis.bounds')}: {current.bbox_xyxy.join(', ')}</span></div>
      {element && <small>{t('desktopWorkflow.analysis.center')}: {element.center_xy.join(', ')}</small>}
      {element?.detection_confidence != null && <small>{t('desktopWorkflow.analysis.detectionScore')}: {element.detection_confidence.toFixed(3)}</small>}
      {current.text_confidence != null && <small>{t('desktopWorkflow.analysis.textScore')}: {current.text_confidence.toFixed(3)}</small>}
      <p>{current.text}</p>
      {current.text_truncated && <small>{t('analysisCenter.textPart', { offset: current.text_offset, count: current.text_length })}</small>}
      <div className={styles.actions}>
        {offsets.length > 1 && <Button size="small" onClick={() => setOffsets(offsets.slice(0, -1))}>{t('desktopWorkflow.analysis.previous')}</Button>}
        {current.text_next_offset !== undefined && <Button size="small" onClick={() => setOffsets([...offsets, current.text_next_offset!])}>{t('analysisCenter.moreText')}</Button>}
        {current.text && <Button size="small" icon={<Copy size={13} />} onClick={() => void writeClipboardText(current.text).catch(actions.onError)}>{t(current.text_truncated ? 'analysisCenter.copyPart' : 'desktopWorkflow.analysis.copy')}</Button>}
        {element && actions.onApply && <>
          <Button size="small" disabled={actions.busy || !actions.canPoint} icon={<Crosshair size={13} />} onClick={() => actions.onApply?.('point', element)}>{t('desktopWorkflow.analysis.usePoint')}</Button>
          <Button size="small" disabled={actions.busy || !actions.canRegion} icon={<ImagePlus size={13} />} onClick={() => actions.onApply?.('template', element)}>{t('desktopWorkflow.analysis.useTemplate')}</Button>
          <Button size="small" disabled={actions.busy || !actions.canRegion} icon={<Scan size={13} />} onClick={() => actions.onApply?.('region', element)}>{t('desktopWorkflow.analysis.useRegion')}</Button>
        </>}
      </div>
    </>}
    {spans.error != null && <Button onClick={spans.reload}>{t('app.retry')}</Button>}
    {spans.data?.items.map(item => <p key={item.id}>OCR #{item.id} · {item.text}{item.text_truncated && '…'} <small>{t('desktopWorkflow.analysis.textScore')} {item.text_confidence.toFixed(3)} · {item.bbox_xyxy.join(', ')}</small></p>)}
    {cursors.length > 1 && <Button size="small" disabled={spans.loading} onClick={() => setCursors(cursors.slice(0, -1))}>{t('desktopWorkflow.analysis.previous')}</Button>}
    {spans.data?.next_cursor && <Button size="small" disabled={spans.loading} onClick={() => setCursors([...cursors, spans.data!.next_cursor])}>{t('analysisCenter.moreOCR')}</Button>}
  </div>
}
