import { Button, Input } from 'antd'
import {
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  VNCTargetAuthDraft,
  VNCTargetAuthDraftError,
} from '../../model/vncTargetAuthDraft.ts'
import styles from './VNCTargetAuthSection.module.scss'

interface VNCTargetAuthSectionProps {
  hasSavedAuth: boolean
  draft: VNCTargetAuthDraft
  error?: VNCTargetAuthDraftError
  disabled: boolean
  onChange: (draft: VNCTargetAuthDraft) => void
}

export function VNCTargetAuthSection({
  hasSavedAuth,
  draft,
  error,
  disabled,
  onChange,
}: VNCTargetAuthSectionProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const editingPassword = draft.mutation === 'replace'
  const removing = draft.mutation === 'remove'

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.heading}>
        <span className={styles.icon} aria-hidden="true"><KeyRound size={15} /></span>
        <span className={styles.copy}>
          <strong id={titleId}>{t('remoteDesktop.targetAuth.title')}</strong>
          <small>{t('remoteDesktop.targetAuth.hint')}</small>
        </span>
      </div>

      <div className={styles.control}>
        {!editingPassword ? (
          <div className={`${styles.status} ${removing ? styles['is-removing'] : ''}`}>
            <span className={styles['status-copy']}>
              {hasSavedAuth && !removing ? <CheckCircle2 size={15} aria-hidden="true" /> : <LockKeyhole size={15} aria-hidden="true" />}
              <span>
                <strong>{t(removing
                  ? 'remoteDesktop.targetAuth.removePending'
                  : hasSavedAuth
                    ? 'remoteDesktop.targetAuth.saved'
                    : 'remoteDesktop.targetAuth.notSaved')}</strong>
                <small>{t(removing
                  ? 'remoteDesktop.targetAuth.removePendingHint'
                  : hasSavedAuth
                    ? 'remoteDesktop.targetAuth.savedHint'
                    : 'remoteDesktop.targetAuth.notSavedHint')}</small>
              </span>
            </span>
            <span className={styles.actions}>
              {removing ? (
                <Button
                  size="small"
                  icon={<Undo2 size={13} />}
                  disabled={disabled}
                  onClick={() => onChange({ mutation: 'keep', password: '' })}
                >
                  {t('remoteDesktop.targetAuth.undo')}
                </Button>
              ) : (
                <>
                  <Button
                    size="small"
                    icon={hasSavedAuth ? <RefreshCw size={13} /> : <KeyRound size={13} />}
                    disabled={disabled}
                    onClick={() => onChange({ mutation: 'replace', password: '' })}
                  >
                    {t(hasSavedAuth
                      ? 'remoteDesktop.targetAuth.replace'
                      : 'remoteDesktop.targetAuth.add')}
                  </Button>
                  {hasSavedAuth ? (
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<Trash2 size={13} />}
                      disabled={disabled}
                      onClick={() => onChange({ mutation: 'remove', password: '' })}
                    >
                      {t('remoteDesktop.targetAuth.remove')}
                    </Button>
                  ) : null}
                </>
              )}
            </span>
          </div>
        ) : (
          <div className={styles.editor}>
            <label>
              <span>{t('remoteDesktop.targetAuth.password')}</span>
              <Input.Password
                value={draft.password}
                autoFocus
                autoComplete="new-password"
                spellCheck={false}
                status={error ? 'error' : undefined}
                disabled={disabled}
                placeholder={t('remoteDesktop.targetAuth.passwordPlaceholder')}
                prefix={<LockKeyhole size={14} aria-hidden="true" />}
                onChange={(event) => onChange({ mutation: 'replace', password: event.target.value })}
              />
              {error ? (
                <small className={styles.error} role="alert">
                  {t(`remoteDesktop.targetAuth.errors.${error}`)}
                </small>
              ) : (
                <small>{t('remoteDesktop.targetAuth.passwordHint')}</small>
              )}
            </label>
            <Button
              size="small"
              type="text"
              icon={<Undo2 size={13} />}
              disabled={disabled}
              onClick={() => onChange({ mutation: 'keep', password: '' })}
            >
              {t('app.cancel')}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
