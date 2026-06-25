import { Maximize2, Minus, Square, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../ui/ConfirmDialog'

export function WindowControls() {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)

  useEffect(() => {
    void window.termous?.windowControls?.isMaximized().then(setIsMaximized)
    const cleanupMaximize = window.termous?.windowControls?.onMaximizeState(setIsMaximized)
    const cleanupClose = window.termous?.windowControls?.onCloseRequest(() => setConfirmClose(true))
    return () => {
      cleanupMaximize?.()
      cleanupClose?.()
    }
  }, [])

  const requestClose = () => {
    setConfirmClose(true)
    void window.termous?.windowControls?.requestClose()
  }

  const confirmAndClose = () => {
    setConfirmClose(false)
    void window.termous?.windowControls?.confirmClose()
  }

  return (
    <>
      <div className="window-controls" aria-label={t('app.windowControls')}>
        <button
          type="button"
          className="window-control"
          onClick={() => void window.termous?.windowControls?.minimize()}
          aria-label={t('app.minimize')}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          className="window-control"
          onClick={() => void window.termous?.windowControls?.toggleMaximize().then(setIsMaximized)}
          aria-label={isMaximized ? t('app.restore') : t('app.maximize')}
        >
          {isMaximized ? <Square size={13} /> : <Maximize2 size={14} />}
        </button>
        <button type="button" className="window-control danger" onClick={requestClose} aria-label={t('app.close')}>
          <X size={15} />
        </button>
      </div>
      <ConfirmDialog
        open={confirmClose}
        danger
        title={t('app.closeConfirmTitle')}
        description={t('app.closeConfirmDescription')}
        confirmLabel={t('app.close')}
        onConfirm={confirmAndClose}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  )
}
