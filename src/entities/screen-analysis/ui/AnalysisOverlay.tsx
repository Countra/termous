import type { AnalysisGeometry } from '#common/contracts'
import { useTranslation } from 'react-i18next'
import styles from './Analysis.module.scss'

interface Props { elements: AnalysisGeometry[]; image: { width: number; height: number }; selected?: number; hovered?: number; disabled: boolean; onSelect: (id: number) => void; onHover: (id?: number) => void }

export function AnalysisOverlay({ elements, image, selected, hovered, disabled, onSelect, onHover }: Props) {
  const { t } = useTranslation()
  return <div className={styles.overlay}>
    {elements.map(element => {
      const [x1, y1, x2, y2] = element.bbox_xyxy
      return <button key={element.id} type="button" className={styles.region} data-kind={element.kind}
        data-active={selected === element.id || hovered === element.id} disabled={disabled}
        aria-label={t('desktopWorkflow.analysis.element', { id: element.id, text: '' })}
        aria-pressed={selected === element.id}
        style={{ left: `${x1 / image.width * 100}%`, top: `${y1 / image.height * 100}%`, width: `${(x2 - x1) / image.width * 100}%`, height: `${(y2 - y1) / image.height * 100}%` }}
        onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelect(element.id) }}
        onPointerEnter={() => onHover(element.id)} onPointerLeave={() => onHover(undefined)}>
        <span>{element.id}</span>
      </button>
    })}
  </div>
}
