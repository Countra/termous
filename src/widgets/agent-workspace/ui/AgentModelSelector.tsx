import { AlertTriangle, Cpu, Settings2 } from 'lucide-react'
import { Button, Select, Tooltip } from 'antd'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { customSelectStyles } from '#shared/ui'
import type {
  AgentWorkspaceModelOption,
  AgentWorkspaceModelUnavailableReason,
} from '../model/types.ts'
import styles from './AgentModelSelector.module.scss'

export function AgentModelSelector({
  models,
  selectedModelId,
  fallbackName,
  fallbackProviderName,
  disabled,
  onChange,
  onOpenSettings,
}: {
  models: AgentWorkspaceModelOption[]
  selectedModelId?: string
  fallbackName?: string
  fallbackProviderName?: string
  disabled: boolean
  onChange: (modelId: string) => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const effectiveModels = useMemo(() => {
    if (!selectedModelId || models.some(({ id }) => id === selectedModelId)) return models
    return [...models, {
      id: selectedModelId,
      name: fallbackName ?? t('agent.header.modelUnavailable'),
      provider_name: fallbackProviderName ?? t('agent.header.model'),
      remote_model_id: '',
      supports_reasoning: false,
      runnable: false,
      unavailable_reason: 'missing' as const,
    }]
  }, [fallbackName, fallbackProviderName, models, selectedModelId, t])
  const selectedModel = models.find(({ id }) => id === selectedModelId)
  const selectedPresentation = effectiveModels.find(({ id }) => id === selectedModelId)
  const unavailable = Boolean(selectedModelId && (!selectedModel || !selectedModel.runnable))
  const requiresConfiguration = !selectedModelId && !effectiveModels.some(({ runnable }) => runnable)
  const unavailableReason = selectedModel?.unavailable_reason
    ?? (selectedModelId && !selectedModel ? 'missing' : undefined)
  const options = useMemo(() => groupModelOptions(effectiveModels, t), [effectiveModels, t])

  if (effectiveModels.length === 0) {
    return (
      <Button
        type="text"
        className={styles['configure-action']}
        icon={<Settings2 size={14} aria-hidden="true" />}
        onClick={onOpenSettings}
      >
        {t('agent.header.configureProvider')}
      </Button>
    )
  }

  return (
    <div
      className={styles.picker}
      data-disabled={disabled ? 'true' : undefined}
      data-unavailable={unavailable ? 'true' : undefined}
    >
      <Select
        className={styles.select}
        value={selectedModelId}
        title={selectedPresentation ? modelPresentationTitle(selectedPresentation) : undefined}
        placeholder={t('agent.header.selectModel')}
        disabled={disabled}
        aria-label={t('agent.header.model')}
        prefix={<Cpu size={13} aria-hidden="true" />}
        variant="borderless"
        showSearch
        popupMatchSelectWidth={280}
        classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
        options={options}
        labelRender={() => selectedPresentation?.name ?? t('agent.header.selectModel')}
        optionRender={(option) => {
          if (!isModelOption(option.data)) return option.label
          const detail = [option.data.remote_model_id, option.data.unavailable_label]
            .filter(Boolean)
            .join(' · ')
          return (
            <span className={styles.option}>
              <span className={styles['option-name']}>{option.data.model_name}</span>
              {detail ? <span className={styles['option-detail']}>{detail}</span> : null}
            </span>
          )
        }}
        filterOption={(input, option) => (
          isSearchableModelOption(option)
            && option.search_text.includes(input.trim().toLocaleLowerCase())
        )}
        onChange={(modelId) => onChange(modelId)}
      />
      {unavailable || requiresConfiguration ? (
        <Tooltip title={requiresConfiguration
          ? t('agent.header.configureProvider')
          : modelUnavailableHint(unavailableReason, t)}>
          <Button
            type="text"
            className={styles.warning}
            aria-label={requiresConfiguration
              ? t('agent.header.configureProvider')
              : modelUnavailableLabel(unavailableReason, t)}
            icon={requiresConfiguration
              ? <Settings2 size={13} aria-hidden="true" />
              : <AlertTriangle size={13} aria-hidden="true" />}
            onClick={onOpenSettings}
          />
        </Tooltip>
      ) : null}
    </div>
  )
}

function groupModelOptions(
  models: AgentWorkspaceModelOption[],
  t: (key: string) => string,
) {
  const providers = new Map<string, AgentWorkspaceModelOption[]>()
  for (const model of models) {
    const items = providers.get(model.provider_name) ?? []
    items.push(model)
    providers.set(model.provider_name, items)
  }
  return Array.from(providers, ([provider, items]) => ({
    label: provider,
    title: provider,
    options: items.map((model) => {
      const unavailableLabel = model.runnable
        ? undefined
        : modelUnavailableLabel(model.unavailable_reason, t)
      return {
        value: model.id,
        disabled: !model.runnable,
        label: unavailableLabel ? `${model.name} · ${unavailableLabel}` : model.name,
        title: [model.name, model.remote_model_id, unavailableLabel].filter(Boolean).join(' · '),
        model_name: model.name,
        remote_model_id: model.remote_model_id,
        unavailable_label: unavailableLabel,
        search_text: `${model.name} ${provider} ${model.remote_model_id}`.toLocaleLowerCase(),
      }
    }),
  }))
}

function modelPresentationTitle(model: AgentWorkspaceModelOption) {
  const identity = model.remote_model_id
    ? `${model.provider_name} / ${model.remote_model_id}`
    : model.provider_name
  return `${model.name} (${identity})`
}

function isSearchableModelOption(value: unknown): value is { search_text: string } {
  return Boolean(
    value
    && typeof value === 'object'
    && 'search_text' in value
    && typeof value.search_text === 'string',
  )
}

function isModelOption(value: unknown): value is {
  model_name: string
  remote_model_id: string
  unavailable_label?: string
} {
  return Boolean(
    value
    && typeof value === 'object'
    && 'model_name' in value
    && typeof value.model_name === 'string'
    && 'remote_model_id' in value
    && typeof value.remote_model_id === 'string',
  )
}

function modelUnavailableLabel(
  reason: AgentWorkspaceModelUnavailableReason | undefined,
  t: (key: string) => string,
) {
  return reason
    ? t(`agent.header.modelUnavailableReason.${reason}`)
    : t('agent.header.modelUnavailable')
}

function modelUnavailableHint(
  reason: AgentWorkspaceModelUnavailableReason | undefined,
  t: (key: string) => string,
) {
  return reason
    ? t(`agent.header.modelUnavailableHint.${reason}`)
    : t('agent.header.modelUnavailableHint.unknown')
}
