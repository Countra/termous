import { Alert, Button } from 'antd'
import { ArrowLeft, RotateCcw, Save, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ConnectionActionButton,
  EditorModeContext,
  ManagementPanel,
} from '#shared/ui'
import styles from './HostAccess.module.scss'

interface AccessProfileEditorShellProps {
  mode: 'create' | 'edit'
  title: string
  subtitle: string
  icon: ReactNode
  dirty: boolean
  busy: boolean
  saveDisabled: boolean
  error?: string
  canDelete?: boolean
  deleteDisabled?: boolean
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
  children,
  onBack,
  onDiscard,
  onSave,
  onDelete,
}: AccessProfileEditorShellProps) {
  const { t } = useTranslation()

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
            />
            <p>{subtitle}</p>
          </div>
          <span className={`${styles['sync-state']} ${dirty ? styles.dirty : ''}`}>
            {t(dirty ? 'hosts.unsaved' : 'hosts.saved')}
          </span>
        </div>
      )}
      footer={(
        <div className={styles['editor-footer']}>
          {canDelete && onDelete ? (
            <Button
              danger
              icon={<Trash2 size={14} />}
              disabled={busy || deleteDisabled}
              onClick={onDelete}
            >
              {t('app.delete')}
            </Button>
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
              icon={<Save size={14} />}
              loading={busy}
              disabled={saveDisabled || busy}
              onClick={onSave}
            >
              {t('app.save')}
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
