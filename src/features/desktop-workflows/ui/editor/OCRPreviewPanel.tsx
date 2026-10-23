import { Alert, Empty, Pagination } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OCRObservation, OCRSpan } from '#entities/desktop-workflow'
import styles from './OCRPreviewPanel.module.scss'

export function OCRPreviewPanel({ observation, spans, onSelect }: { observation: OCRObservation; spans: OCRSpan[]; onSelect?: (span: OCRSpan) => void }) {
  const { t } = useTranslation()
  const [pagination, setPagination] = useState({ observation, page: 1 })
  const page = pagination.observation === observation ? pagination.page : 1
  const visible = spans.slice((page - 1) * 20, page * 20)
  return <section className={styles.panel} aria-label={t('desktopWorkflow.ocr.preview')}>
    <header className={styles.summary}>
      <strong>{t('desktopWorkflow.ocr.matchCount', { count: spans.length })}</strong>
      <span>{observation.duration_ms.toFixed(0)} ms · {observation.device}</span>
    </header>
    <p className={styles.hint}>{t('desktopWorkflow.ocr.previewCounts', { recognized: observation.recognized_count })}</p>
    {observation.truncated && <Alert type="warning" title={t('desktopWorkflow.ocr.incomplete')} />}
    {spans.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('desktopWorkflow.ocr.emptyMatches')} />
      : <ol className={styles.results} aria-label={t('desktopWorkflow.ocr.matchedResults')}>
        {visible.map(span => <li key={span.id}>
          <span className={styles.number}>{span.id}</span>
          <div className={styles.content}>
            {onSelect ? <button type="button" className={styles.text} title={t('desktopWorkflow.ocr.useText')} onClick={() => onSelect(span)}>{span.text}</button>
              : <span className={styles.text}>{span.text}</span>}
            <span className={styles.coordinates}>{t('desktopWorkflow.ocr.coordinates')} · {span.bbox_xyxy.join(', ')}</span>
          </div>
          <span className={styles.confidence} title={t('desktopWorkflow.ocr.confidence')}>{span.confidence.toFixed(3)}</span>
        </li>)}
      </ol>}
    {spans.length > 20 && <Pagination size="small" simple current={page} pageSize={20} total={spans.length} showSizeChanger={false} onChange={next => setPagination({ observation, page: next })} />}
  </section>
}
export function OCROverlay({ spans, width, height }: { spans: OCRSpan[]; width: number; height: number }) {
  return <div className={styles.overlay} aria-hidden>{spans.map(span => <span key={span.id} data-ocr-id={span.id} style={{
    left: `${span.bbox_xyxy[0] / width * 100}%`, top: `${span.bbox_xyxy[1] / height * 100}%`,
    width: `${(span.bbox_xyxy[2] - span.bbox_xyxy[0]) / width * 100}%`, height: `${(span.bbox_xyxy[3] - span.bbox_xyxy[1]) / height * 100}%`,
  }}><b>{span.id}</b></span>)}</div>
}
