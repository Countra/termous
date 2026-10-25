import { Button } from 'antd'
import { ChevronRight, Crosshair, Scan, Type } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AnalysisElementView, AnalysisSpanView } from '#common/contracts'
import styles from './AnalysisResultItem.module.scss'

export function AnalysisResultItem({ item, selected, disabled, onSelect, onDetails }: {
  item: AnalysisElementView | AnalysisSpanView; selected: boolean; disabled: boolean; onSelect: () => void; onDetails: () => void
}) {
  const { t } = useTranslation()
  const kind = 'kind' in item ? item.kind : 'ocr'
  const label = t(kind === 'ocr' ? 'desktopWorkflow.analysisWorkspace.ocr' : `desktopWorkflow.analysis.${kind}`)
  return <div role="listitem" className={styles.item} data-selected={selected}>
    <button type="button" className={styles.select} aria-pressed={selected} disabled={disabled} onClick={onSelect}>
      <span className={styles.marker}><span aria-hidden="true">{kind === 'region' ? <Scan size={14} /> : <Type size={14} />}</span><span>#{item.id}</span></span>
      <span className={styles.body}>
        <span className={styles.text}>{item.text || t('desktopWorkflow.analysis.unlabelled')}{item.text_truncated && '…'}</span>
        <span className={styles.metadata}><span>{label}</span>
          {'detection_confidence' in item && item.detection_confidence !== undefined && <span title={t('desktopWorkflow.analysisWorkspace.detectionConfidence')}>{Math.round(item.detection_confidence * 100)}%</span>}
          {item.text_confidence !== undefined && <span title={t('desktopWorkflow.analysisWorkspace.textConfidence')}>OCR {Math.round(item.text_confidence * 100)}%</span>}
          <span title={t('desktopWorkflow.analysis.center')}><Crosshair size={11} />{item.center_xy.join(', ')}</span>
        </span>
      </span>
    </button>
    <Button className={styles.details} type="text" size="small" disabled={disabled} onClick={onDetails} aria-label={t('desktopWorkflow.analysisWorkspace.viewItem', { kind: label, id: item.id })}>
      <ChevronRight size={14} /><span>{t('desktopWorkflow.analysisWorkspace.itemDetails')}</span>
    </Button>
  </div>
}
