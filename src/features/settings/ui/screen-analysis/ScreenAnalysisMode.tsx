import { Scan, ScanSearch, TextSearch } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { analysisMode, analysisModeParameters, type ScreenAnalysisParameters } from '#common/contracts'
import styles from './ScreenAnalysisSettings.module.scss'

const modes = [
  { value: 'combined', icon: ScanSearch },
  { value: 'detector', icon: Scan },
  { value: 'ocr', icon: TextSearch },
] as const
type Modes = Pick<ScreenAnalysisParameters, 'detector_enabled' | 'ocr_enabled'>

export function ScreenAnalysisMode({ value, disabled, onChange }: {
  value: Modes
  disabled: boolean
  onChange(value: Modes): void
}) {
  const { t } = useTranslation()
  const id = useId()
  return <fieldset className={styles['mode-section']} disabled={disabled} aria-describedby={`${id}-hint`}>
    <legend>{t('settings.screenAnalysis.mode')}</legend>
    <p id={`${id}-hint`}>{t('settings.screenAnalysis.modeHint')}</p>
    <div className={styles['mode-grid']}>
      {modes.map(({ value: mode, icon: Icon }) => <label className={styles['mode-option']} key={mode}>
        <input type="radio" name={id} value={mode} checked={analysisMode(value) === mode}
          aria-describedby={`${id}-${mode}`} onChange={() => onChange(analysisModeParameters(mode))} />
        <span className={styles['mode-title']}><Icon size={15} aria-hidden="true" />{t(`settings.screenAnalysis.modes.${mode}`)}</span>
        <span className={styles['mode-description']} id={`${id}-${mode}`}>{t(`settings.screenAnalysis.modeDescriptions.${mode}`)}</span>
      </label>)}
    </div>
  </fieldset>
}
