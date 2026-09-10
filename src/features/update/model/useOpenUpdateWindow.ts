import { useRef, useState } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import { termousNotificationClassName } from '#shared/ui'
import { useUpdateRuntime } from './updateRuntime'

export function useOpenUpdateWindow() {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const { openUpdateWindow } = useUpdateRuntime()
  const [opening, setOpening] = useState(false)
  const openingRef = useRef(false)

  const open = async () => {
    if (openingRef.current) return
    openingRef.current = true
    setOpening(true)
    try {
      if (!await openUpdateWindow()) throw new Error('about_window_not_opened')
    } catch {
      console.error('[termous:update] 打开关于窗口失败')
      notification.error({
        key: 'termous-about-window-open-failed',
        title: t('update.global.openFailed'),
        duration: 5,
        role: 'alert',
        className: termousNotificationClassName,
      })
    } finally {
      openingRef.current = false
      setOpening(false)
    }
  }

  return { opening, open }
}
