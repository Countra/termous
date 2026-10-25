import { useTranslation } from 'react-i18next'
import { analysisParameterBounds, type ScreenAnalysisParameters } from '#common/contracts'
import styles from './AnalysisDetails.module.scss'

export function AnalysisParameterFacts({ parameters }: { parameters: ScreenAnalysisParameters }) {
  const { t } = useTranslation()
  const keys = ['detector_enabled', 'ocr_enabled', ...Object.keys(analysisParameterBounds)] as (keyof ScreenAnalysisParameters)[]
  return <dl className={styles.facts}>{keys.map(key => {
    const value = parameters[key]
    const label = typeof value === 'boolean' ? t(`desktopWorkflow.analysisWorkspace.detail.${key}`) : t(`settings.screenAnalysis.${key}`)
    const formatted = typeof value === 'boolean' ? t(`desktopWorkflow.analysis.${value ? 'enabled' : 'disabled'}`)
      : ['confidence', 'text_confidence', 'nms_iou'].includes(key) ? `${Number((value * 100).toFixed(2))}%`
      : ['image_size', 'ocr_max_side'].includes(key) ? `${value} px` : value
    return <div key={key}><dt>{label}</dt><dd>{formatted}</dd></div>
  })}</dl>
}
