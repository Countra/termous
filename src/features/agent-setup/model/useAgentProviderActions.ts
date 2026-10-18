import { useState } from 'react'
import { App as AntdApp } from 'antd'
import { useTranslation } from 'react-i18next'
import type { AgentModelProvider } from '#entities/agent'
import { TermousApiError } from '#shared/api'
import { termousNotificationClassName } from '#shared/ui'
import type { AgentSetupController } from './useAgentSetupController.ts'

export function useAgentProviderActions(runtime: AgentSetupController, onRefreshSuccess: () => void) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [testingProviderId, setTestingProviderId] = useState<string>()
  const [refreshingProviderId, setRefreshingProviderId] = useState<string>()
  const testProvider = async (provider: AgentModelProvider) => {
    setTestingProviderId(provider.id)
    try {
      const result = await runtime.testProvider(provider)
      notification[result.status === 'ready' ? 'success' : 'warning']({
        title: t(result.status === 'ready'
          ? 'settings.agent.providers.testSuccess'
          : 'settings.agent.providers.testFailed', {
          latency: result.latency_ms,
          count: result.model_count,
        }),
        description: t(result.status === 'ready'
          ? 'settings.agent.providers.testReady'
          : 'settings.agent.providers.testUnavailable'),
        className: termousNotificationClassName,
      })
    } catch (error) {
      if (!isRequestAborted(error)) {
        notification.warning({
          title: t('settings.agent.providers.testFailed'),
          description: t('settings.agent.providers.testUnavailable'),
          className: termousNotificationClassName,
        })
      }
      throw error
    } finally {
      setTestingProviderId((current) => current === provider.id ? undefined : current)
    }
  }

  const refreshProvider = async (provider: AgentModelProvider) => {
    setRefreshingProviderId(provider.id)
    try {
      const refreshed = await runtime.refreshProvider(provider)
      const failed = refreshed.refresh_status !== 'ready' || Boolean(refreshed.last_refresh_error_code)
      if (!failed) onRefreshSuccess()
      notification[failed ? 'warning' : 'success']({
        title: t(failed
          ? 'settings.agent.catalog.refreshFailed'
          : 'settings.agent.catalog.refreshSuccess'),
        description: failed ? t('settings.agent.catalog.refreshFailedDescription') : undefined,
        className: termousNotificationClassName,
      })
    } catch (error) {
      if (!isRequestAborted(error)) {
        notification.warning({
          title: t('settings.agent.catalog.refreshFailed'),
          description: t('settings.agent.catalog.refreshFailedDescription'),
          className: termousNotificationClassName,
        })
      }
    } finally {
      setRefreshingProviderId((current) => current === provider.id ? undefined : current)
    }
  }

  return { testProvider, refreshProvider, testingProviderId, refreshingProviderId }
}

function isRequestAborted(error: unknown) {
  return error instanceof TermousApiError && error.code === 'REQUEST_ABORTED'
}
