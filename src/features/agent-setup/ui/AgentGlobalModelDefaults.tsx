import { useId, useMemo } from 'react'
import { Alert, InputNumber, Select, Tooltip } from 'antd'
import { CircleHelp, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { agentReasoningLevels, isAgentModelRunnable, type AgentModel, type AgentModelProvider } from '#entities/agent'
import { customSelectStyles, uiStyles } from '#shared/ui'
import type { AgentConfigurationDraft } from '../model/agentConfigurationDraft'
import styles from './AgentGlobalModelDefaults.module.scss'
import { AgentTokenLimitInput } from './AgentTokenLimitInput'

const contextWindowPresets = [16_384, 32_768, 65_536, 131_072, 262_144]
const maxOutputPresets = [2_048, 4_096, 8_192, 16_384, 32_768]

export function AgentGlobalModelDefaults({ draft, errors, providers, models, busy, onChange }: {
  draft: AgentConfigurationDraft
  errors: Partial<Record<keyof AgentConfigurationDraft, string>>
  providers: AgentModelProvider[]
  models: AgentModel[]
  busy: boolean
  onChange(patch: Partial<AgentConfigurationDraft>): void
}) {
  const { t } = useTranslation()
  const contextErrorId = useId()
  const outputErrorId = useId()
  const compactionErrorId = useId()
  const providerById = useMemo(() => new Map(providers.map(provider => [provider.id, provider])), [providers])
  const modelById = useMemo(() => new Map(models.map(model => [model.id, model])), [models])
  const options = useMemo(() => buildModelOptions(providers, models), [providers, models])
  const selectedModel = modelById.get(draft.defaultModelId)
  const validation = { contextWindow: errors.contextWindowTokens, maxOutput: errors.maxOutputTokens, compactionThreshold: errors.compactionThreshold }
  return (
    <section className={styles.defaults} aria-labelledby="agent-defaults-title">
      <header className={styles.heading}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        <div>
        <h3 id="agent-defaults-title">{t('settings.agent.defaults.title')}</h3>
        <p>{t('settings.agent.defaults.description')}</p>
        </div>
      </header>
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
              onChange={(value) => onChange({ defaultModelId: value ?? '' })}
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
              onChange={(defaultReasoningLevel) => onChange({ defaultReasoningLevel })}
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
              onChange={(contextWindowTokens) => onChange({ contextWindowTokens })}
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
              onChange={(maxOutputTokens) => onChange({ maxOutputTokens })}
            />
          </Field>
        </div>
        <div className={styles['compaction-controls']}>
          <Field
            label={t('settings.agent.compaction.threshold')}
            help={t('settings.agent.compaction.description')}
            error={validation.compactionThreshold}
            errorId={compactionErrorId}
          >
            <InputNumber<number>
              value={draft.compactionThreshold}
              aria-valuemin={50}
              aria-valuemax={95}
              step={5}
              suffix="%"
              disabled={busy}
              status={validation.compactionThreshold ? 'error' : undefined}
              aria-label={t('settings.agent.compaction.threshold')}
              aria-invalid={Boolean(validation.compactionThreshold)}
              aria-describedby={validation.compactionThreshold ? compactionErrorId : undefined}
              onChange={(compactionThreshold) => onChange({ compactionThreshold })}
            />
          </Field>
          <p className={styles['compaction-hint']}>{t('settings.agent.compaction.hint')}</p>
        </div>
      </div>
      {selectedModel && !isAgentModelRunnable(selectedModel, providerById.get(selectedModel.provider_id)) &&
        <Alert className={styles.alert} type="warning" showIcon title={t('settings.agent.defaults.unavailableTitle')}
          description={t('settings.agent.defaults.unavailableDescription')} />}
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
