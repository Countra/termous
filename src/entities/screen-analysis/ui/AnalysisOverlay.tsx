import type { AnalysisGeometry, AnalysisLabelMode } from '#common/contracts'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { layoutLabels, projectGeometry } from '../model/annotationLayout'
import styles from './Analysis.module.scss'

interface Props {
  elements: AnalysisGeometry[]; image: { width: number; height: number }; scale: number; mode: AnalysisLabelMode
  selected?: number; hovered?: number; disabled: boolean; onSelect: (id: number) => void; onHover: (id?: number) => void
}

export function AnalysisOverlay({ elements, image, scale, mode, selected, hovered, disabled, onSelect, onHover }: Props) {
  const { t } = useTranslation()
  const width = Math.ceil(image.width * scale), height = Math.ceil(image.height * scale)
  const geometry = useMemo(() => projectGeometry(elements, scale), [elements, scale])
  const placed = useMemo(() => layoutLabels(geometry, width, height, mode), [geometry, width, height, mode])
  const byID = useMemo(() => new Map(elements.map(item => [item.id, item])), [elements])
  // 临时提示不参与基础布局，悬停时其他编号保持原位。
  const active = hovered ?? selected
  const hidden = mode === 'auto' && active !== undefined && !placed.some(item => item.id === active)
    ? layoutLabels(geometry.filter(item => item.id === active), width, height, 'all') : []
  const labels = [...placed, ...hidden]
  return <div className={styles.overlay} aria-hidden={disabled || undefined}>
    <svg className={styles.frames} width={width} height={height} aria-hidden="true">
      {geometry.map(item => <rect key={item.id} className={styles.region} data-kind={byID.get(item.id)?.kind} data-active={selected === item.id || hovered === item.id}
        x={item.box[0]} y={item.box[1]} width={item.box[2] - item.box[0]} height={item.box[3] - item.box[1]} />)}
      {labels.map(item => <line key={`line:${item.id}`} className={styles.leader} data-kind={byID.get(item.id)?.kind}
        x1={item.anchor[0]} y1={item.anchor[1]} x2={(item.box[0] + item.box[2]) / 2} y2={(item.box[1] + item.box[3]) / 2} />)}
    </svg>
    {labels.map(item => {
      const element = byID.get(item.id)!
      return <button key={item.id} type="button" className={styles.label} data-kind={element.kind}
        data-active={selected === item.id || hovered === item.id} disabled={disabled}
        aria-label={`${t(element.element_id === undefined ? `desktopWorkflow.analysis.${element.kind}` : 'desktopWorkflow.analysisWorkspace.ocr')} #${item.id}`}
        aria-pressed={selected === item.id} style={{ left: item.box[0], top: item.box[1], width: item.box[2] - item.box[0] }}
        onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
        onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelect(item.id) }}
        onFocus={() => onHover(item.id)} onBlur={() => onHover(undefined)}
        onPointerEnter={() => onHover(item.id)} onPointerLeave={() => onHover(undefined)}>{item.id}</button>
    })}
  </div>
}
