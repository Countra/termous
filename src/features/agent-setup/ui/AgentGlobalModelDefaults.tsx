import { useEffect, useId, useLayoutEffect, useMemo, useState } from 'react'
import { Alert, Button, Select, Tooltip } from 'antd'
import { CircleHelp, Save, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  agentReasoningLevels,
  isAgentModelRunnable,
  type AgentModel,
  type AgentModelProvider,
  type AgentReasoningLevel,
  type AgentSettings,
} from '#entities/agent'
import {
  customSelectStyles,
  uiStyles,
} from '#shared/ui'
import type { AgentSetupController } from '../model/useAgentSetupController.ts'
import setupStyles from './AgentSetup.module.scss'
import styles from './AgentGlobalModelDefaults.module.scss'
import { AgentTokenLimitInput } from './AgentTokenLimitInput.tsx'

interface DefaultsDraft {
  defaultModelId: string
  defaultReasoningLevel: AgentReasoningLevel
  contextWindowTokens: number | null
  maxOutputTokens: number | null
}

interface DefaultsValidation {
  contextWindow?: string
  maxOutput?: string
}

const contextWindowPresets = [16_384, 32_768, 65_536, 131_072, 262_144]
const maxOutputPresets = [2_048, 4_096, 8_192, 16_384, 32_768]

export function AgentGlobalModelDefaults({
  runtime,
  onConflictVisibilityChange,
}: {
  runtime: AgentSetupController
  onConflictVisibilityChange: (visible: boolean) => void
}) {
  const { t } = useTranslation()
  const contextErrorId = useId()
  const outputErrorId = useId()
  const settings = runtime.readiness?.settings
  const [baselineRevision, setBaselineRevision] = useState(settings?.revision)
  const [baseline, setBaseline] = useState<DefaultsDraft>(() => createDraft(settings))
  const [draft, setDraft] = useState<DefaultsDraft>(() => createDraft(settings))
  const [externalChange, setExternalChange] = useState(false)
  const providerById = useMemo(
    () => new Map(runtime.providers.map((provider) => [provider.id, provider])),
    [runtime.providers],
  )
  const modelById = useMemo(
    () => new Map(runtime.models.map((model) => [model.id, model])),
    [runtime.models],
  )
  const options = useMemo(
    () => buildModelOptions(runtime.providers, runtime.models),
    [runtime.models, runtime.providers],
  )
  const dirty = settings ? !sameDraft(draft, baseline) : false
  const selectedModel = draft.defaultModelId ? modelById.get(draft.defaultModelId) : undefined
  const busy = runtime.loading || runtime.mutation !== null
  const validation = validateDraft(draft, t)
  const invalid = Boolean(validation.contextWindow || validation.maxOutput)
  const runtimeSettingsConflict = runtime.conflict?.kind === 'settings'
  const ownsRuntimeSettingsConflict = dirty && runtimeSettingsConflict
  const conflictVisible = externalChange || ownsRuntimeSettingsConflict

  useEffect(() => {
    if (!settings || settings.revision === baselineRevision) return
    if (dirty) {
      setExternalChange(true)
      return
    }
    const next = createDraft(settings)
    setBaselineRevision(settings.revision)
    setBaseline(next)
    setDraft(next)
    setExternalChange(false)
  }, [baselineRevision, dirty, settings])

  useLayoutEffect(() => {
    onConflictVisibilityChange(ownsRuntimeSettingsConflict)
  }, [onConflictVisibilityChange, ownsRuntimeSettingsConflict])

  if (!settings) return null

  const reloadLatest = async () => {
    const snapshot = runtimeSettingsConflict ? await runtime.resolveConflict() : null
    const latestSettings = snapshot?.readiness.settings ?? settings
    const next = createDraft(latestSettings)
    setBaselineRevision(latestSettings.revision)
    setBaseline(next)
    setExternalChange(false)
  }

  const save = () => {
    if (
      !dirty
      || invalid
      || externalChange
      || busy
      || draft.contextWindowTokens === null
      || draft.maxOutputTokens === null
    ) return
    void runtime.updateSettings({
      default_model_id: draft.defaultModelId,
      default_reasoning_level: draft.defaultReasoningLevel,
      global_context_window_tokens: draft.contextWindowTokens,
      global_max_output_tokens: draft.maxOutputTokens,
    }).then((saved) => {
      const next = createDraft(saved)
      setBaselineRevision(saved.revision)
      setBaseline(next)
      setDraft(next)
      setExternalChange(false)
    }).catch(() => undefined)
  }

  return (
    <section className={setupStyles['agent-setting-row']} aria-labelledby="agent-defaults-title">
      <span className={setupStyles['agent-setting-icon']} aria-hidden="true">
        <SlidersHorizontal size={16} />
      </span>
      <div className={setupStyles['agent-setting-copy']}>
        <strong id="agent-defaults-title">{t('settings.agent.defaults.title')}</strong>
        <span>{t('settings.agent.defaults.description')}</span>
      </div>
      <div className={styles.controls}>
        <div className={styles['primary-controls']}>
          <Field label={t('settings.agent.defaults.model')}>
            <Select
              value={draft.defaultModelId || undefined}
              placeholder={t('settings.agent.defaults.modelPlaceholder')}
              allowClear
              showSearch
              disabled={busy}
              aria-label={t('settings.agent.defaults.model')}
              className={customSelectStyles.select}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
              options={options}
              filterOption={(input, option) => isModelOption(option)
                ? option.search_text.includes(input.trim().toLocaleLowerCase())
                : false}
              optionLabelProp="label"
              labelRender={({ value, label }) => modelById.get(String(value))?.remote_model_id ?? label}
              optionRender={(option) => {
                const modelOption = option.data
                if (!isModelOption(modelOption)) return option.label
                return (
                  <Tooltip
                    placement="leftTop"
                    mouseEnterDelay={0.35}
                    mouseLeaveDelay={0.15}
                    destroyOnHidden
                    zIndex={3600}
                    classNames={{
                      root: `${uiStyles.tooltip} termous-tooltip ${styles['model-detail-tooltip']}`,
                    }}
                    title={(
                      <span className={styles['model-detail']}>
                        <strong>{modelOption.remote_model_id}</strong>
                        <span>{t('settings.agent.defaults.modelDetail', {
                          provider: modelOption.provider_name,
                          alias: modelOption.display_name,
                        })}</span>
                      </span>
                    )}
                  >
                    <span
                      className={styles['model-option']}
                      aria-label={`${modelOption.remote_model_id}. ${t('settings.agent.defaults.modelDetail', {
                        provider: modelOption.provider_name,
                        alias: modelOption.display_name,
                      })}`}
                    >
                      <strong>{modelOption.remote_model_id}</strong>
                      {modelOption.unavailable ? <em>{t('settings.agent.catalog.unavailable')}</em> : null}
                    </span>
                  </Tooltip>
                )
              }}
              onChange={(value) => setDraft((current) => ({ ...current, defaultModelId: value ?? '' }))}
            />
          </Field>
          <Field label={t('settings.agent.defaults.reasoning')}>
            <Select
              value={draft.defaultReasoningLevel}
              disabled={busy}
              aria-label={t('settings.agent.defaults.reasoning')}
              className={customSelectStyles.select}
              classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
              options={agentReasoningLevels.map((value) => ({
                value,
                label: t(`settings.agent.reasoning.${value}`),
              }))}
              onChange={(defaultReasoningLevel) => setDraft((current) => ({
                ...current,
                defaultReasoningLevel,
              }))}
            />
          </Field>
        </div>
        <div className={styles['parameter-controls']}>
          <Field
            label={t('settings.agent.defaults.contextBudget')}
            help={t('settings.agent.defaults.contextHelp')}
            error={validation.contextWindow}
            errorId={contextErrorId}
          >
            <AgentTokenLimitInput
              value={draft.contextWindowTokens}
              min={1024}
              max={2_000_000}
              step={1024}
              presets={contextWindowPresets}
              presetMin={draft.maxOutputTokens ?? 1024}
              disabled={busy}
              status={validation.contextWindow ? 'error' : undefined}
              errorId={contextErrorId}
              label={t('settings.agent.defaults.contextBudget')}
              quickSelectLabel={t('settings.agent.defaults.contextQuickSelect')}
              onChange={(contextWindowTokens) => setDraft((current) => ({
                ...current,
                contextWindowTokens,
              }))}
            />
          </Field>
          <Field
            label={t('settings.agent.defaults.maxOutput')}
            help={t('settings.agent.defaults.outputHelp')}
            error={validation.maxOutput}
            errorId={outputErrorId}
          >
            <AgentTokenLimitInput
              value={draft.maxOutputTokens}
              min={1}
              max={draft.contextWindowTokens ?? 2_000_000}
              step={256}
              presets={maxOutputPresets}
              disabled={busy}
              status={validation.maxOutput ? 'error' : undefined}
              errorId={outputErrorId}
              label={t('settings.agent.defaults.maxOutput')}
              quickSelectLabel={t('settings.agent.defaults.outputQuickSelect')}
              onChange={(maxOutputTokens) => setDraft((current) => ({
                ...current,
                maxOutputTokens,
              }))}
            />
          </Field>
          <Button
            className={styles.save}
            type="primary"
            icon={<Save size={14} />}
            aria-label={t('settings.agent.defaults.save')}
            loading={runtime.mutation === 'settings'}
            disabled={busy || !dirty || invalid || externalChange}
            onClick={save}
          >
            {t('app.save')}
          </Button>
        </div>
      </div>
      {conflictVisible ? (
        <Alert
          className={setupStyles['agent-setting-alert']}
          type="warning"
          showIcon
          title={t('settings.agent.conflict.title')}
          description={t('settings.agent.conflict.defaultsDescription')}
          action={(
            <Button size="small" loading={runtime.loading} onClick={() => void reloadLatest()}>
              {t('settings.agent.conflict.refresh')}
            </Button>
          )}
        />
      ) : null}
      {selectedModel && !isAgentModelRunnable(selectedModel, providerById.get(selectedModel.provider_id)) ? (
        <Alert
          className={setupStyles['agent-setting-alert']}
          type="warning"
          showIcon
          title={t('settings.agent.defaults.unavailableTitle')}
          description={t('settings.agent.defaults.unavailableDescription')}
        />
      ) : null}
    </section>
  )
}

function Field({ label, help, error, errorId, children }: {
  label: string
  help?: string
  error?: string
  errorId?: string
  children: React.ReactNode
}) {
  return (
    <div className={styles.field} data-agent-default-field>
      <span className={styles['field-label']}>
        <span>{label}</span>
        {help ? (
          <Tooltip
            title={help}
            mouseEnterDelay={0.25}
            classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
          >
            <button
              type="button"
              className={styles['field-help']}
              aria-label={`${label}: ${help}`}
            >
              <CircleHelp size={11} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </span>
      {children}
      {error ? (
        <span id={errorId} className={styles['field-error']} role="alert">{error}</span>
      ) : null}
    </div>
  )
}

function createDraft(settings?: AgentSettings | null): DefaultsDraft {
  return {
    defaultModelId: settings?.default_model_id ?? '',
    defaultReasoningLevel: settings?.default_reasoning_level ?? 'off',
    contextWindowTokens: settings?.global_context_window_tokens ?? 16_384,
    maxOutputTokens: settings?.global_max_output_tokens ?? 4_096,
  }
}

function sameDraft(left: DefaultsDraft, right: DefaultsDraft) {
  return left.defaultModelId === right.defaultModelId
    && left.defaultReasoningLevel === right.defaultReasoningLevel
    && left.contextWindowTokens === right.contextWindowTokens
    && left.maxOutputTokens === right.maxOutputTokens
}

function validateDraft(draft: DefaultsDraft, t: (key: string) => string): DefaultsValidation {
  const validation: DefaultsValidation = {}
  if (!Number.isInteger(draft.contextWindowTokens) || !Number.isInteger(draft.maxOutputTokens)) {
    if (!Number.isInteger(draft.contextWindowTokens)) {
      validation.contextWindow = t('settings.agent.validation.integerTokens')
    }
    if (!Number.isInteger(draft.maxOutputTokens)) {
      validation.maxOutput = t('settings.agent.validation.integerTokens')
    }
  }
  if (
    draft.contextWindowTokens !== null
    && (draft.contextWindowTokens < 1024 || draft.contextWindowTokens > 2_000_000)
  ) {
    validation.contextWindow = t('settings.agent.validation.contextWindow')
  }
  if (
    draft.maxOutputTokens !== null
    && (
      draft.maxOutputTokens < 1
      || (draft.contextWindowTokens !== null && draft.maxOutputTokens > draft.contextWindowTokens)
    )
  ) {
    validation.maxOutput = t('settings.agent.validation.tokenLimit')
  }
  return validation
}

function buildModelOptions(providers: AgentModelProvider[], models: AgentModel[]) {
  const modelsByProvider = new Map<string, AgentModel[]>()
  for (const model of models) {
    if (model.removed_at) continue
    const items = modelsByProvider.get(model.provider_id) ?? []
    items.push(model)
    modelsByProvider.set(model.provider_id, items)
  }
  return providers.map((provider) => ({
    label: provider.name,
    title: provider.name,
    options: (modelsByProvider.get(provider.id) ?? []).map((model): AgentModelSelectOption => ({
      value: model.id,
      disabled: !isAgentModelRunnable(model, provider),
      label: model.remote_model_id,
      display_name: model.display_name,
      provider_name: provider.name,
      remote_model_id: model.remote_model_id,
      search_text: `${model.display_name} ${provider.name} ${model.remote_model_id}`.toLocaleLowerCase(),
      unavailable: !isAgentModelRunnable(model, provider),
    })),
  })).filter(({ options }) => options.length > 0)
}

interface AgentModelSelectOption {
  value: string
  label: string
  disabled: boolean
  display_name: string
  provider_name: string
  remote_model_id: string
  search_text: string
  unavailable: boolean
}

function isModelOption(value: unknown): value is AgentModelSelectOption {
  return Boolean(value && typeof value === 'object' && 'value' in value && 'remote_model_id' in value)
}
