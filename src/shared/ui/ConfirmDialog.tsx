import { AlertTriangle, X } from 'lucide-react'
import { Button, Modal } from 'antd'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './ConfirmDialog.module.scss'
import modalSurfaceStyles from './ModalSurface.module.scss'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: ReactNode
  width?: number
  confirmLabel?: string
  cancelLabel?: string
  secondaryLabel?: string
  danger?: boolean
  confirmLoading?: boolean
  secondaryLoading?: boolean
  showCancelButton?: boolean
  showCloseButton?: boolean
  zIndex?: number
  onConfirm: () => void
  onSecondary?: () => void
  onCancel: () => void
  onAfterClose?: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  width = 420,
  confirmLabel,
  cancelLabel,
  secondaryLabel,
  danger = false,
  confirmLoading = false,
  secondaryLoading = false,
  showCancelButton = true,
  showCloseButton = false,
  zIndex = 3600,
  onConfirm,
  onSecondary,
  onCancel,
  onAfterClose,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const busy = confirmLoading || secondaryLoading

  return (
    <Modal
      open={open}
      centered
      width={width}
      zIndex={zIndex}
      title={null}
      footer={null}
      closable={showCloseButton && !busy}
      closeIcon={<X size={16} aria-hidden="true" />}
      destroyOnHidden
      afterClose={onAfterClose}
      mask={{ closable: !busy }}
      keyboard={!busy}
      className={`${styles.modal} ${styles['dialog-modal']} confirm-modal`}
      wrapClassName={`${styles['modal-wrap']} confirm-modal-wrap`}
      rootClassName={`${styles['modal-root']} ${modalSurfaceStyles.root} termous-modal-root`}
      getContainer={() => document.body}
      onCancel={() => {
        if (!busy) {
          onCancel()
        }
      }}
    >
      <section className={styles['confirm-dialog']} aria-labelledby="confirm-dialog-title">
        <div className={`${styles['dialog-icon']} ${danger ? styles['is-danger'] : ''}`}>
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <div className={styles['dialog-copy']}>
          <h2 id="confirm-dialog-title">{title}</h2>
          <div className={styles['dialog-description']}>{description}</div>
        </div>
        <div className={styles['dialog-actions']}>
          {showCancelButton ? (
            <Button onClick={onCancel} disabled={busy}>{cancelLabel ?? t('app.cancel')}</Button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <Button loading={secondaryLoading} disabled={confirmLoading} onClick={onSecondary}>
              {secondaryLabel}
            </Button>
          ) : null}
          <Button danger={danger} type={danger ? 'primary' : 'default'} loading={confirmLoading} disabled={secondaryLoading} onClick={onConfirm}>
            {confirmLabel ?? t('app.confirm')}
          </Button>
        </div>
      </section>
    </Modal>
  )
}
