import { Crosshair, ScanLine, SquareDashed } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styles from './PreviewModeControl.module.scss'

export type PreviewMode = 'point' | 'template' | 'region'
interface Props { value: PreviewMode; disabled: boolean; pointDisabled: boolean; onChange: (mode: PreviewMode) => void }

export function PreviewModeControl({ value, disabled, pointDisabled, onChange }: Props) {
  const { t } = useTranslation()
  const options = [{ value: 'point', Icon: Crosshair }, { value: 'template', Icon: ScanLine }, { value: 'region', Icon: SquareDashed }] as const
  return <div className={styles.modes} role="group" aria-label={t('desktopWorkflow.selectionMode')}>
    {options.map(({ value: mode, Icon }) => <button key={mode} type="button" aria-pressed={value === mode} disabled={disabled || mode === 'point' && pointDisabled} onClick={() => onChange(mode)}>
      <Icon size={14} /><span>{t(`desktopWorkflow.select_${mode}`)}</span>
    </button>)}
  </div>
}
