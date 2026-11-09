import { Workflow } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Definition, WorkflowExchangeDefinition } from '#entities/desktop-workflow'
import { workflowSummary } from '../../model/exchange/summary'
import styles from './WorkflowExchangeSummary.module.scss'

export function WorkflowExchangeSummary({ name, revision, definition, assetCount }: {
  name: string; revision?: number; definition: Definition | WorkflowExchangeDefinition; assetCount?: number
}) {
  const { t } = useTranslation()
  const summary = workflowSummary(definition)
  return <section className={styles.summary} aria-label={t('desktopWorkflow.exchange.content')}>
    <div className={styles.identity}>
      <span className={styles.icon}><Workflow size={19} /></span>
      <div className={styles.name}><strong title={name}>{name}</strong><span>{t(revision === undefined ? 'desktopWorkflow.exchange.importContent' : 'desktopWorkflow.exchange.savedVersion')}{revision !== undefined && <code>v{revision}</code>}</span></div>
    </div>
    <dl className={styles.stats}>
      <div><dt>{t('desktopWorkflow.steps')}</dt><dd>{summary.count}</dd></div>
      <div><dt>{t('desktopWorkflow.parameters')}</dt><dd>{definition.parameters.length}</dd></div>
      <div><dt>{t('desktopWorkflow.exchange.templates')}</dt><dd>{assetCount ?? summary.assetCount}</dd></div>
    </dl>
  </section>
}
