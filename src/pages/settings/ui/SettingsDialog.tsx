import { useCallback, useRef, useState } from 'react'
import { Modal } from 'antd'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '#shared/ui'
import { SettingsWorkspace, type SettingsWorkspaceProps } from './SettingsWorkspace'
import styles from './SettingsDialog.module.scss'

export interface SettingsDialogProps extends SettingsWorkspaceProps {
  open: boolean
  onClose(): void
  guided?: boolean
}

export function SettingsDialog({ open, onClose, onDirtyChange, onBusyChange, guided = false, ...props }: SettingsDialogProps) {
  const { t } = useTranslation()
  const boundary = useRef({ dirty: false, busy: false })
  const [busy, setBusy] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const handleDirty = useCallback((dirty: boolean) => {
    boundary.current.dirty = dirty
    onDirtyChange?.(dirty)
  }, [onDirtyChange])
  const handleBusy = useCallback((value: boolean) => {
    boundary.current.busy = value
    setBusy(value)
    onBusyChange?.(value)
  }, [onBusyChange])
  const requestClose = () => {
    if (boundary.current.busy || guided) return
    if (boundary.current.dirty) setConfirmClose(true)
    else onClose()
  }
  return <Modal open={open} centered width={1100} title={t('settings.title')} footer={null} transitionName=""
    zIndex={guided ? 2970 : undefined}
    focusable={{ trap: !guided }}
    destroyOnHidden mask={{ closable: false }} keyboard={!busy && !confirmClose && !guided}
    closable={{ disabled: busy || guided, 'aria-label': t('app.close') }} closeIcon={<X size={18} aria-hidden="true" />}
    className={styles.dialog} rootClassName={`termous-modal-root ${styles.root}${guided ? ' termous-product-tour-surface' : ''}`}
    classNames={{ container: styles.container, header: styles.header, body: styles.body, close: styles.close }}
    afterClose={() => setConfirmClose(false)} onCancel={requestClose}>
    <SettingsWorkspace {...props} onDirtyChange={handleDirty} onBusyChange={handleBusy} />
    <ConfirmDialog open={open && confirmClose} title={t('settings.editor.leaveTitle')}
      description={t('settings.editor.leaveDescription')} confirmLabel={t('settings.editor.discard')}
      danger onCancel={() => setConfirmClose(false)} onConfirm={() => {
        if (boundary.current.busy) return
        setConfirmClose(false)
        onClose()
      }} />
  </Modal>
}
