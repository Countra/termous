import { useEffect } from 'react'
import { App } from 'antd'
import { useTranslation } from 'react-i18next'
import type { RuntimeGateways } from '#app/data-runtime'
import { termousNotificationClassName } from '#shared/ui'

// 状态由启动协调器发布；前端只提示故障，不触发迁移或重置。
export function useStorageStatus(runtime: RuntimeGateways['runtime'], enabled: boolean) {
  const { notification } = App.useApp()
  const { t } = useTranslation()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void runtime.storageStatus(controller.signal).then((snapshot) => {
      if (controller.signal.aborted) return
      const unavailable = snapshot.databases.filter((item) => item.status === 'unavailable')
      if (unavailable.length === 0) { notification.destroy('storage-unavailable'); return }
      notification.warning({
        key: 'storage-unavailable',
        title: t('storageStatus.title'),
        description: t('storageStatus.unavailable', {
          modules: unavailable.map((item) => t(`storageStatus.domains.${item.domain}`)).join('、'),
          codes: unavailable.map((item) => item.code ?? 'STORAGE_UNAVAILABLE').join(', '),
        }),
        duration: 0,
        role: 'alert',
        className: termousNotificationClassName,
      })
    }).catch(() => {
      if (controller.signal.aborted) return
      notification.warning({ key: 'storage-unavailable', title: t('storageStatus.title'),
        description: t('storageStatus.checkFailed'), duration: 0, className: termousNotificationClassName })
    })
    return () => { controller.abort(); notification.destroy('storage-unavailable') }
  }, [enabled, runtime, notification, t])
}
