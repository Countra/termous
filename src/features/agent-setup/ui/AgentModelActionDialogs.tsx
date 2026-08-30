import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentModel } from '#entities/agent'
import { TermousApiError } from '#shared/api'
import { ConfirmDialog, termousNotificationClassName } from '#shared/ui'
import type { AgentSetupController } from '../model/useAgentSetupController.ts'

interface AgentModelActionDialogsProps {
  runtime: AgentSetupController
  removeModel?: AgentModel
  testModel?: AgentModel
  onRemoveClose: () => void
  onTestClose: () => void
}

export function AgentModelActionDialogs({
  runtime,
  removeModel,
  testModel,
  onRemoveClose,
  onTestClose,
}: AgentModelActionDialogsProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  return (
    <>
      <ConfirmDialog
        open={Boolean(removeModel)}
        title={t('settings.agent.catalog.confirmRemoveTitle')}
        description={t('settings.agent.catalog.confirmRemoveDescription', {
          model: removeModel?.remote_model_id,
        })}
        confirmLabel={t('settings.agent.catalog.remove')}
        danger
        confirmLoading={runtime.mutation === `model:${removeModel?.id}`}
        onCancel={onRemoveClose}
        onConfirm={() => {
          if (!removeModel) return
          const target = removeModel
          onRemoveClose()
          void runtime.removeModel(target).catch(() => undefined)
        }}
      />
      <ConfirmDialog
        open={Boolean(testModel)}
        title={t('settings.agent.confirmTest.title')}
        description={t('settings.agent.confirmTest.description')}
        confirmLabel={t('settings.agent.confirmTest.confirm')}
        confirmLoading={runtime.mutation === `model:${testModel?.id}`}
        onCancel={onTestClose}
        onConfirm={() => {
          if (!testModel) return
          void runtime.testModel(testModel).then((result) => {
            onTestClose()
            notification[result.status === 'ready' ? 'success' : 'warning']({
              title: t(result.status === 'ready'
                ? 'settings.agent.testSuccess'
                : 'settings.agent.testFailed', { latency: result.latency_ms }),
              description: t(result.status === 'ready'
                ? 'settings.agent.testResult.ready'
                : 'settings.agent.testResult.failed'),
              className: termousNotificationClassName,
            })
          }).catch((error) => {
            onTestClose()
            if (!isRequestAborted(error)) {
              notification.warning({
                title: t('settings.agent.testFailed'),
                description: t('settings.agent.testResult.failed'),
                className: termousNotificationClassName,
              })
            }
          })
        }}
      />
    </>
  )
}

function isRequestAborted(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}
