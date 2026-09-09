import { App as AntdApp, Button, Space } from 'antd'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSSHResourceState } from '#entities/agent'
import type { AgentTerminalReferenceImportJob } from '#features/agent-runtime'
import { termousNotificationClassName } from '#shared/ui'
import { AgentTerminalReferenceConfirmDialog } from './AgentTerminalReferenceConfirmDialog'

export function AgentTerminalReferenceImportNotice({ job, resources, onConfirm, onRetry, onDismiss, onOpenSettings }: {
  job?: AgentTerminalReferenceImportJob
  resources: AgentSSHResourceState[]
  onConfirm: () => void
  onRetry: () => void
  onDismiss: () => void
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const requestKey = job?.request.key
  const stage = job?.stage
  const notificationKey = requestKey !== undefined && stage !== 'confirm'
    ? `agent-terminal-reference-${requestKey}` : undefined
  const callbacksRef = useRef({ requestKey, stage, onRetry, onDismiss, onOpenSettings })
  callbacksRef.current = { requestKey, stage, onRetry, onDismiss, onOpenSettings }
  const failed = stage === 'failed'
  const configuration = stage === 'configuration'
  const canOpenSettings = Boolean(onOpenSettings)
  const title = t(`agent.terminalReference.${failed ? 'failed' : configuration ? 'configuration' : 'pending'}`)
  const description = failed ? t(`agent.terminalReference.errors.${job?.errorCode}`, {
    defaultValue: t('agent.terminalReference.errors.unknown'),
  }) : t('agent.terminalReference.retained', { host: job?.request.source_resource.host_name })

  useEffect(() => () => {
    // 离页、换绑确认和导入完成只关闭提示，引用任务仍由常驻页面管理。
    if (notificationKey) notification.destroy(notificationKey)
  }, [notification, notificationKey])

  useEffect(() => {
    if (!notificationKey) return
    let active = true
    const invoke = (action: 'onRetry' | 'onDismiss' | 'onOpenSettings') => {
      const current = callbacksRef.current
      // 退场中的旧通知不能操作队列下一项，也不能取消已经开始上传的引用。
      if (!active || current.requestKey !== requestKey || current.stage === 'confirm' || current.stage === 'importing') return
      if (action === 'onRetry' && current.stage !== 'failed') return
      if (action === 'onOpenSettings' && current.stage !== 'configuration') return
      current[action]?.()
    }
    notification.open({
      key: notificationKey,
      placement: 'topRight',
      type: failed ? 'warning' : 'info',
      title,
      description,
      duration: 0,
      showProgress: false,
      role: 'status',
      className: termousNotificationClassName,
      // 仅用户点击关闭时取消；程序化清理通知不能丢弃等待配置的原文。
      closable: stage === 'importing' ? false : { onClose: () => invoke('onDismiss') },
      actions: stage === 'importing' ? undefined : (
        <Space size="small" wrap>
          {failed ? <Button size="small" onClick={() => invoke('onRetry')}>{t('app.retry')}</Button> : null}
          {configuration && canOpenSettings ? <Button size="small" onClick={() => invoke('onOpenSettings')}>{t('agent.terminalReference.openSettings')}</Button> : null}
          <Button size="small" type="text" onClick={() => invoke('onDismiss')}>{t('app.cancel')}</Button>
        </Space>
      ),
    })
    return () => { active = false }
  }, [canOpenSettings, configuration, description, failed, notification, notificationKey, requestKey, stage, t, title])

  return job?.stage === 'confirm' ? (
    <AgentTerminalReferenceConfirmDialog binding={job.confirmation?.resource_binding}
      source={job.request.source_resource} resources={resources} onConfirm={onConfirm} onCancel={onDismiss} />
  ) : null
}
