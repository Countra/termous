import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Alert, Button, Input, Select, Switch, Tooltip, type InputRef } from 'antd'
import {
  BadgeInfo,
  Cable,
  FlaskConical,
  KeyRound,
  Plus,
  RotateCcw,
  Save,
  Undo2,
  Unlink2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AgentApiMode,
  AgentModelProvider,
  AgentModelProviderInput,
} from '#entities/agent'
import { ConfirmDialog, customSelectStyles, uiStyles } from '#shared/ui'
import styles from './AgentProviderForm.module.scss'

interface ProviderDraft {
  name: string
  apiMode: AgentApiMode
  baseUrl: string
  enabled: boolean
  apiKey: string
  removeApiKey: boolean
}

interface AgentProviderConnectionFormProps {
  provider?: AgentModelProvider
  busy: boolean
  conflicted: boolean
  providerMissing: boolean
  provisionFailure?: 'refresh'
  testing: boolean
  focusRequest: number
  onDirtyChange: (dirty: boolean) => void
  onResolveConflict: () => Promise<AgentModelProvider | undefined>
  onSave: (input: AgentModelProviderInput, baseline?: AgentModelProvider) => Promise<void>
  onTest: () => Promise<void>
}

export function AgentProviderConnectionForm({
  provider,
  busy,
  conflicted,
  providerMissing,
  provisionFailure,
  testing,
  focusRequest,
  onDirtyChange,
  onResolveConflict,
  onSave,
  onTest,
}: AgentProviderConnectionFormProps) {
  const { t } = useTranslation()
  const [baseline, setBaseline] = useState<AgentModelProvider | undefined>(provider)
  const [draft, setDraft] = useState<ProviderDraft>(() => createDraft(provider))
  const [externalConflict, setExternalConflict] = useState(false)
  const [baselineRefreshed, setBaselineRefreshed] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [confirmHttp, setConfirmHttp] = useState(false)
  const apiKeyControlId = useId()
  const nameInputRef = useRef<InputRef>(null)

  const dirty = useMemo(() => isDraftDirty(draft, baseline), [baseline, draft])
  const effectiveConflict = conflicted || externalConflict
  const apiKeyTooLarge = useMemo(() => utf8Bytes(draft.apiKey) > 16 * 1024, [draft.apiKey])
  const apiKeyState = draft.removeApiKey
    ? 'removePending'
    : draft.apiKey.trim()
      ? baseline?.api_key_configured ? 'replacePending' : 'addPending'
      : baseline?.api_key_configured ? 'configured' : 'notConfigured'
  const apiKeyTone = apiKeyState === 'removePending'
    ? 'remove-pending'
    : apiKeyState === 'replacePending'
      ? 'replace-pending'
      : apiKeyState === 'addPending'
        ? 'add-pending'
        : apiKeyState === 'notConfigured' ? 'not-configured' : 'configured'
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => {
    if (!dirty) setBaselineRefreshed(false)
  }, [dirty])
  useEffect(() => {
    if (focusRequest > 0) nameInputRef.current?.focus({ cursor: 'end', preventScroll: true })
  }, [focusRequest])
  useEffect(() => {
    if (!provider || !baseline || provider.id !== baseline.id || provider.revision === baseline.revision) return
    if (isDraftDirty(draft, baseline)) {
      setExternalConflict(true)
      setBaselineRefreshed(false)
      return
    }
    setBaseline(provider)
    setDraft(createDraft(provider))
    setExternalConflict(false)
    setBaselineRefreshed(false)
    setValidation(null)
    setConfirmHttp(false)
  }, [baseline, draft, provider])

  const submit = (confirmInsecureHttp: boolean) => {
    if (busy || effectiveConflict || !dirty) return
    const message = validateDraft(draft, t)
    if (message) {
      setValidation(message)
      return
    }
    setValidation(null)
    if (isInsecureHttp(draft.baseUrl) && !confirmInsecureHttp) {
      setConfirmHttp(true)
      return
    }
    void onSave(toInput(draft, confirmInsecureHttp), baseline)
      .catch(() => undefined)
      .finally(() => setConfirmHttp(false))
  }

  const reset = () => {
    setDraft(createDraft(baseline))
    setValidation(null)
    setConfirmHttp(false)
  }

  const resolveConflict = async () => {
    const latest = await onResolveConflict()
    if (!latest) return
    setBaseline(latest)
    setExternalConflict(false)
    setBaselineRefreshed(true)
    setValidation(null)
    setConfirmHttp(false)
  }

  return (
    <>
      <div className={styles['provider-form']}>
        <section className={styles['provider-form-section']}>
          <header className={styles['provider-form-section-heading']}>
            <BadgeInfo size={15} aria-hidden="true" />
            <h4>{t('settings.agent.providerEditor.basicSection')}</h4>
          </header>
          <div className={`${styles['provider-form-grid']} ${styles['is-basic']}`}>
            <Field label={t('settings.agent.providerEditor.name')}>
              <Input
                ref={nameInputRef}
                value={draft.name}
                maxLength={80}
                disabled={busy}
                placeholder={t('settings.agent.providerEditor.namePlaceholder')}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              />
            </Field>
            <Field label={t('settings.agent.providerEditor.enabled')}>
              <div className={styles['provider-enabled-control']}>
                <span>{t(draft.enabled
                  ? 'settings.agent.providerEditor.enabledState'
                  : 'settings.agent.providerEditor.disabledState')}</span>
                <Switch
                  size="small"
                  checked={draft.enabled}
                  disabled={busy}
                  onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
                />
              </div>
            </Field>
          </div>
        </section>

        <section className={styles['provider-form-section']}>
          <header className={styles['provider-form-section-heading']}>
            <Cable size={15} aria-hidden="true" />
            <h4>{t('settings.agent.providerEditor.connectionSection')}</h4>
          </header>
          <div className={`${styles['provider-form-grid']} ${styles['is-connection']}`}>
            <Field label={t('settings.agent.providerEditor.apiMode')}>
              <Select
                value={draft.apiMode}
                disabled={busy}
                className={customSelectStyles.select}
                classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
                options={[
                  { value: 'responses', label: t('settings.agent.apiMode.responses') },
                  { value: 'chat_completions', label: t('settings.agent.apiMode.chatCompletions') },
                ]}
                onChange={(apiMode) => setDraft((current) => ({ ...current, apiMode }))}
              />
            </Field>
            <Field label={t('settings.agent.providerEditor.baseUrl')}>
              <Input
                value={draft.baseUrl}
                maxLength={2048}
                disabled={busy}
                placeholder="https://api.example.com/v1"
                onChange={(event) => setDraft((current) => ({ ...current, baseUrl: event.target.value }))}
              />
            </Field>
            <div className={`${styles['provider-field']} ${styles['is-wide']}`}>
              <div className={styles['provider-secret-label']}>
                <label htmlFor={apiKeyControlId}>{t('settings.agent.providerEditor.optionalApiKey')}</label>
                <span className={`${styles['provider-secret-state']} ${styles[`is-${apiKeyTone}`]}`}>
                  <i aria-hidden="true" />
                  {t(`settings.agent.apiKey.${apiKeyState}`)}
                </span>
              </div>
              {draft.removeApiKey ? (
                <div className={styles['provider-secret-removal']}>
                  <span>
                    <Unlink2 size={15} aria-hidden="true" />
                    {t('settings.agent.apiKey.removePendingHint')}
                  </span>
                  <Button
                    type="text"
                    size="small"
                    icon={<Undo2 size={14} aria-hidden="true" />}
                    disabled={busy}
                    onClick={() => setDraft((current) => ({ ...current, removeApiKey: false }))}
                  >
                    {t('settings.agent.apiKey.undoRemove')}
                  </Button>
                </div>
              ) : (
                <div className={styles['provider-secret-input']}>
                  <Input.Password
                    id={apiKeyControlId}
                    value={draft.apiKey}
                    disabled={busy}
                    autoComplete="new-password"
                    aria-invalid={apiKeyTooLarge}
                    prefix={<KeyRound size={14} aria-hidden="true" />}
                    placeholder={t(baseline?.api_key_configured
                      ? 'settings.agent.apiKey.configuredPlaceholder'
                      : 'settings.agent.apiKey.optionalPlaceholder')}
                    onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))}
                    onPressEnter={() => submit(false)}
                  />
                  {baseline?.api_key_configured ? (
                    <Button
                      type="text"
                      danger
                      icon={<Unlink2 size={14} aria-hidden="true" />}
                      disabled={busy}
                      onClick={() => setDraft((current) => ({
                        ...current,
                        apiKey: '',
                        removeApiKey: true,
                      }))}
                    >
                      {t('settings.agent.apiKey.remove')}
                    </Button>
                  ) : null}
                </div>
              )}
              {apiKeyTooLarge ? (
                <small className={styles['provider-field-error']} role="alert">
                  {t('settings.agent.apiKey.tooLarge')}
                </small>
              ) : !draft.removeApiKey ? (
                <small className={styles['provider-field-hint']}>
                  {t(baseline?.api_key_configured
                    ? 'settings.agent.apiKey.configuredHint'
                    : 'settings.agent.apiKey.optionalHint')}
                </small>
              ) : null}
            </div>
          </div>
        </section>

        {isInsecureHttp(draft.baseUrl) ? (
          <Alert
            type="warning"
            showIcon
            title={t('settings.agent.providerEditor.httpRiskTitle')}
            description={t('settings.agent.providerEditor.httpRisk')}
          />
        ) : null}
        {provisionFailure ? (
          <Alert
            type="warning"
            showIcon
            title={t(`settings.agent.providerEditor.provisionFailure.${provisionFailure}.title`)}
            description={t(`settings.agent.providerEditor.provisionFailure.${provisionFailure}.description`)}
          />
        ) : null}
        {effectiveConflict ? (
          <Alert
            type="warning"
            showIcon
            title={t('settings.agent.conflict.title')}
            description={t(providerMissing
              ? 'settings.agent.conflict.providerDeleted'
              : 'settings.agent.conflict.editorDescription')}
            action={providerMissing ? (
              <Button size="small" disabled={busy} onClick={reset}>
                {t('settings.agent.providers.discard')}
              </Button>
            ) : (
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

        <footer className={styles['provider-form-footer']}>
          <div className={styles['provider-form-test']}>
            {provider ? (
              <Tooltip
                title={dirty
                  ? t('settings.agent.providerEditor.testRequiresSave')
                  : t('settings.agent.providers.test')}
                rootClassName={uiStyles.tooltip}
              >
                <span>
                  <Button
                    icon={<FlaskConical size={15} aria-hidden="true" />}
                    loading={testing}
                    disabled={busy || dirty || effectiveConflict}
                    onClick={() => void onTest().catch(() => undefined)}
                  >
                    {t('settings.agent.providers.test')}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
          </div>
          <div className={styles['provider-form-actions']}>
            <Button
              icon={<RotateCcw size={15} aria-hidden="true" />}
              disabled={busy || !dirty || effectiveConflict}
              onClick={reset}
            >
              {t('settings.agent.providerEditor.reset')}
            </Button>
            <Button
              type="primary"
              icon={provider ? <Save size={15} /> : <Plus size={15} />}
              loading={busy && !testing}
              disabled={effectiveConflict || !dirty || apiKeyTooLarge}
              onClick={() => submit(false)}
            >
              {t(provider ? 'app.save' : 'app.create')}
            </Button>
          </div>
        </footer>
      </div>
      <ConfirmDialog
        open={confirmHttp}
        title={t('settings.agent.confirmHttp.title')}
        description={t('settings.agent.confirmHttp.description')}
        confirmLabel={t('settings.agent.confirmHttp.confirm')}
        danger
        confirmLoading={busy}
        onCancel={() => setConfirmHttp(false)}
        onConfirm={() => submit(true)}
      />
    </>
  )
}

function Field({ label, wide = false, children }: {
  label: React.ReactNode
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <label className={`${styles['provider-field']} ${wide ? styles['is-wide'] : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  )
}

function createDraft(provider?: AgentModelProvider): ProviderDraft {
  return provider ? {
    name: provider.name,
    apiMode: provider.api_mode,
    baseUrl: provider.base_url,
    enabled: provider.enabled,
    apiKey: '',
    removeApiKey: false,
  } : {
    name: '',
    apiMode: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    apiKey: '',
    removeApiKey: false,
  }
}

function isDraftDirty(draft: ProviderDraft, provider?: AgentModelProvider) {
  if (!provider) {
    return Boolean(draft.name || draft.apiKey)
      || draft.apiMode !== 'responses'
      || draft.baseUrl !== 'https://api.openai.com/v1'
      || !draft.enabled
  }
  return draft.name !== provider.name
    || draft.apiMode !== provider.api_mode
    || draft.baseUrl !== provider.base_url
    || draft.enabled !== provider.enabled
    || Boolean(draft.apiKey.trim())
    || draft.removeApiKey
}

function toInput(draft: ProviderDraft, confirmInsecureHttp: boolean): AgentModelProviderInput {
  const input: AgentModelProviderInput = {
    name: draft.name.trim(),
    api_mode: draft.apiMode,
    base_url: draft.baseUrl.trim(),
    enabled: draft.enabled,
    confirm_insecure_http: confirmInsecureHttp,
  }
  if (draft.apiKey.trim()) input.api_key = draft.apiKey
  if (draft.removeApiKey) input.remove_api_key = true
  return input
}

function validateDraft(draft: ProviderDraft, t: (key: string) => string) {
  const name = draft.name.trim()
  if (!name) return t('settings.agent.validation.providerName')
  if (utf8Bytes(name) > 80) return t('settings.agent.validation.nameTooLarge')
  if (utf8Bytes(draft.apiKey) > 16 * 1024) return t('settings.agent.apiKey.tooLarge')
  if (utf8Bytes(draft.baseUrl.trim()) > 2048) return t('settings.agent.validation.baseUrlTooLarge')
  try {
    const url = new URL(draft.baseUrl.trim())
    if (!['http:', 'https:'].includes(url.protocol)
      || url.username || url.password || url.search || url.hash) {
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
