import { useTranslation } from 'react-i18next'
import { isRunActive } from '../../model/messages'
import styles from './WorkflowRunStatus.module.scss'

export function WorkflowRunStatus({ state }: { state: string }) {
  const { t } = useTranslation()
  const tone = isRunActive(state) ? 'active' : state === 'completed' ? 'success' : ['failed', 'uncertain'].includes(state) ? 'error' : 'neutral'
  return <span className={styles.status} data-tone={tone}><span className={styles.dot} />{t(`desktopWorkflow.states.${state}`)}</span>
}
