import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Input, Select, Switch, Tooltip, type InputRef } from 'antd'
import {
  BadgeInfo,
  Cable,
  FlaskConical,
  KeyRound,
  Undo2,
  Unlink2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type {
  AgentModelProvider,
  AgentModelProviderInput,
} from '#entities/agent'
import { ConfirmDialog, customSelectStyles, uiStyles } from '#shared/ui'
import { useSettingsEditor } from '#entities/settings'
import { createDraft, isDraftDirty, isInsecureHttp, toInput, utf8Bytes, validateDraft, type ProviderDraft } from '../model/agentProviderDraft.ts'
import { agentSetupErrorKey } from '../model/agentSetupError.ts'
import { AgentServiceNotice } from './model-services/AgentServiceNotice.tsx'
import styles from './AgentProviderForm.module.scss'

interface AgentProviderConnectionFormProps {
  provider?: AgentModelProvider
  busy: boolean
  conflicted: boolean
  providerMissing: boolean
  provisionFailure?: 'refresh'
  testing: boolean
  focusRequest: number
  onResolveConflict: () => Promise<AgentModelProvider | undefined>
  onSave: (input: AgentModelProviderInput, baseline?: AgentModelProvider) => Promise<void>
  onSaveErrorChange?: (error: unknown | null) => void
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
  onResolveConflict,
  onSave,
  onSaveErrorChange,
  onTest,
}: AgentProviderConnectionFormProps) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [baseline, setBaseline] = useState<AgentModelProvider | undefined>(provider)
  const [draft, setDraft] = useState<ProviderDraft>(() => createDraft(provider))
  const [externalConflict, setExternalConflict] = useState(false)
  const [baselineRefreshed, setBaselineRefreshed] = useState(false)
  const [validation, setValidation] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<unknown>(null)
  const [confirmHttp, setConfirmHttp] = useState(false)
  const apiKeyControlId = useId()
  const nameInputRef = useRef<InputRef>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const saveErrorKey = saveError ? agentSetupErrorKey(saveError) : null

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
  useEffect(() => {
    onSaveErrorChange?.(saveError)
  }, [onSaveErrorChange, saveError])
  useEffect(() => () => onSaveErrorChange?.(null), [onSaveErrorChange])
  useEffect(() => {
    if (!validation && !saveErrorKey) return
    feedbackRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    feedbackRef.current?.focus({ preventScroll: true })
  }, [validation, saveErrorKey])
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
    setSaveError(null)
    setConfirmHttp(false)
  }, [baseline, draft, provider])

  const submit = (confirmInsecureHttp: boolean) => {
    if (busy || effectiveConflict || providerMissing || !dirty) return
    const message = validateDraft(draft, t)
    if (message) {
      setValidation(message)
      return
    }
    setValidation(null)
    setSaveError(null)
    if (isInsecureHttp(draft.baseUrl) && !confirmInsecureHttp) {
      setConfirmHttp(true)
      return
    }
    setSaving(true)
    void onSave(toInput(draft, confirmInsecureHttp), baseline)
      .catch((error: unknown) => {
        const key = agentSetupErrorKey(error)
        if (key !== 'settings.agent.error.conflict') setSaveError(error)
      })
      .finally(() => { setSaving(false); setConfirmHttp(false) })
  }

  const reset = () => {
    setBaseline(provider)
    setDraft(createDraft(provider))
    setExternalConflict(false)
    setBaselineRefreshed(false)
    setValidation(null)
    setSaveError(null)
    setConfirmHttp(false)
  }

  useSettingsEditor({
    dirty, busy: busy || saving || confirmHttp, saving, invalid: effectiveConflict || providerMissing || apiKeyTooLarge,
    save: () => submit(false), reset,
  })

  const updateDraft = (patch: Partial<ProviderDraft>) => {
    setDraft((current) => ({ ...current, ...patch }))
    setValidation(null)
  }

  const resolveConflict = async () => {
    const latest = await onResolveConflict()
    if (!latest) return
    setBaseline(latest)
    setExternalConflict(false)
    setBaselineRefreshed(true)
    setValidation(null)
    setSaveError(null)
    setConfirmHttp(false)
  }

  return (
    <>
      <div className={styles['provider-form']}>
        <div className={styles['form-notices']}>
          {provisionFailure ? (
            <AgentServiceNotice
              type="warning"
              title={t(`settings.agent.providerEditor.provisionFailure.${provisionFailure}.title`)}
              description={t(`settings.agent.providerEditor.provisionFailure.${provisionFailure}.description`)}
            />
          ) : null}
          {effectiveConflict ? (
            <AgentServiceNotice
              type="warning"
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
            <AgentServiceNotice type="info" title={t('settings.agent.conflict.draftPreserved')} />
          ) : null}
          {validation || saveErrorKey ? (
            <div ref={feedbackRef} className={styles.feedback} tabIndex={-1}>
              <AgentServiceNotice type="error" title={validation ?? t('settings.agent.operationFailed')}
                description={saveErrorKey ? t(saveErrorKey) : undefined} />
            </div>
          ) : null}
        </div>
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
                onChange={(event) => updateDraft({ name: event.target.value })}
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
                  onChange={(enabled) => updateDraft({ enabled })}
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
                onChange={(apiMode) => updateDraft({ apiMode })}
              />
            </Field>
            <Field label={t('settings.agent.providerEditor.baseUrl')}>
              <Input
                value={draft.baseUrl}
                maxLength={2048}
                disabled={busy}
                placeholder="https://api.example.com/v1"
                onChange={(event) => updateDraft({ baseUrl: event.target.value })}
              />
            </Field>
            {isInsecureHttp(draft.baseUrl) && <div className={styles['is-wide']}>
              <AgentServiceNotice type="warning"
                title={t('settings.agent.providerEditor.httpRiskTitle')}
                description={t('settings.agent.providerEditor.httpRisk')} />
            </div>}
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
                    onClick={() => updateDraft({ removeApiKey: false })}
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
                    onChange={(event) => updateDraft({ apiKey: event.target.value })}
                    onPressEnter={(event) => {
                      if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) submit(false)
                    }}
                  />
                  {baseline?.api_key_configured ? (
                    <Button
                      type="text"
                      danger
                      icon={<Unlink2 size={14} aria-hidden="true" />}
                      disabled={busy}
                      onClick={() => updateDraft({
                        apiKey: '',
                        removeApiKey: true,
                      })}
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

        {provider && <footer className={styles['provider-form-footer']}>
          <div className={styles['provider-form-test']}>
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
          </div>
        </footer>}
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
