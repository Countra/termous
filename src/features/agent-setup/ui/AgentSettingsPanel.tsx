import { useState } from 'react'
import { Alert, Button, Skeleton } from 'antd'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { agentSetupErrorKey } from '../model/agentSetupError.ts'
import { useAgentSetupController } from '../model/useAgentSetupController.ts'
import { AgentProviderManager } from './AgentProviderManager.tsx'
import { AgentRuntimeSettings } from './AgentRuntimeSettings.tsx'
import styles from './AgentSetup.module.scss'

export function AgentSettingsPanel({ gateway }: { gateway: AgentSetupGateway }) {
  const { t } = useTranslation()
  const runtime = useAgentSetupController(gateway)
  const [editorConflictVisible, setEditorConflictVisible] = useState(false)
  const [defaultsConflictVisible, setDefaultsConflictVisible] = useState(false)

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

  const localEditorOwnsConflict = editorConflictVisible || defaultsConflictVisible

  return (
    <div className={styles.stack}>
      {runtime.conflict && !localEditorOwnsConflict ? (
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
      ) : runtime.error && !localEditorOwnsConflict ? (
        <Alert
          type="error"
          showIcon
          closable
          title={t('settings.agent.operationFailed')}
          description={publicError(t, runtime.error)}
        />
      ) : null}

      <AgentRuntimeSettings
        runtime={runtime}
        onDefaultsConflictVisibilityChange={setDefaultsConflictVisible}
      />

      <AgentProviderManager
        runtime={runtime}
        onEditorConflictVisibilityChange={setEditorConflictVisible}
      />

    </div>
  )
}

function publicError(t: (key: string) => string, error: Error | null) {
  return t(agentSetupErrorKey(error))
}

function consume(promise: Promise<unknown>) {
  void promise.catch(() => undefined)
}
