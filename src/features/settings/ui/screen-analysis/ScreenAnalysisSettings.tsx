import type { AnalysisGateway } from '#entities/screen-analysis'
import { AIRuntimeSetting } from './AIRuntimeSetting'
import { ScreenAnalysisSetting } from './ScreenAnalysisSetting'
import { ScreenAnalysisStorageSetting } from './ScreenAnalysisStorageSetting'
import styles from './ScreenAnalysisSettings.module.scss'

export function ScreenAnalysisSettings({ disabled, gateway, active }: {
  disabled: boolean
  gateway?: AnalysisGateway
  active: boolean
}) {
  return <div className={styles.page}>
    <AIRuntimeSetting disabled={disabled} active={active} />
    <ScreenAnalysisSetting disabled={disabled} />
    <ScreenAnalysisStorageSetting disabled={disabled} gateway={gateway} active={active} />
  </div>
}
