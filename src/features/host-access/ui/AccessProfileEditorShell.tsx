import { Alert, Button, Tooltip } from 'antd'
import { ArrowLeft, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ConnectionActionButton,
  EditorModeContext,
  ManagementPanel,
} from '#shared/ui'
import styles from './AccessProfileEditorShell.module.scss'

interface AccessProfileEditorShellProps {
  mode: 'create' | 'edit'
  title: string
  subtitle?: string
  icon: ReactNode
  dirty: boolean
  busy: boolean
  saveDisabled: boolean
  error?: string
  canDelete?: boolean
  deleteDisabled?: boolean
  deleteDisabledReason?: string
  children: ReactNode
  onBack: () => void
  onDiscard: () => void
  onSave: () => void
  onDelete?: () => void
}

export function AccessProfileEditorShell({
  mode,
  title,
  subtitle,
  icon,
  dirty,
  busy,
  saveDisabled,
  error,
  canDelete = false,
  deleteDisabled = false,
  deleteDisabledReason,
  children,
  onBack,
  onDiscard,
  onSave,
  onDelete,
}: AccessProfileEditorShellProps) {
  const { t } = useTranslation()
  const showSyncState = mode === 'edit' || dirty

  return (
    <ManagementPanel
      className={styles.editor}
      bodyClassName={styles['editor-body']}
      header={(
        <div className={styles['editor-header']}>
          <Button
            type="text"
            className={styles['back-button']}
            icon={<ArrowLeft size={16} />}
            aria-label={t('hosts.access.backToProfiles')}
            disabled={busy}
            onClick={onBack}
          />
          <span className={styles['editor-icon']} aria-hidden="true">{icon}</span>
          <div className={styles['editor-title']}>
            <EditorModeContext
              mode={mode}
              label={t(mode === 'create' ? 'app.add' : 'app.edit')}
              title={<h2>{title}</h2>}
              metaTrailing={showSyncState ? (
                <span
                  className={`${styles['sync-state']} ${dirty ? styles.dirty : ''}`}
                  role="status"
                  aria-live="polite"
                >
                  <i aria-hidden="true" />
                  {t(dirty ? 'hosts.unsaved' : 'hosts.saved')}
                </span>
              ) : undefined}
            />
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
      )}
      footer={(
        <div className={styles['editor-footer']}>
          {canDelete && onDelete ? (
            <Tooltip title={deleteDisabled ? deleteDisabledReason : undefined}>
              <span>
                <Button
                  danger
                  icon={<Trash2 size={14} />}
                  disabled={busy || deleteDisabled}
                  onClick={onDelete}
                >
                  {t('app.delete')}
                </Button>
              </span>
            </Tooltip>
          ) : <span />}
          <div className={styles['editor-footer-actions']}>
            <Button
              icon={<RotateCcw size={14} />}
              disabled={busy || !dirty}
              onClick={onDiscard}
            >
              {t('hosts.discard')}
            </Button>
            <ConnectionActionButton
              icon={mode === 'create' ? <Plus size={14} /> : <Save size={14} />}
              loading={busy}
              disabled={saveDisabled || busy}
              onClick={onSave}
            >
              {t(mode === 'create' ? 'app.create' : 'app.save')}
            </ConnectionActionButton>
          </div>
        </div>
      )}
    >
      {error ? (
        <Alert
          className={styles['editor-alert']}
          type="error"
          showIcon
          title={error}
        />
      ) : null}
      {children}
    </ManagementPanel>
  )
}
