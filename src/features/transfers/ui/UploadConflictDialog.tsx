import { AlertTriangle, Check, CopyPlus, File, Replace } from 'lucide-react'
import { Button, Modal } from 'antd'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '#shared/format'
import type {
  UploadConflictDialogProps,
  UploadConflictPolicy,
} from '../model/uploadConflict.ts'
import styles from './UploadConflictDialog.module.scss'

const previewLimit = 4

export function UploadConflictDialog({
  open,
  conflicts,
  targetPath,
  selectedPolicy,
  onPolicyChange,
  onContinue,
  onCancel,
}: UploadConflictDialogProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const descriptionId = useId()
  const choicesId = useId()
  const radioName = `upload-conflict-policy-${choicesId}`
  const preview = conflicts.slice(0, previewLimit)
  const remaining = Math.max(0, conflicts.length - preview.length)

  const choices: Array<{
    policy: UploadConflictPolicy
    icon: typeof CopyPlus
    label: string
    hint: string
  }> = [
    {
      policy: 'rename',
      icon: CopyPlus,
      label: t('files.uploadConflict.keepBoth'),
      hint: t('files.uploadConflict.keepBothHint'),
    },
    {
      policy: 'overwrite',
      icon: Replace,
      label: t('files.uploadConflict.overwrite'),
      hint: t('files.uploadConflict.overwriteHint'),
    },
  ]

  return (
    <Modal
      open={open}
      centered
      width={560}
      zIndex={3600}
      title={<span>{t('files.uploadConflict.title')}</span>}
      footer={null}
      closable={false}
      destroyOnHidden
      mask={{ closable: true }}
      keyboard
      className={styles.modal}
      wrapClassName={styles['modal-wrap']}
      rootClassName={`${styles['modal-root']} termous-modal-root`}
      getContainer={() => document.body}
      onCancel={onCancel}
    >
      <section
        className={styles.dialog}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <header className={styles.header}>
          <span className={styles['header-icon']} aria-hidden="true">
            <AlertTriangle size={21} />
          </span>
          <span className={styles['header-copy']}>
            <small>{t('files.uploadConflict.eyebrow')}</small>
            <h2 id={titleId}>{t('files.uploadConflict.title')}</h2>
            <p id={descriptionId}>
              {t('files.uploadConflict.description', { count: conflicts.length })}
            </p>
          </span>
        </header>

        <div className={styles.target}>
          <small>{t('files.uploadConflict.target')}</small>
          <strong title={targetPath}>{targetPath}</strong>
        </div>

        <div className={styles.preview} role="list">
          {preview.map(({ incoming, existing }) => (
            <div className={styles['preview-row']} role="listitem" key={`${incoming.id}:${existing.path}`}>
              <span className={styles['file-icon']} aria-hidden="true">
                <File size={16} />
              </span>
              <span className={styles['file-copy']}>
                <strong title={incoming.name}>{incoming.name}</strong>
                <small>{t('files.uploadConflict.incoming', { size: formatBytes(incoming.size ?? 0) })}</small>
              </span>
              <small className={styles.existing}>
                {t('files.uploadConflict.existing', { size: formatBytes(existing.size) })}
              </small>
            </div>
          ))}
          {remaining > 0 ? (
            <div className={styles.more}>{t('files.uploadConflict.more', { count: remaining })}</div>
          ) : null}
        </div>

        <fieldset className={styles.choices} aria-labelledby={choicesId}>
          <legend id={choicesId}>{t('files.uploadConflict.choiceLabel')}</legend>
          <div className={styles['choice-grid']}>
            {choices.map(({ policy, icon: Icon, label, hint }) => {
              const selected = selectedPolicy === policy
              return (
                <label
                  className={`${styles.choice} ${selected ? styles['is-selected'] : ''} ${policy === 'overwrite' ? styles['is-overwrite'] : ''}`}
                  key={policy}
                >
                  <input
                    type="radio"
                    name={radioName}
                    value={policy}
                    checked={selected}
                    onChange={() => onPolicyChange(policy)}
                  />
                  <span className={styles['choice-icon']} aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className={styles['choice-copy']}>
                    <strong>{label}</strong>
                    <small>{hint}</small>
                  </span>
                  <span className={styles['choice-check']} aria-hidden="true">
                    {selected ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        {conflicts.length > 1 ? (
          <p className={styles['batch-hint']}>
            {t('files.uploadConflict.batchHint', { count: conflicts.length })}
          </p>
        ) : null}

        <footer className={styles.actions}>
          <Button onClick={onCancel}>{t('app.cancel')}</Button>
          <Button
            type="primary"
            danger={selectedPolicy === 'overwrite'}
            onClick={onContinue}
          >
            {t(selectedPolicy === 'overwrite'
              ? 'files.uploadConflict.continueOverwrite'
              : 'files.uploadConflict.continueRename')}
          </Button>
        </footer>
      </section>
    </Modal>
  )
}
