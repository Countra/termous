import { App as AntdApp, Button, Space } from 'antd'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { getAgentResourceBinding, type AgentResourceState } from '#entities/agent'
import type { AgentTerminalReferenceImportJob } from '#features/agent-runtime'
import { termousNotificationClassName } from '#shared/ui'
import { AgentTerminalReferenceConfirmDialog } from './AgentTerminalReferenceConfirmDialog'

const COMPLETED_NOTICE_DURATION_SECONDS = 2

export function AgentTerminalReferenceImportNotice({ job, resources, onConfirm, onRetry, onDismiss, onOpenSettings }: {
  job?: AgentTerminalReferenceImportJob
  resources: AgentResourceState[]
  onConfirm: () => void
  onRetry: () => void
  onDismiss: () => void
  onOpenSettings?: () => void
}) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const notificationRef = useRef(notification)
  notificationRef.current = notification
  const requestKey = job?.request.key
  const stage = job?.stage
  const notificationKey = requestKey !== undefined && stage !== 'confirm'
    ? `agent-terminal-reference-${requestKey}` : undefined
  const callbacksRef = useRef({ requestKey, stage, onRetry, onDismiss, onOpenSettings })
  callbacksRef.current = { requestKey, stage, onRetry, onDismiss, onOpenSettings }
  const noticeStateRef = useRef<{
    key: string
    stage: AgentTerminalReferenceImportJob['stage'] | 'completed'
    connection?: boolean
  } | undefined>(undefined)
  const failed = stage === 'failed'
  const configuration = stage === 'configuration'
  const canOpenSettings = Boolean(onOpenSettings)
  const connection = job?.request.source === 'connection_reference'
  const title = t(failed ? `agent.${connection ? 'connectionReference' : 'terminalReference'}.failed` : 'agent.terminalReference.configuration')
  const errorNamespace = `agent.${connection ? 'connectionReference' : 'terminalReference'}.errors`
  const description = failed ? t(`${errorNamespace}.${job?.errorCode}`, {
    defaultValue: t(`${errorNamespace}.unknown`),
  }) : t(connection ? 'agent.connectionReference.retained' : 'agent.terminalReference.retained', { host: job?.request.source_resource.host_name })

  useEffect(() => () => {
    // 离页立即清理当前提示，包括正在延迟收起的完成提示，不影响引用任务。
    if (noticeStateRef.current) notificationRef.current.destroy(noticeStateRef.current.key)
    noticeStateRef.current = undefined
  }, [])

  useEffect(() => {
    const previous = noticeStateRef.current
    if (!notificationKey || !stage) {
      if (!previous) return
      if (!stage && (previous.stage === 'pending' || previous.stage === 'importing')) {
        // 只延长完成反馈，不延迟导入或队列；记录完成状态，避免普通重渲染重置计时。
        noticeStateRef.current = { key: previous.key, stage: 'completed' }
        notification.open({
          key: previous.key,
          placement: 'topRight',
          type: 'success',
          title: t(previous.connection ? 'agent.connectionReference.completed' : 'agent.terminalReference.completed'),
          description: t(previous.connection ? 'agent.connectionReference.completedDescription' : 'agent.terminalReference.completedDescription'),
          duration: COMPLETED_NOTICE_DURATION_SECONDS,
          showProgress: false,
          role: 'status',
          className: termousNotificationClassName,
          closable: true,
          actions: undefined,
        })
      } else if (previous.stage !== 'completed' || stage === 'confirm') {
        notification.destroy(previous.key)
        noticeStateRef.current = undefined
      }
      return
    }
    if (previous && previous.key !== notificationKey) notification.destroy(previous.key)
    noticeStateRef.current = { key: notificationKey, stage, connection }
    if (stage === 'pending' || stage === 'importing') {
      // 处理中仅记录任务状态以识别完成；重试或配置恢复时收起上一条结果提示。
      if (previous?.key === notificationKey && previous.stage !== 'pending' && previous.stage !== 'importing') {
        notification.destroy(notificationKey)
      }
      return
    }
    let active = true
    const invoke = (action: 'onRetry' | 'onDismiss' | 'onOpenSettings') => {
      const current = callbacksRef.current
      // 退场中的旧通知不能操作队列下一项，也不能取消已经开始上传的引用。
      if (!active || current.requestKey !== requestKey || current.stage === 'confirm' || current.stage === 'importing') return
      if (action === 'onRetry' && current.stage !== 'failed') return
      if (action === 'onOpenSettings' && current.stage !== 'configuration') return
      if (action === 'onDismiss') {
        // 主动取消立即关闭，不能将任务移除误判为导入成功。
        notification.destroy(notificationKey)
        noticeStateRef.current = undefined
      }
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
      closable: { onClose: () => invoke('onDismiss') },
      actions: (
        <Space size="small" wrap>
          {failed ? <Button size="small" onClick={() => invoke('onRetry')}>{t('app.retry')}</Button> : null}
          {configuration && canOpenSettings ? <Button size="small" onClick={() => invoke('onOpenSettings')}>{t('agent.terminalReference.openSettings')}</Button> : null}
          <Button size="small" type="text" onClick={() => invoke('onDismiss')}>{t('app.cancel')}</Button>
        </Space>
      ),
    })
    return () => { active = false }
  }, [canOpenSettings, configuration, connection, description, failed, notification, notificationKey, requestKey, stage, t, title])

  return job?.stage === 'confirm' ? (
    <AgentTerminalReferenceConfirmDialog binding={getAgentResourceBinding(job.confirmation?.resource_bindings, job.request.resource_reference.kind)}
      source={job.request.source_resource} resources={resources} connectionOnly={connection} onConfirm={onConfirm} onCancel={onDismiss} />
  ) : null
}
