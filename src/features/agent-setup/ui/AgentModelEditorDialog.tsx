import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Modal } from 'antd'
import { Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModel, AgentModelProvider, AgentSettings } from '#entities/agent'
import { ConfirmDialog, EditorModeContext } from '#shared/ui'
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
import styles from './AgentModelEditorDialog.module.scss'

interface AgentModelEditorDialogProps {
  provider?: AgentModelProvider
  model?: AgentModel
  settings?: AgentSettings
  open: boolean
  busy: boolean
  conflicted: boolean
  modelMissing: boolean
  modelRemoved?: boolean
  providerMissing: boolean
  conflictError?: Error | null
  onSaveErrorChange?: (error: unknown | null) => void
  onCancel: () => void
  onResolveConflict: () => Promise<{ model?: AgentModel } | undefined>
  onSave: (input: AgentModelEditorValue, baseline?: AgentModel) => Promise<void>
}

export function AgentModelEditorDialog({
  provider,
  model,
  settings,
  open,
  busy,
  conflicted,
  modelMissing,
  modelRemoved = false,
  providerMissing,
  conflictError,
  onSaveErrorChange,
  onCancel,
  onResolveConflict,
  onSave,
}: AgentModelEditorDialogProps) {
  const { t } = useTranslation()
  const [baseline, setBaseline] = useState<AgentModel | undefined>(model)
  const [draft, setDraft] = useState<AgentModelDraft>(() => createAgentModelDraft(model, settings))
  const [externalConflict, setExternalConflict] = useState(false)
  const [baselineRefreshed, setBaselineRefreshed] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
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
  const requestClose = () => dirty ? setConfirmClose(true) : onCancel()

  useEffect(() => {
    if (!open || !(validation || errorKey || effectiveConflict)) return
    const body = bodyRef.current
    const feedback = feedbackRef.current
    if (!body || !feedback) return
    const bodyBounds = body.getBoundingClientRect()
    const feedbackBounds = feedback.getBoundingClientRect()
    // 只调整弹窗内部滚动，不让新错误带动背景设置页滚动。
    if (feedbackBounds.top < bodyBounds.top) {
      body.scrollTop += feedbackBounds.top - bodyBounds.top
    } else if (feedbackBounds.bottom > bodyBounds.bottom) {
      body.scrollTop += Math.min(feedbackBounds.top - bodyBounds.top, feedbackBounds.bottom - bodyBounds.bottom)
    }
  }, [effectiveConflict, errorKey, open, validation])

  useEffect(() => {
    if (!dirty) setBaselineRefreshed(false)
  }, [dirty])

  useEffect(() => {
    onSaveErrorChange?.(open ? effectiveError : null)
  }, [effectiveError, onSaveErrorChange, open])

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
    void onSave(toAgentModelEditorValue(draft), baseline).catch((error: unknown) => {
      const errorKey = agentSetupErrorKey(error)
      if (errorKey !== 'settings.agent.error.conflict') setSaveError(error)
    })
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

  return (
    <Modal
      open={open}
      centered
      width={660}
      title={null}
      footer={null}
      closable={!busy}
      closeIcon={<X size={16} aria-hidden="true" />}
      destroyOnHidden
      mask={{ closable: !busy }}
      keyboard={!busy}
      className={styles.modal}
      rootClassName="termous-modal-root"
      onCancel={requestClose}
    >
      <section className={styles.editor}>
        <header className={styles.header}>
          <EditorModeContext
            mode={editing ? 'edit' : 'create'}
            label={t(editing ? 'app.edit' : 'app.add')}
            title={<h2>{t(editing ? 'settings.agent.modelEditor.editTitle' : 'settings.agent.modelEditor.addTitle')}</h2>}
          />
          <span>{provider?.name}</span>
        </header>

        <div ref={bodyRef} className={styles.body}>
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

          <div ref={feedbackRef} className={styles.feedback}>
            {model && !model.capabilities_confirmed ? (
              <Alert type="info" showIcon title={t('settings.agent.modelEditor.conservativeTitle')} />
            ) : null}
            {effectiveConflict ? (
              <Alert
                type="warning"
                showIcon
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
              <Alert type="info" showIcon title={t('settings.agent.conflict.draftPreserved')} />
            ) : null}
            {errorKey ? (
              <Alert
                type="error"
                showIcon
                title={t('settings.agent.operationFailed')}
                description={t(errorKey)}
              />
            ) : null}
            {validation ? <p className={styles.validation} role="alert">{validation}</p> : null}
          </div>
        </div>

        <footer className={styles.footer}>
          <Button disabled={busy} onClick={requestClose}>{t('app.cancel')}</Button>
          <Button
            type="primary"
            icon={<Save size={15} />}
            loading={busy}
            disabled={effectiveConflict || resourceMissing || !dirty}
            onClick={submit}
          >
            {t('app.save')}
          </Button>
        </footer>
      </section>
      <ConfirmDialog
        open={confirmClose}
        title={t('settings.agent.modelEditor.discardTitle')}
        description={t('settings.agent.modelEditor.discardDescription')}
        confirmLabel={t('settings.agent.providers.discard')}
        danger
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false)
          onCancel()
        }}
      />
    </Modal>
  )
}
