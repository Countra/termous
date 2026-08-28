import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Select, Switch } from 'antd'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentApiMode, AgentModelProfile, AgentModelProfileInput } from '#entities/agent'
import { ConfirmDialog } from '#shared/ui'
import styles from './AgentSetup.module.scss'

interface Draft {
  name: string
  apiMode: AgentApiMode
  baseUrl: string
  modelId: string
  contextWindowTokens: number
  maxOutputTokens: number
  supportsImages: boolean
  supportsReasoning: boolean
}

interface AgentModelProfileEditorProps {
  open: boolean
  profile?: AgentModelProfile
  busy: boolean
  conflicted: boolean
  revisionRefreshed: boolean
  onCancel: () => void
  onResolveConflict: () => Promise<void>
  onSave: (input: AgentModelProfileInput) => Promise<void>
}

export function AgentModelProfileEditor({
  open,
  profile,
  busy,
  conflicted,
  revisionRefreshed,
  onCancel,
  onResolveConflict,
  onSave,
}: AgentModelProfileEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<Draft>(() => createDraft(profile))
  const [confirmHttp, setConfirmHttp] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const previousOpen = useRef(false)
  const draftProfileId = useRef<string | undefined>(profile?.id)
  const latestProfile = useRef(profile)
  latestProfile.current = profile

  useEffect(() => {
    const profileChanged = draftProfileId.current !== profile?.id
    if (open && (!previousOpen.current || profileChanged)) {
      setDraft(createDraft(latestProfile.current))
      setValidation(null)
      setConfirmHttp(false)
      draftProfileId.current = profile?.id
    }
    if (!open) draftProfileId.current = undefined
    previousOpen.current = open
  }, [open, profile?.id])

  const input = useMemo(() => toInput(draft, false), [draft])

  const submit = () => {
    const message = validateDraft(draft, t)
    if (message) {
      setValidation(message)
      return
    }
    setValidation(null)
    if (isInsecureHttp(draft.baseUrl)) {
      setConfirmHttp(true)
      return
    }
    void onSave(input).catch(() => undefined)
  }

  return (
    <>
      <Modal
        open={open}
        centered
        width={640}
        title={null}
        footer={null}
        closable={!busy}
        closeIcon={<X size={16} aria-hidden="true" />}
        destroyOnHidden
        mask={{ closable: !busy }}
        keyboard={!busy}
        className={styles['editor-modal']}
        rootClassName="termous-modal-root"
        onCancel={onCancel}
      >
        <section className={styles.editor} aria-labelledby="agent-model-editor-title">
          <header className={styles['editor-header']}>
            <h2 id="agent-model-editor-title">
              {t(profile ? 'settings.agent.modelEditor.editTitle' : 'settings.agent.modelEditor.createTitle')}
            </h2>
          </header>

          <div className={styles['form-grid']}>
            <Field label={t('settings.agent.modelEditor.name')} wide>
              <Input disabled={busy} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label={t('settings.agent.modelEditor.apiMode')}>
              <Select
                disabled={busy}
                value={draft.apiMode}
                options={[
                  { value: 'responses', label: t('settings.agent.apiMode.responses') },
                  { value: 'chat_completions', label: t('settings.agent.apiMode.chatCompletions') },
                ]}
                onChange={(apiMode) => setDraft({ ...draft, apiMode })}
              />
            </Field>
            <Field label={t('settings.agent.modelEditor.modelId')}>
              <Input disabled={busy} value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} />
            </Field>
            <Field label={t('settings.agent.modelEditor.baseUrl')} wide>
              <Input disabled={busy} value={draft.baseUrl} maxLength={2048} placeholder="https://api.example.com/v1" onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} />
            </Field>
            <Field label={t('settings.agent.modelEditor.contextWindow')}>
              <InputNumber disabled={busy} min={1024} max={2_000_000} precision={0} step={1024} value={draft.contextWindowTokens} onChange={(value) => setDraft({ ...draft, contextWindowTokens: value ?? 1024 })} />
            </Field>
            <Field label={t('settings.agent.modelEditor.maxOutput')}>
              <InputNumber disabled={busy} min={1} max={draft.contextWindowTokens} precision={0} step={256} value={draft.maxOutputTokens} onChange={(value) => setDraft({ ...draft, maxOutputTokens: value ?? 1 })} />
            </Field>
          </div>

          <div className={styles['capability-list']}>
            <Capability
              label={t('settings.agent.modelEditor.images')}
              checked={draft.supportsImages}
              disabled={busy}
              onChange={(supportsImages) => setDraft({ ...draft, supportsImages })}
            />
            <Capability
              label={t('settings.agent.modelEditor.reasoning')}
              checked={draft.supportsReasoning}
              disabled={busy}
              onChange={(supportsReasoning) => setDraft({ ...draft, supportsReasoning })}
            />
          </div>

          {isInsecureHttp(draft.baseUrl) ? (
            <p className={styles['risk-note']}>{t('settings.agent.modelEditor.httpRisk')}</p>
          ) : null}
          {conflicted ? (
            <Alert
              type="warning"
              showIcon
              title={t('settings.agent.conflict.title')}
              description={t('settings.agent.conflict.editorDescription')}
              action={<Button size="small" loading={busy} onClick={() => void onResolveConflict()}>{t('settings.agent.conflict.refresh')}</Button>}
            />
          ) : null}
          {revisionRefreshed ? <Alert type="info" showIcon title={t('settings.agent.conflict.draftPreserved')} /> : null}
          {validation ? <p className={styles.validation} role="alert">{validation}</p> : null}

          <footer className={styles['editor-actions']}>
            <Button disabled={busy} onClick={onCancel}>{t('app.cancel')}</Button>
            <Button type="primary" loading={busy} disabled={conflicted} onClick={submit}>{t('app.save')}</Button>
          </footer>
        </section>
      </Modal>
      <ConfirmDialog
        open={confirmHttp}
        title={t('settings.agent.confirmHttp.title')}
        description={t('settings.agent.confirmHttp.description')}
        confirmLabel={t('settings.agent.confirmHttp.confirm')}
        danger
        confirmLoading={busy}
        onCancel={() => setConfirmHttp(false)}
        onConfirm={() => void onSave(toInput(draft, true)).catch(() => undefined).finally(() => setConfirmHttp(false))}
      />
    </>
  )
}

function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`${styles.field} ${wide ? styles.wide : ''}`}><span>{label}</span>{children}</label>
}

function Capability({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label className={styles.capability}><span>{label}</span><Switch size="small" checked={checked} disabled={disabled} onChange={onChange} /></label>
}

function createDraft(profile?: AgentModelProfile): Draft {
  return profile ? {
    name: profile.name,
    apiMode: profile.api_mode,
    baseUrl: profile.base_url,
    modelId: profile.model_id,
    contextWindowTokens: profile.context_window_tokens,
    maxOutputTokens: profile.max_output_tokens,
    supportsImages: profile.supports_images,
    supportsReasoning: profile.supports_reasoning,
  } : {
    name: '', apiMode: 'responses', baseUrl: 'https://api.openai.com/v1', modelId: '',
    contextWindowTokens: 128_000, maxOutputTokens: 8_192, supportsImages: false, supportsReasoning: false,
  }
}

function toInput(draft: Draft, confirmInsecureHttp: boolean): AgentModelProfileInput {
  return {
    name: draft.name.trim(), api_mode: draft.apiMode, base_url: draft.baseUrl.trim(), model_id: draft.modelId.trim(),
    context_window_tokens: draft.contextWindowTokens, max_output_tokens: draft.maxOutputTokens,
    supports_images: draft.supportsImages, supports_reasoning: draft.supportsReasoning,
    confirm_insecure_http: confirmInsecureHttp,
  }
}

function validateDraft(draft: Draft, t: (key: string) => string) {
  const name = draft.name.trim()
  const modelId = draft.modelId.trim()
  if (!name) return t('settings.agent.validation.name')
  if (utf8Bytes(name) > 80) return t('settings.agent.validation.nameTooLarge')
  if (!modelId) return t('settings.agent.validation.modelId')
  if (utf8Bytes(modelId) > 200) return t('settings.agent.validation.modelIdTooLarge')
  if (!Number.isInteger(draft.contextWindowTokens) || !Number.isInteger(draft.maxOutputTokens)) return t('settings.agent.validation.integerTokens')
  if (draft.contextWindowTokens < 1024 || draft.contextWindowTokens > 2_000_000) return t('settings.agent.validation.contextWindow')
  if (draft.maxOutputTokens < 1 || draft.maxOutputTokens > draft.contextWindowTokens) return t('settings.agent.validation.tokenLimit')
  try {
    const url = new URL(draft.baseUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return t('settings.agent.validation.baseUrl')
    }
  } catch {
    return t('settings.agent.validation.baseUrl')
  }
  return null
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength
}

function isInsecureHttp(value: string) {
  try {
    return new URL(value.trim()).protocol === 'http:'
  } catch {
    return false
  }
}
