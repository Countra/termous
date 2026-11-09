import { Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { analysisMode, analysisModeParameters, type AnalysisMode, type ScreenAnalysisParameters } from '#common/contracts'

type Modes = Pick<ScreenAnalysisParameters, 'detector_enabled' | 'ocr_enabled'>
export function AnalysisModeSelect({ value, disabled, onChange, id }: { value: Modes; disabled?: boolean; id?: string; onChange: (value: Modes) => void }) {
  const { t } = useTranslation()
  return <Select id={id} aria-label={t('settings.screenAnalysis.mode')} value={analysisMode(value)} disabled={disabled}
    options={(['combined', 'detector', 'ocr'] as const).map(mode => ({ value: mode, label: t(`settings.screenAnalysis.modes.${mode}`) }))}
    onChange={(mode: AnalysisMode) => onChange(analysisModeParameters(mode))} />
}
