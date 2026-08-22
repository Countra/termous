import { Button } from 'antd'
import {
  ArrowLeft,
  ArrowRight,
  CircleCheck,
  CircleX,
  MinusCircle,
  RotateCcw,
  TriangleAlert,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AdvancedRenameExecutionItem,
  AdvancedRenameExecutionResult,
} from '#entities/file'
import styles from './AdvancedRenameModal.module.scss'

interface AdvancedRenameResultPaneProps {
  result: AdvancedRenameExecutionResult
  disabled: boolean
  onContinueEditing: () => void
}

export function AdvancedRenameResultPane({
  result,
  disabled,
  onContinueEditing,
}: AdvancedRenameResultPaneProps) {
  const { t } = useTranslation()
  const items = Array.isArray(result.items) ? result.items : []
  return (
    <section
      className={`${styles['preview-pane']} ${styles['result-pane']}`}
      aria-label={t('files.advancedRename.result.title')}
    >
      <header className={styles['pane-heading']}>
        <span><TriangleAlert size={15} aria-hidden="true" />{t('files.advancedRename.result.title')}</span>
        <small>{t('files.advancedRename.result.total', { count: result.summary.total })}</small>
      </header>
      <p className={styles['result-description']}>{t('files.advancedRename.result.description')}</p>
      <ResultSummary result={result} />
      <div className={styles['result-table']}>
        <div className={styles['result-header']} aria-hidden="true">
          <span>{t('files.advancedRename.result.source')}</span>
          <span />
          <span>{t('files.advancedRename.result.target')}</span>
          <span>{t('files.advancedRename.result.state')}</span>
        </div>
        <div
          className={styles['result-body']}
          role="list"
          tabIndex={0}
          aria-label={t('files.advancedRename.result.list')}
        >
          {items.map((item) => <ResultRow key={item.source_path} item={item} />)}
        </div>
      </div>
      <div className={styles['result-actions']}>
        <Button
          type="primary"
          disabled={disabled}
          icon={<ArrowLeft size={14} aria-hidden="true" />}
          onClick={onContinueEditing}
        >
          {t('files.advancedRename.result.continueEditing')}
        </Button>
      </div>
    </section>
  )
}

function ResultSummary({ result }: { result: AdvancedRenameExecutionResult }) {
  const { t } = useTranslation()
  return (
    <div className={styles['result-summary']}>
      <span className={styles['is-renamed']}>
        {t('files.advancedRename.result.summary.renamed', { count: result.summary.renamed })}
      </span>
      <span>{t('files.advancedRename.result.summary.rolledBack', { count: result.summary.rolled_back })}</span>
      <span className={result.summary.failed > 0 ? styles['is-failed'] : ''}>
        {t('files.advancedRename.result.summary.failed', { count: result.summary.failed })}
      </span>
      <span className={result.summary.uncertain > 0 ? styles['is-uncertain'] : ''}>
        {t('files.advancedRename.result.summary.uncertain', { count: result.summary.uncertain })}
      </span>
    </div>
  )
}

function ResultRow({ item }: { item: AdvancedRenameExecutionItem }) {
  const { t } = useTranslation()
  const statusLabel = t(`files.advancedRename.result.status.${item.status}`)
  const statusClassName = styles[`is-${item.status.replace('_', '-')}`]
  return (
    <div className={`${styles['result-row']} ${statusClassName}`} role="listitem">
      <code className={styles['result-source']} title={item.source_path}>{item.source_path}</code>
      <ArrowRight className={styles['result-arrow']} size={13} aria-hidden="true" />
      <code className={styles['result-target']} title={item.target_path}>{item.target_path}</code>
      <span className={styles['result-status']} aria-label={statusLabel}>
        <ResultStatusIcon status={item.status} />
        <span>{statusLabel}</span>
      </span>
      {item.message ? (
        <small className={styles['result-message']} title={item.message}>{item.message}</small>
      ) : null}
    </div>
  )
}

function ResultStatusIcon({ status }: { status: AdvancedRenameExecutionItem['status'] }) {
  if (status === 'renamed') {
    return <CircleCheck size={13} aria-hidden="true" />
  }
  if (status === 'rolled_back') {
    return <RotateCcw size={13} aria-hidden="true" />
  }
  if (status === 'failed') {
    return <CircleX size={13} aria-hidden="true" />
  }
  if (status === 'uncertain') {
    return <TriangleAlert size={13} aria-hidden="true" />
  }
  return <MinusCircle size={13} aria-hidden="true" />
}
