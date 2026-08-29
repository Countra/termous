import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Switch } from 'antd'
import { Save, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModel, AgentModelUpdateInput } from '#entities/agent'
import { ConfirmDialog, EditorModeContext } from '#shared/ui'
import styles from './AgentSetup.module.scss'

type ModelCapabilityInput = Omit<AgentModelUpdateInput, 'expected_revision'>

interface ModelDraft {
  displayName: string
  contextWindowTokens: number
  maxOutputTokens: number
  supportsImages: boolean
  supportsReasoning: boolean
}

interface AgentModelCapabilityDialogProps {
  model?: AgentModel
  busy: boolean
  conflicted: boolean
  modelMissing: boolean
  onCancel: () => void
  onResolveConflict: () => Promise<AgentModel | undefined>
  onSave: (input: ModelCapabilityInput, baseline: AgentModel) => Promise<void>
}

export function AgentModelCapabilityDialog({
  model,
  busy,
  conflicted,
  modelMissing,
  onCancel,
  onResolveConflict,
  onSave,
}: AgentModelCapabilityDialogProps) {
  const { t } = useTranslation()
  const [baseline, setBaseline] = useState<AgentModel | undefined>(model)
  const [draft, setDraft] = useState<ModelDraft>(() => createDraft(model))
  const [externalConflict, setExternalConflict] = useState(false)
  const [baselineRefreshed, setBaselineRefreshed] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)

  const dirty = useMemo(() => isDraftDirty(draft, baseline), [baseline, draft])
  const effectiveConflict = conflicted || externalConflict
  const requestClose = () => dirty ? setConfirmClose(true) : onCancel()

  useEffect(() => {
    if (!dirty) setBaselineRefreshed(false)
  }, [dirty])

  useEffect(() => {
    if (!model || !baseline || model.id !== baseline.id || model.revision === baseline.revision) return
    if (isDraftDirty(draft, baseline)) {
      setExternalConflict(true)
      setBaselineRefreshed(false)
      return
    }
    setBaseline(model)
    setDraft(createDraft(model))
    setExternalConflict(false)
    setBaselineRefreshed(false)
    setValidation(null)
  }, [baseline, draft, model])

  const submit = () => {
    if (busy || effectiveConflict || modelMissing || !dirty || !baseline) return
    const message = validateDraft(draft, t)
    if (message) {
      setValidation(message)
      return
    }
    setValidation(null)
    void onSave({
      display_name: draft.displayName.trim(),
      context_window_tokens: draft.contextWindowTokens,
      max_output_tokens: draft.maxOutputTokens,
      supports_images: draft.supportsImages,
      supports_reasoning: draft.supportsReasoning,
      capabilities_confirmed: true,
    }, baseline).catch(() => undefined)
  }

  const resolveConflict = async () => {
    const latest = await onResolveConflict()
    if (!latest) return
    setBaseline(latest)
    setExternalConflict(false)
    setBaselineRefreshed(true)
    setValidation(null)
  }

  return (
    <Modal
      open={Boolean(model)}
      centered
      width={600}
      title={null}
      footer={null}
      closable={!busy}
      closeIcon={<X size={16} aria-hidden="true" />}
      destroyOnHidden
      mask={{ closable: !busy }}
      keyboard={!busy}
      className={styles['model-capability-modal']}
      rootClassName="termous-modal-root"
      onCancel={requestClose}
    >
      <section className={styles['model-capability-editor']}>
        <header className={styles['model-capability-header']}>
          <EditorModeContext
            mode="edit"
            label={t('app.edit')}
            title={<h2>{model?.display_name}</h2>}
          />
          <code>{model?.remote_model_id}</code>
        </header>
        <div className={styles['model-capability-grid']}>
          <Field label={t('settings.agent.modelEditor.displayName')} wide>
            <Input
              value={draft.displayName}
              maxLength={200}
              disabled={busy}
              onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
            />
          </Field>
          <Field label={t('settings.agent.modelEditor.contextWindow')}>
            <InputNumber
              value={draft.contextWindowTokens}
              min={1024}
              max={2_000_000}
              step={1024}
              precision={0}
              disabled={busy}
              onChange={(value) => setDraft((current) => ({ ...current, contextWindowTokens: value ?? 1024 }))}
            />
          </Field>
          <Field label={t('settings.agent.modelEditor.maxOutput')}>
            <InputNumber
              value={draft.maxOutputTokens}
              min={1}
              max={draft.contextWindowTokens}
              step={256}
              precision={0}
              disabled={busy}
              onChange={(value) => setDraft((current) => ({ ...current, maxOutputTokens: value ?? 1 }))}
            />
          </Field>
        </div>
        <div className={styles['model-capability-options']}>
          <Capability
            label={t('settings.agent.modelEditor.images')}
            checked={draft.supportsImages}
            disabled={busy}
            onChange={(supportsImages) => setDraft((current) => ({ ...current, supportsImages }))}
          />
          <Capability
            label={t('settings.agent.modelEditor.reasoning')}
            checked={draft.supportsReasoning}
            disabled={busy}
            onChange={(supportsReasoning) => setDraft((current) => ({ ...current, supportsReasoning }))}
          />
        </div>
        {!model?.capabilities_confirmed ? (
          <Alert
            type="info"
            showIcon
            title={t('settings.agent.modelEditor.conservativeTitle')}
            description={t('settings.agent.modelEditor.conservativeDescription')}
          />
        ) : null}
        {effectiveConflict ? (
          <Alert
            type="warning"
            showIcon
            title={t('settings.agent.conflict.title')}
            description={t(modelMissing
              ? 'settings.agent.conflict.modelDeleted'
              : 'settings.agent.conflict.editorDescription')}
            action={modelMissing ? undefined : (
              <Button size="small" loading={busy} onClick={() => void resolveConflict()}>
                {t('settings.agent.conflict.refresh')}
              </Button>
            )}
          />
        ) : null}
        {baselineRefreshed && dirty ? (
          <Alert type="info" showIcon title={t('settings.agent.conflict.draftPreserved')} />
        ) : null}
        {validation ? <p className={styles.validation} role="alert">{validation}</p> : null}
        <footer className={styles['model-capability-footer']}>
          <Button disabled={busy} onClick={requestClose}>{t('app.cancel')}</Button>
          <Button
            type="primary"
            icon={<Save size={15} />}
            loading={busy}
            disabled={effectiveConflict || modelMissing || !dirty}
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

function Field({ label, wide = false, children }: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`${styles['model-capability-field']} ${wide ? styles['is-wide'] : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function Capability({ label, checked, disabled, onChange }: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className={styles['model-capability-option']}>
      <span>{label}</span>
      <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  )
}

function createDraft(model?: AgentModel): ModelDraft {
  return {
    displayName: model?.display_name ?? '',
    contextWindowTokens: model?.context_window_tokens ?? 16_384,
    maxOutputTokens: model?.max_output_tokens ?? 4_096,
    supportsImages: model?.supports_images ?? false,
    supportsReasoning: model?.supports_reasoning ?? false,
  }
}

function isDraftDirty(draft: ModelDraft, model?: AgentModel) {
  if (!model) return false
  return draft.displayName !== model.display_name
    || draft.contextWindowTokens !== model.context_window_tokens
    || draft.maxOutputTokens !== model.max_output_tokens
    || draft.supportsImages !== model.supports_images
    || draft.supportsReasoning !== model.supports_reasoning
}

function validateDraft(draft: ModelDraft, t: (key: string) => string) {
  if (!draft.displayName.trim()) return t('settings.agent.validation.displayName')
  if (new TextEncoder().encode(draft.displayName.trim()).byteLength > 200) {
    return t('settings.agent.validation.displayNameTooLarge')
  }
  if (!Number.isInteger(draft.contextWindowTokens) || !Number.isInteger(draft.maxOutputTokens)) {
    return t('settings.agent.validation.integerTokens')
  }
  if (draft.contextWindowTokens < 1024 || draft.contextWindowTokens > 2_000_000) {
    return t('settings.agent.validation.contextWindow')
  }
  if (draft.maxOutputTokens < 1 || draft.maxOutputTokens > draft.contextWindowTokens) {
    return t('settings.agent.validation.tokenLimit')
  }
  return null
}
