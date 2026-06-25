import { AlertTriangle } from 'lucide-react'
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
  if (!open) return null

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={`dialog-icon ${danger ? 'is-danger' : ''}`}>
          <AlertTriangle size={20} aria-hidden="true" />
        </div>
        <div className="dialog-copy">
          <h2 id="confirm-dialog-title">{title}</h2>
          <p>{description}</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onCancel}>
            {cancelLabel ?? t('app.cancel')}
          </button>
          <button type="button" className={danger ? 'danger-button' : 'primary-button'} onClick={onConfirm}>
            {confirmLabel ?? t('app.confirm')}
          </button>
        </div>
      </section>
    </div>
  )
}
