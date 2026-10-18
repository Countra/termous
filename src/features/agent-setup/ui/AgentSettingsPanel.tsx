import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Skeleton } from 'antd'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentSetupGateway } from '../api/agentSetupGateway.ts'
import { agentSetupErrorKey } from '../model/agentSetupError.ts'
import { useAgentSetupController } from '../model/useAgentSetupController.ts'
import { AgentProviderManager } from './AgentProviderManager.tsx'
import { AgentRuntimeSettings } from './AgentRuntimeSettings.tsx'
import { AgentServiceNotice } from './model-services/AgentServiceNotice.tsx'
import styles from './AgentSetup.module.scss'

export function AgentSettingsPanel({ gateway, view = 'preferences', active = true }: { gateway: AgentSetupGateway; view?: 'preferences' | 'models'; active?: boolean }) {
  const { t } = useTranslation()
  const Notice = view === 'models' ? AgentServiceNotice : Alert
  const runtime = useAgentSetupController(gateway)
  const { load } = runtime
  const wasActive = useRef(active)
  useEffect(() => {
    if (active && !wasActive.current) void load()
    wasActive.current = active
  }, [active, load])
  const [editorConflictVisible, setEditorConflictVisible] = useState(false)
  const [editorErrorVisible, setEditorErrorVisible] = useState(false)
  const [configurationErrorVisible, setConfigurationErrorVisible] = useState(false)

  if (runtime.loading && !runtime.readiness) {
    return <div className={styles.skeleton}><Skeleton active paragraph={{ rows: 8 }} /></div>
  }

  if (!runtime.readiness) {
    return (
      <section className={styles.surface}>
        <Notice
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

  const localEditorOwnsConflict = editorConflictVisible || view === 'preferences' && runtime.conflict?.kind === 'configuration'
  const errorBelongsToConflict = Boolean(runtime.conflict
    && agentSetupErrorKey(runtime.error) === 'settings.agent.error.conflict')

  return (
    <div className={styles.stack}>
      {runtime.conflict && !localEditorOwnsConflict ? (
        <Notice
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
      ) : null}
      {runtime.error && !editorErrorVisible && !configurationErrorVisible && !errorBelongsToConflict && runtime.conflict?.kind !== 'configuration' ? (
        <Notice
          type="error"
          showIcon
          closable
          title={t('settings.agent.operationFailed')}
          description={publicError(t, runtime.error)}
        />
      ) : null}

      {view === 'preferences' ? <AgentRuntimeSettings runtime={runtime} onErrorVisibilityChange={setConfigurationErrorVisible} /> : <AgentProviderManager
        runtime={runtime}
        onEditorConflictVisibilityChange={setEditorConflictVisible}
        onErrorVisibilityChange={setEditorErrorVisible}
      />}

    </div>
  )
}

function publicError(t: (key: string) => string, error: Error | null) {
  return t(agentSetupErrorKey(error))
}

function consume(promise: Promise<unknown>) {
  void promise.catch(() => undefined)
}
