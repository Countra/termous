import { AlertTriangle, X } from 'lucide-react'
import { Button, Modal } from 'antd'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  secondaryLabel?: string
  danger?: boolean
  confirmLoading?: boolean
  secondaryLoading?: boolean
  showCancelButton?: boolean
  showCloseButton?: boolean
  onConfirm: () => void
  onSecondary?: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  secondaryLabel,
  danger = false,
  confirmLoading = false,
  secondaryLoading = false,
  showCancelButton = true,
  showCloseButton = false,
  onConfirm,
  onSecondary,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()
  const busy = confirmLoading || secondaryLoading

  return (
    <Modal
      open={open}
      centered
      width={420}
      zIndex={3600}
      title={null}
      footer={null}
      closable={showCloseButton && !busy}
      closeIcon={<X size={16} aria-hidden="true" />}
      destroyOnHidden
      mask={{ closable: true }}
      keyboard
      className="confirm-modal"
      wrapClassName="confirm-modal-wrap"
      rootClassName="termous-modal-root"
      getContainer={() => document.body}
      onCancel={onCancel}
    >
      <section className="confirm-dialog" aria-labelledby="confirm-dialog-title">
        <div className={`dialog-icon ${danger ? 'is-danger' : ''}`}>
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <div className="dialog-copy">
          <h2 id="confirm-dialog-title">{title}</h2>
          <p>{description}</p>
        </div>
        <div className="dialog-actions">
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
