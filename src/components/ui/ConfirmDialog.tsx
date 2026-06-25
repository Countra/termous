import { AlertTriangle } from 'lucide-react'
import { Button, Modal } from 'antd'
import { useTranslation } from 'react-i18next'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <Modal
      open={open}
      centered
      width={420}
      zIndex={3600}
      title={null}
      footer={null}
      closeIcon={null}
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
          <Button onClick={onCancel}>{cancelLabel ?? t('app.cancel')}</Button>
          <Button danger={danger} type={danger ? 'primary' : 'default'} onClick={onConfirm}>
            {confirmLabel ?? t('app.confirm')}
          </Button>
        </div>
      </section>
    </Modal>
  )
}
