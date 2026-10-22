import type { AnalysisElement } from '#entities/desktop-workflow'
import { useTranslation } from 'react-i18next'
import styles from './ScreenAnalysis.module.scss'

interface Props { elements: AnalysisElement[]; selected?: number; hovered?: number; disabled: boolean; onSelect: (id: number) => void; onHover: (id?: number) => void }

export function AnalysisOverlay({ elements, selected, hovered, disabled, onSelect, onHover }: Props) {
  const { t } = useTranslation()
  return <div className={styles.overlay}>
    {elements.map(element => {
      const [x1, y1, x2, y2] = element.bbox_normalized
      return <button key={element.id} type="button" className={styles.region} data-kind={element.type}
        data-active={selected === element.id || hovered === element.id} disabled={disabled}
        aria-label={t('desktopWorkflow.analysis.element', { id: element.id, text: element.text })}
        aria-pressed={selected === element.id}
        style={{ left: `${x1 * 100}%`, top: `${y1 * 100}%`, width: `${(x2 - x1) * 100}%`, height: `${(y2 - y1) * 100}%` }}
        onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); onSelect(element.id) }}
        onPointerEnter={() => onHover(element.id)} onPointerLeave={() => onHover(undefined)}>
        <span>{element.id}</span>
      </button>
    })}
  </div>
}
