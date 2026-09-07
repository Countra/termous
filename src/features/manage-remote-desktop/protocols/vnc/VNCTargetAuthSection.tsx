import { Button, Input, Segmented } from 'antd'
import {
  CheckCircle2,
  CircleHelp,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  TriangleAlert,
  Undo2,
} from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ProfileEditorSectionHeading } from '#shared/ui'
import type {
  VNCTargetAuthDraft,
  VNCTargetAuthDraftError,
} from '../../model/vncTargetAuthDraft.ts'
import styles from './VNCTargetAuthSection.module.scss'
import segmentedStyles from './VNCProfileSegmented.module.scss'

interface VNCTargetAuthSectionProps {
  hasSavedAuth: boolean
  draft: VNCTargetAuthDraft
  error?: VNCTargetAuthDraftError
  disabled: boolean
  onChange: (draft: VNCTargetAuthDraft) => void
}

type TargetAuthMode = 'prompt' | 'saved'

export function VNCTargetAuthSection({
  hasSavedAuth,
  draft,
  error,
  disabled,
  onChange,
}: VNCTargetAuthSectionProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const passwordDescriptionId = useId()
  const modeControlRef = useRef<HTMLDivElement>(null)
  const authDetailRef = useRef<HTMLDivElement>(null)
  const restoreFocusAfterCancelRef = useRef(false)
  const editingPassword = draft.mutation === 'replace'
  const removing = draft.mutation === 'remove'
  const mode: TargetAuthMode = editingPassword || (hasSavedAuth && !removing)
    ? 'saved'
    : 'prompt'
  const state = removing ? 'removing' : hasSavedAuth ? 'saved' : 'empty'

  useEffect(() => {
    if (editingPassword || !restoreFocusAfterCancelRef.current) return
    restoreFocusAfterCancelRef.current = false
    const replaceAction = authDetailRef.current?.querySelector<HTMLButtonElement>(
      '[data-target-auth-replace-action]',
    )
    const selectedMode = modeControlRef.current?.querySelector<HTMLInputElement>(
      'input[type="radio"]:checked',
    )
    const focusTarget = replaceAction ?? selectedMode
    focusTarget?.focus()
  }, [editingPassword])

  const changeMode = (nextMode: TargetAuthMode) => {
    if (nextMode === 'saved') {
      onChange(hasSavedAuth
        ? { mutation: 'keep', password: '' }
        : { mutation: 'replace', password: '' })
      return
    }
    onChange(hasSavedAuth
      ? { mutation: 'remove', password: '' }
      : { mutation: 'keep', password: '' })
  }

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles['section-inner']}>
        <ProfileEditorSectionHeading
          classNames={styles}
          id={titleId}
          icon={<KeyRound size={15} />}
          title={t('remoteDesktop.targetAuth.title')}
        />

        <div className={styles['auth-layout']}>
          <div className={styles['mode-setting']}>
            <span className={styles['mode-label']}>{t('remoteDesktop.targetAuth.mode')}</span>
            <Segmented<TargetAuthMode>
              ref={modeControlRef}
              block
              className={segmentedStyles.control}
              value={mode}
              disabled={disabled}
              aria-label={t('remoteDesktop.targetAuth.mode')}
              options={[
                {
                  value: 'prompt',
                  icon: <CircleHelp size={13} aria-hidden="true" />,
                  label: t('remoteDesktop.targetAuth.promptOption'),
                },
                {
                  value: 'saved',
                  icon: <LockKeyhole size={13} aria-hidden="true" />,
                  label: t(hasSavedAuth
                    ? 'remoteDesktop.targetAuth.savedOption'
                    : 'remoteDesktop.targetAuth.saveOption'),
                },
              ]}
              onChange={changeMode}
            />
          </div>

          <div ref={authDetailRef} className={styles['auth-detail']}>
            {editingPassword ? (
              <div className={styles.editor}>
                <label className={styles.field} data-invalid={error ? 'true' : 'false'}>
                  <span>{t('remoteDesktop.targetAuth.password')}</span>
                  <Input.Password
                    value={draft.password}
                    autoFocus
                    autoComplete="new-password"
                    aria-label={t('remoteDesktop.targetAuth.password')}
                    aria-describedby={passwordDescriptionId}
                    aria-invalid={error ? true : undefined}
                    spellCheck={false}
                    status={error ? 'error' : undefined}
                    disabled={disabled}
                    placeholder={t('remoteDesktop.targetAuth.passwordPlaceholder')}
                    prefix={<LockKeyhole size={14} aria-hidden="true" />}
                    onChange={(event) => onChange({ mutation: 'replace', password: event.target.value })}
                  />
                  <small
                    id={passwordDescriptionId}
                    className={error ? styles.error : undefined}
                    role={error ? 'alert' : undefined}
                  >
                    {t(error
                      ? `remoteDesktop.targetAuth.errors.${error}`
                      : 'remoteDesktop.targetAuth.passwordHint')}
                  </small>
                </label>
                <Button
                  size="small"
                  type="text"
                  icon={<Undo2 size={13} />}
                  disabled={disabled}
                  onClick={() => {
                    restoreFocusAfterCancelRef.current = true
                    onChange({ mutation: 'keep', password: '' })
                  }}
                >
                  {t('app.cancel')}
                </Button>
              </div>
            ) : (
              <div className={styles.status} data-state={state}>
                <span className={styles['status-copy']} role="status" aria-live="polite">
                  {removing
                    ? <TriangleAlert size={16} aria-hidden="true" />
                    : hasSavedAuth
                      ? <CheckCircle2 size={16} aria-hidden="true" />
                      : <CircleHelp size={16} aria-hidden="true" />}
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
                {hasSavedAuth && !removing ? (
                  <Button
                    size="small"
                    type="text"
                    className={styles['replace-action']}
                    data-target-auth-replace-action
                    icon={<RefreshCw size={13} />}
                    disabled={disabled}
                    onClick={() => onChange({ mutation: 'replace', password: '' })}
                  >
                    {t('remoteDesktop.targetAuth.replace')}
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
