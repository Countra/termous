import { useState } from 'react'
import { Alert, Button, Skeleton } from 'antd'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { useAgentSetupController } from '../model/useAgentSetupController.ts'
import { AgentProviderManager } from './AgentProviderManager.tsx'
import { AgentRuntimeSettings } from './AgentRuntimeSettings.tsx'
import styles from './AgentSetup.module.scss'

export function AgentSettingsPanel({ gateway }: { gateway: AgentSetupGateway }) {
  const { t } = useTranslation()
  const runtime = useAgentSetupController(gateway)
  const [editorConflictVisible, setEditorConflictVisible] = useState(false)

  if (runtime.loading && !runtime.readiness) {
    return <div className={styles.skeleton}><Skeleton active paragraph={{ rows: 8 }} /></div>
  }

  if (!runtime.readiness) {
    return (
      <section className={styles.surface}>
        <Alert
          type="error"
          showIcon
          title={t('settings.agent.loadFailed')}
          description={publicError(t, runtime.error)}
        />
        <Button
          icon={<RefreshCw size={15} />}
          loading={runtime.loading}
          onClick={() => consume(runtime.load())}
        >
          {t('app.retry')}
        </Button>
      </section>
    )
  }

  const editorOwnsConflict = editorConflictVisible

  return (
    <div className={styles.stack}>
      {runtime.conflict && !editorOwnsConflict ? (
        <Alert
          type="warning"
          showIcon
          title={t('settings.agent.conflict.title')}
          description={t('settings.agent.conflict.description')}
          action={(
            <Button size="small" loading={runtime.loading} onClick={() => void runtime.resolveConflict()}>
              {t('settings.agent.conflict.refresh')}
            </Button>
          )}
        />
      ) : runtime.error && !editorOwnsConflict ? (
        <Alert
          type="error"
          showIcon
          closable
          title={t('settings.agent.operationFailed')}
          description={publicError(t, runtime.error)}
        />
      ) : null}

      <AgentRuntimeSettings runtime={runtime} />

      <AgentProviderManager
        runtime={runtime}
        onEditorConflictVisibilityChange={setEditorConflictVisible}
      />

    </div>
  )
}

function publicError(t: (key: string) => string, error: Error | null) {
  if (!error) return t('settings.agent.error.generic')
  if ('code' in error && error.code === 'VAULT_LOCKED') return t('settings.agent.error.vaultLocked')
  if ('code' in error && error.code === 'AGENT_MODEL_PROVIDER_IN_USE') {
    return t('settings.agent.error.providerInUse')
  }
  if ('code' in error && error.code === 'AGENT_MODEL_CAPABILITY_CONFLICT') {
    return t('settings.agent.error.modelCapabilityConflict')
  }
  if ('status' in error && error.status === 409) return t('settings.agent.error.conflict')
  return t('settings.agent.error.generic')
}

function consume(promise: Promise<unknown>) {
  void promise.catch(() => undefined)
}
