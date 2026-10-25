import { Alert, Empty, Pagination } from 'antd'
import { Check, ScanText } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OCRObservation, OCRSpan } from '#entities/desktop-workflow'
import styles from './OCRPreviewPanel.module.scss'

interface Props {
  observation: OCRObservation
  spans: OCRSpan[]
  selected?: number
  disabled?: boolean
  bound?: boolean
  onSelect?: (span: OCRSpan) => void
}

export function OCRPreviewPanel({ observation, spans, selected, disabled, bound, onSelect }: Props) {
  const { t } = useTranslation()
  const list = useRef<HTMLOListElement>(null)
  const [pagination, setPagination] = useState({ observation, selected, page: 1 })
  const selectedIndex = spans.findIndex(span => span.id === selected)
  const changed = pagination.observation !== observation || pagination.selected !== selected
  const page = changed ? Math.max(1, Math.floor(selectedIndex / 20) + 1) : pagination.page
  if (changed) setPagination({ observation, selected, page })
  const visible = spans.slice((page - 1) * 20, page * 20)
  useEffect(() => {
    const container = list.current
    if (!container) return
    const row = container.querySelector<HTMLElement>('[aria-pressed="true"]')
    // 仅滚动结果列表，避免 scrollIntoView 将整个工作台拉离当前画面。
    if (row) {
      const bounds = container.getBoundingClientRect(); const item = row.getBoundingClientRect()
      if (item.top < bounds.top) container.scrollTop -= bounds.top - item.top
      else if (item.bottom > bounds.bottom) container.scrollTop += item.bottom - bounds.bottom
    } else container.scrollTop = 0
  }, [observation, selected, page])
  return <section className={styles.panel} aria-label={t('desktopWorkflow.ocr.preview')}>
    <header className={styles.summary}>
      <strong><ScanText size={14} />{t('desktopWorkflow.ocr.matchCount', { count: spans.length })}</strong>
      <span title={t('desktopWorkflow.ocr.previewCounts', { recognized: observation.recognized_count })}>{observation.duration_ms.toFixed(0)} ms · {observation.device}</span>
    </header>
    {observation.truncated && <Alert type="warning" title={t('desktopWorkflow.ocr.incomplete')} />}
    {spans.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('desktopWorkflow.ocr.emptyMatches')} />
      : <ol ref={list} className={styles.results} aria-label={t('desktopWorkflow.ocr.matchedResults')}>
        {visible.map(span => {
          const content = <><span className={styles.number}>{span.id}</span>
            <span className={styles.content}>
              <span className={styles.text}>{span.text}</span>
              <span className={styles.coordinates}>{t('desktopWorkflow.ocr.coordinates')} · {span.bbox_xyxy.join(', ')}</span>
            </span>
            <span className={styles.trailing}>
              <span className={styles.confidence} title={t('desktopWorkflow.ocr.confidence')}>{(span.confidence * 100).toFixed(1)}%</span>
              <Check size={13} className={styles.check} aria-hidden />
            </span></>
          return <li key={span.id}>{onSelect
            ? <button type="button" className={styles.row} aria-label={span.text} aria-pressed={selected === span.id} disabled={disabled}
              title={t(`desktopWorkflow.ocr.${bound ? 'selectionBound' : 'useText'}`)} onClick={() => onSelect(span)}>{content}</button>
            : <div className={styles.row}>{content}</div>}</li>
        })}
      </ol>}
    {spans.length > 20 && <Pagination size="small" simple current={page} pageSize={20} total={spans.length} showSizeChanger={false} onChange={next => setPagination({ observation, selected, page: next })} />}
  </section>
}
