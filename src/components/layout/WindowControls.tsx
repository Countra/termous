import { Maximize2, Minus, Square, X } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../ui/ConfirmDialog'

interface WindowControlsProps {
  onBeforeClose?: () => Promise<void>
  onCloseError?: (error: unknown) => void
}

export function WindowControls({ onBeforeClose, onCloseError }: WindowControlsProps) {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const controls = window.termous?.windowControls
    void controls?.isMaximized().then(setIsMaximized).catch(() => setIsMaximized(false))
    const cleanupMaximize = controls?.onMaximizeState(setIsMaximized)
    const cleanupClose = controls?.onCloseRequest(() => setConfirmClose(true))
    return () => {
      cleanupMaximize?.()
      cleanupClose?.()
    }
  }, [])

  const requestClose = () => {
    setConfirmClose(true)
  }

  const confirmAndClose = async () => {
    setClosing(true)
    try {
      await onBeforeClose?.()
      setConfirmClose(false)
      await window.termous?.windowControls?.confirmClose()
    } catch (closeError) {
      onCloseError?.(closeError)
    } finally {
      setClosing(false)
    }
  }

  return (
    <>
      <div className="window-controls" aria-label={t('app.windowControls')}>
        <Tooltip title={t('app.minimize')}>
          <Button
          className="window-control"
          onClick={() => void window.termous?.windowControls?.minimize().catch(() => undefined)}
          aria-label={t('app.minimize')}
            icon={<Minus size={15} />}
          />
        </Tooltip>
        <Tooltip title={isMaximized ? t('app.restore') : t('app.maximize')}>
          <Button
          className="window-control"
          onClick={() =>
            void window.termous?.windowControls
              ?.toggleMaximize()
              .then(setIsMaximized)
              .catch(() => setIsMaximized(false))
          }
          aria-label={isMaximized ? t('app.restore') : t('app.maximize')}
            icon={isMaximized ? <Square size={13} /> : <Maximize2 size={14} />}
          />
        </Tooltip>
        <Tooltip title={t('app.close')}>
          <Button className="window-control danger" onClick={requestClose} aria-label={t('app.close')} icon={<X size={15} />} />
        </Tooltip>
      </div>
      <ConfirmDialog
        open={confirmClose}
        danger
        title={t('app.closeConfirmTitle')}
        description={t('app.closeConfirmDescription')}
        confirmLabel={t('app.close')}
        confirmLoading={closing}
        onConfirm={() => void confirmAndClose()}
        onCancel={() => {
          if (!closing) {
            setConfirmClose(false)
          }
        }}
      />
    </>
  )
}
