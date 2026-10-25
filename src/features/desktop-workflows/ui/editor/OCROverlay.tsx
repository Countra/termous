import { useTranslation } from 'react-i18next'
import type { OCRSpan } from '#entities/desktop-workflow'
import styles from './OCRPreviewPanel.module.scss'

interface Props {
  spans: OCRSpan[]
  width: number
  height: number
  selected?: number
  disabled?: boolean
  onSelect: (span: OCRSpan) => void
}

export function OCROverlay({ spans, width, height, selected, disabled, onSelect }: Props) {
  const { t } = useTranslation()
  return <div className={styles.overlay}>{spans.map(span => <button type="button" key={span.id}
    data-ocr-id={span.id} aria-pressed={selected === span.id} disabled={disabled}
    aria-label={t('desktopWorkflow.ocr.selectBox', { id: span.id, text: span.text })}
    title={span.text} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}
    onClick={event => {
      event.stopPropagation()
      // Ctrl 拖动由画布捕获阶段处理，不能把平移手势当作文字选择。
      if (!event.ctrlKey) onSelect(span)
    }}
    style={{
      left: `${span.bbox_xyxy[0] / width * 100}%`, top: `${span.bbox_xyxy[1] / height * 100}%`,
      width: `${(span.bbox_xyxy[2] - span.bbox_xyxy[0]) / width * 100}%`, height: `${(span.bbox_xyxy[3] - span.bbox_xyxy[1]) / height * 100}%`,
    }}><b aria-hidden>{span.id}</b></button>)}</div>
}
