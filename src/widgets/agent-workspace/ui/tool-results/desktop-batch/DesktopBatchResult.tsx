import { useTranslation } from 'react-i18next'
import type { DesktopBatchReceipt } from '#common/desktop-batch'
import styles from './DesktopBatchResult.module.scss'

export function DesktopBatchResult({ receipt }: { receipt: DesktopBatchReceipt }) {
  const { t } = useTranslation()
  const stopped = receipt.steps.find(step => step.state === 'failed' || step.state === 'uncertain' || step.state === 'skipped')
  return <section className={styles.receipt} aria-label={t('agent.tool.batch.title')}>
    <p className={styles.summary}>
      <strong>{t(`agent.tool.batch.run.${receipt.state}`)}</strong>
      <span>{t('agent.tool.batch.accepted', { count: receipt.accepted_actions, total: receipt.steps.length })}</span>
    </p>
    <p>{t('agent.tool.batch.meaning')}</p>
    {stopped ? <p>{t('agent.tool.batch.stoppedAt', { index: stopped.index + 1 })}</p> : null}
    {receipt.error_code && receipt.state !== 'cancelled' ? <p role="alert">{t('agent.tool.batch.reason')} <code>{receipt.error_code}</code></p> : null}
    <ol className={styles.steps}>
      {receipt.steps.map(step => <li key={step.index} data-state={step.state}>
        <span>{t(`agent.tool.batch.kind.${step.kind}`)}</span>
        <span>{t(`agent.tool.batch.step.${step.state}`)}</span>
        {step.error_code ? <code>{step.error_code}</code> : null}
      </li>)}
    </ol>
    {receipt.capture_state !== 'ready' ? <p>{t(`agent.tool.batch.capture.${receipt.capture_state}`)}{receipt.capture_error ? <code> · {receipt.capture_error}</code> : null}</p> : null}
    {receipt.cleanup_error ? <p role="alert">{t('agent.tool.batch.cleanup')} <code>{receipt.cleanup_error}</code></p> : null}
    {receipt.report_error ? <p role="alert">{t('agent.tool.batch.report')} <code>{receipt.report_error}</code></p> : null}
  </section>
}
