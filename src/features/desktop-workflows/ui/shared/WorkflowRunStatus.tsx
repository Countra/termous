import { useTranslation } from 'react-i18next'
import { runTone } from './runPresentation'
import styles from './WorkflowRunStatus.module.scss'

export function WorkflowRunStatus({ state }: { state: string }) {
  const { t } = useTranslation()
  return <span className={styles.status} data-tone={runTone(state)}><span className={styles.dot} />{t(`desktopWorkflow.states.${state}`, { defaultValue: state })}</span>
}
