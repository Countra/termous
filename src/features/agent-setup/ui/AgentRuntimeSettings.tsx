import { useLayoutEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useSettingsEditor } from '#entities/settings'
import { ConfirmDialog, SettingsSaveBar } from '#shared/ui'
import type { AgentSetupController } from '../model/useAgentSetupController'
import { useAgentConfiguration } from '../model/useAgentConfiguration'
import { agentSetupErrorKey } from '../model/agentSetupError'
import { AgentExecutionBudgetSettings } from './AgentExecutionBudgetSettings'
import { AgentGlobalModelDefaults } from './AgentGlobalModelDefaults'
import { AgentBehaviorSettings } from './AgentBehaviorSettings'
import { AgentReadinessSection } from './AgentReadinessSection'
import styles from './AgentSetup.module.scss'

export function AgentRuntimeSettings({ runtime, onErrorVisibilityChange }: { runtime: AgentSetupController; onErrorVisibilityChange?: (visible: boolean) => void }) {
  const { t } = useTranslation()
  const editor = useAgentConfiguration(runtime, runtime.readiness!)
  const [confirmBypass, setConfirmBypass] = useState(false)
  useLayoutEffect(() => { onErrorVisibilityChange?.(editor.failed) }, [editor.failed, onErrorVisibilityChange])
  const save = () => {
    if (editor.needsBypassConfirmation) setConfirmBypass(true)
    else void editor.save()
  }
  const invalid = Boolean(Object.keys(editor.errors).length || editor.conflict)
  const errorKey = runtime.error ? agentSetupErrorKey(runtime.error) : null
  const managed = useSettingsEditor({ dirty: editor.dirty, busy: editor.busy || confirmBypass, invalid,
    saving: editor.saving, saved: editor.saved, save, reset: editor.reset })
  return <div className={styles['configuration-layout']} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (editor.dirty && !editor.busy && !invalid) save()
    }
  }}>
    <AgentReadinessSection runtime={runtime} dirty={editor.dirty} />
    <AgentGlobalModelDefaults draft={editor.draft} errors={editor.errors} providers={runtime.providers}
      models={runtime.models} busy={editor.busy} onChange={editor.change} />
    <AgentBehaviorSettings editor={editor} policyAvailable={Boolean(runtime.readiness?.mcp_policy)} />
    <AgentExecutionBudgetSettings editor={editor} />
    {editor.conflict && <Alert type="warning" showIcon title={t('settings.agent.conflict.title')}
      description={<>{t('settings.agent.conflict.defaultsDescription')}
        {errorKey && errorKey !== 'settings.agent.error.conflict' && <p>{t(errorKey)}</p>}</>}
      action={<Button size="small" disabled={editor.busy} onClick={() => void editor.refresh()}>{t('settings.agent.conflict.refresh')}</Button>} />}
    {editor.failed && !editor.conflict && <Alert type="error" showIcon title={t('settings.agent.configuration.saveFailed')}
      description={errorKey ? t(errorKey) : undefined} />}
    {!managed && <SettingsSaveBar dirty={editor.dirty} busy={editor.busy || confirmBypass} saving={editor.saving} invalid={invalid} saved={editor.saved}
      onSave={save} onReset={editor.reset} />}
    <ConfirmDialog open={confirmBypass} title={t('settings.agent.confirmBypass.title')}
      description={t('settings.agent.confirmBypass.description')} confirmLabel={t('settings.agent.confirmBypass.confirm')}
      danger confirmLoading={editor.busy} onCancel={() => setConfirmBypass(false)}
      onConfirm={() => { void editor.save().then(() => setConfirmBypass(false)) }} />
  </div>
}
