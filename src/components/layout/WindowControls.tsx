import { Maximize2, Minus, Square, X } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import type { WindowCloseBehavior } from '../../types/domain'

interface WindowControlsProps {
  closeBehavior: WindowCloseBehavior
  hasActiveRuntime: boolean
  onBeforeClose?: () => Promise<void>
  onCloseError?: (error: unknown) => void
}

export function WindowControls({ closeBehavior, hasActiveRuntime, onBeforeClose, onCloseError }: WindowControlsProps) {
  const { t } = useTranslation()
  const [isMaximized, setIsMaximized] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [closing, setClosing] = useState(false)
  const [hidingToTray, setHidingToTray] = useState(false)

  const minimizeToTray = useCallback(async () => {
    flushSync(() => {
      setConfirmClose(false)
      setHidingToTray(true)
    })
    try {
      const hidden = await window.termous?.windowControls?.minimizeToTray?.()
      if (!hidden) {
        setConfirmClose(true)
      }
    } catch (closeError) {
      onCloseError?.(closeError)
    } finally {
      setHidingToTray(false)
    }
  }, [onCloseError])

  const requestClose = useCallback(async () => {
    if (closeBehavior === 'minimize_to_tray' && !hasActiveRuntime) {
      await minimizeToTray()
      return
    }
    setConfirmClose(true)
  }, [closeBehavior, hasActiveRuntime, minimizeToTray])

  const confirmAndClose = useCallback(async () => {
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
  }, [onBeforeClose, onCloseError])

  useEffect(() => {
    const controls = window.termous?.windowControls
    void controls?.isMaximized().then(setIsMaximized).catch(() => setIsMaximized(false))
    const cleanupMaximize = controls?.onMaximizeState(setIsMaximized)
    const cleanupClose = controls?.onCloseRequest(() => {
      void requestClose()
    })
    return () => {
      cleanupMaximize?.()
      cleanupClose?.()
    }
  }, [requestClose])

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
          <Button className="window-control danger" onClick={() => void requestClose()} aria-label={t('app.close')} icon={<X size={15} />} />
        </Tooltip>
      </div>
      {confirmClose ? (
        <ConfirmDialog
          open
          danger
          title={t('app.closeConfirmTitle')}
          description={t('app.closeConfirmDescription')}
          confirmLabel={t('app.exitAndDisconnect')}
          secondaryLabel={t('app.minimizeToTray')}
          confirmLoading={closing}
          secondaryLoading={hidingToTray}
          showCancelButton={false}
          showCloseButton
          onSecondary={() => void minimizeToTray()}
          onConfirm={() => void confirmAndClose()}
          onCancel={() => {
            if (!closing && !hidingToTray) {
              setConfirmClose(false)
            }
          }}
        />
      ) : null}
    </>
  )
}
