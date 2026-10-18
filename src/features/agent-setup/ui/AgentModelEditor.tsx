import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Tooltip } from 'antd'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModel, AgentModelProvider, AgentSettings } from '#entities/agent'
import { useSettingsEditor } from '#entities/settings'
import { EditorModeContext, SettingsSaveBar, uiStyles } from '#shared/ui'
import {
  createAgentModelDraft,
  isAgentModelDraftDirty,
  toAgentModelEditorValue,
  validateAgentModelDraft,
  type AgentModelDraft,
  type AgentModelEditorValue,
} from '../model/agentModelEditorDraft.ts'
import { agentSetupErrorKey } from '../model/agentSetupError.ts'
import { AgentModelConfigurationFields } from './AgentModelConfigurationFields.tsx'
import { AgentServiceNotice } from './model-services/AgentServiceNotice.tsx'
import styles from './AgentModelEditor.module.scss'

interface AgentModelEditorProps {
  provider?: AgentModelProvider
  model?: AgentModel
  settings?: AgentSettings
  busy: boolean
  conflicted: boolean
  modelMissing: boolean
  modelRemoved?: boolean
  providerMissing: boolean
  conflictError?: Error | null
  onSaveErrorChange?: (error: unknown | null) => void
  refreshing?: boolean
  onRefresh?: () => void
  onCancel: () => void
  onResolveConflict: () => Promise<{ model?: AgentModel } | undefined>
  onSave: (input: AgentModelEditorValue, baseline?: AgentModel) => Promise<void>
}

export function AgentModelEditor({
  provider,
  model,
  settings,
  busy,
  conflicted,
  modelMissing,
  modelRemoved = false,
  providerMissing,
  conflictError,
  onSaveErrorChange,
  refreshing = false,
  onRefresh,
  onCancel,
  onResolveConflict,
  onSave,
}: AgentModelEditorProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [baseline, setBaseline] = useState<AgentModel | undefined>(model)
  const [draft, setDraft] = useState<AgentModelDraft>(() => createAgentModelDraft(model, settings))
  const [externalConflict, setExternalConflict] = useState(false)
  const [baselineRefreshed, setBaselineRefreshed] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown | null>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)

  const editing = Boolean(model || baseline)
  const effectiveError = conflictError && agentSetupErrorKey(conflictError) !== 'settings.agent.error.conflict'
    ? conflictError
    : saveError
  const errorKey = effectiveError === null ? null : agentSetupErrorKey(effectiveError)
  const dirty = useMemo(
    () => isAgentModelDraftDirty(draft, baseline, settings),
    [baseline, draft, settings],
  )
  const effectiveConflict = conflicted || externalConflict
  const resourceMissing = modelMissing || modelRemoved || providerMissing

  useEffect(() => {
    if (!(validation || errorKey || effectiveConflict)) return
    feedbackRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    feedbackRef.current?.focus({ preventScroll: true })
  }, [effectiveConflict, errorKey, validation])

  useEffect(() => {
    if (!dirty) setBaselineRefreshed(false)
  }, [dirty])

  useEffect(() => {
    onSaveErrorChange?.(effectiveError)
  }, [effectiveError, onSaveErrorChange])

  useEffect(() => () => onSaveErrorChange?.(null), [onSaveErrorChange])

  useEffect(() => {
    if (!model || !baseline || model.id !== baseline.id || model.revision === baseline.revision) return
    if (isAgentModelDraftDirty(draft, baseline, settings)) {
      setExternalConflict(true)
      setBaselineRefreshed(false)
      return
    }
    setBaseline(model)
    setDraft(createAgentModelDraft(model, settings))
    setExternalConflict(false)
    setBaselineRefreshed(false)
    setValidation(null)
  }, [baseline, draft, model, settings])

  const submit = () => {
    if (busy || effectiveConflict || resourceMissing || !dirty) return
    const message = validateAgentModelDraft(draft, t)
    if (message) {
      setValidation(message)
      return
    }
    setValidation(null)
    setSaveError(null)
    setSaving(true)
    void onSave(toAgentModelEditorValue(draft), baseline).catch((error: unknown) => {
      const errorKey = agentSetupErrorKey(error)
      if (errorKey !== 'settings.agent.error.conflict') setSaveError(error)
    }).finally(() => setSaving(false))
  }

  const resolveConflict = async () => {
    const resolution = await onResolveConflict()
    if (!resolution || (baseline && !resolution.model)) return
    if (resolution.model) setBaseline(resolution.model)
    setExternalConflict(false)
    setBaselineRefreshed(true)
    setValidation(null)
    setSaveError(null)
  }

  const reset = () => {
    setBaseline(model)
    setDraft(createAgentModelDraft(model, settings))
    setExternalConflict(false)
    setBaselineRefreshed(false)
    setValidation(null)
    setSaveError(null)
  }
  const editor = { dirty, busy: busy || saving, saving, invalid: effectiveConflict || resourceMissing, save: submit, reset }
  const managed = useSettingsEditor(editor)

  return (
    <section className={styles.editor} role="region" aria-label={t(editing ? 'settings.agent.modelEditor.editTitle' : 'settings.agent.modelEditor.addTitle')}>
      <header className={styles.header}>
        <EditorModeContext mode={editing ? 'edit' : 'create'} label={t(editing ? 'app.edit' : 'app.add')}
          title={<h3>{t(editing ? 'settings.agent.modelEditor.editTitle' : 'settings.agent.modelEditor.addTitle')}</h3>}
          metaTrailing={<span className={styles.provider}>{provider?.name}</span>} />
        <div className={styles.actions}>
          {onRefresh && <Tooltip title={t('settings.agent.providers.refresh')} rootClassName={uiStyles.tooltip}>
            <Button type="text" icon={<RefreshCw size={14} aria-hidden="true" />}
              aria-label={t('settings.agent.providers.refresh')} loading={refreshing} disabled={busy}
              onClick={onRefresh} />
          </Tooltip>}
          <Button type="text" icon={<ArrowLeft size={14} aria-hidden="true" />} aria-label={t('app.cancel')}
            disabled={busy} onClick={onCancel}>{t('settings.agent.modelEditor.backToModels')}</Button>
        </div>
      </header>
      <div className={styles.body}>
        <div ref={feedbackRef} className={styles.feedback} tabIndex={-1}>
          {model && !model.capabilities_confirmed ? (
            <AgentServiceNotice type="info" title={t('settings.agent.modelEditor.conservativeTitle')}
              description={t('settings.agent.modelEditor.conservativeDescription')} />
          ) : null}
          {effectiveConflict ? (
            <AgentServiceNotice
              type="warning"
              title={t('settings.agent.conflict.title')}
              description={t(modelMissing
                ? 'settings.agent.conflict.modelDeleted'
                : modelRemoved
                  ? 'settings.agent.conflict.modelRemoved'
                : providerMissing
                  ? 'settings.agent.conflict.providerDeleted'
                  : 'settings.agent.conflict.editorDescription')}
              action={resourceMissing ? undefined : (
                <Button size="small" loading={busy} onClick={() => void resolveConflict()}>
                  {t('settings.agent.conflict.refresh')}
                </Button>
              )}
            />
          ) : null}
          {baselineRefreshed && dirty ? (
            <AgentServiceNotice type="info" title={t('settings.agent.conflict.draftPreserved')} />
          ) : null}
          {errorKey ? (
            <AgentServiceNotice
              type="error"
              title={t('settings.agent.operationFailed')}
              description={t(errorKey)}
            />
          ) : null}
          {validation ? <AgentServiceNotice type="error" title={validation} /> : null}
        </div>
        <AgentModelConfigurationFields
          draft={draft}
          setDraft={(next) => {
            setValidation(null)
            setDraft(next)
          }}
          model={model}
          settings={settings}
          editing={editing}
          busy={busy}
        />
      </div>

      {!managed && <SettingsSaveBar {...editor} onSave={submit} onReset={reset} />}
    </section>
  )
}
