import { AlertTriangle, Check, ChevronLeft, Image, Search } from 'lucide-react'
import { Input, Tooltip } from 'antd'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { uiStyles } from '#shared/ui'
import type {
  AgentWorkspaceModelOption,
  AgentWorkspaceModelUnavailableReason,
} from '../model/types.ts'
import styles from './AgentResponseOptionsMenu.module.scss'
import {
  AgentVirtualModelList,
  type AgentModelGroup,
} from './AgentVirtualModelList.tsx'

export function AgentModelPickerPane({
  models,
  selectedModelId,
  fallbackName,
  fallbackDisplayName,
  fallbackProviderName,
  onBack,
  onChange,
}: {
  models: AgentWorkspaceModelOption[]
  selectedModelId?: string
  fallbackName?: string
  fallbackDisplayName?: string
  fallbackProviderName?: string
  onBack: () => void
  onChange: (modelId: string) => void
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [detailsModelId, setDetailsModelId] = useState<string>()
  const activeDetailsModelIdRef = useRef<string | undefined>(undefined)
  const effectiveModels = useMemo(() => {
    const visible = models.filter((model) => (
      model.unavailable_reason !== 'removed' || model.id === selectedModelId
    ))
    if (!selectedModelId || visible.some((model) => model.id === selectedModelId)) return visible
    return [...visible, missingModel(
      selectedModelId,
      fallbackName,
      fallbackDisplayName,
      fallbackProviderName,
      t,
    )]
  }, [fallbackDisplayName, fallbackName, fallbackProviderName, models, selectedModelId, t])
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const filteredModels = useMemo(() => {
    if (!normalizedQuery) return effectiveModels
    const tokens = normalizedQuery.split(/\s+/)
    return effectiveModels.filter((model) => {
      const searchable = `${model.remote_model_id} ${model.display_name} ${model.provider_name}`
        .toLocaleLowerCase()
      return tokens.every((token) => searchable.includes(token))
    })
  }, [effectiveModels, normalizedQuery])
  const groups = useMemo(() => groupModels(filteredModels), [filteredModels])
  const showSearch = effectiveModels.length > 8

  return (
    <div className={styles['model-pane']} role="menu" aria-label={t('agent.header.model')}>
      <button
        type="button"
        className={styles['pane-back']}
        onClick={onBack}
      >
        <ChevronLeft size={13} aria-hidden="true" />
        <span>{t('agent.header.model')}</span>
      </button>
      {showSearch ? (
        <Input
          allowClear
          value={query}
          className={styles.search}
          prefix={<Search size={13} aria-hidden="true" />}
          placeholder={t('agent.composer.modelSearch')}
          aria-label={t('agent.composer.modelSearch')}
          data-pane-focus
          onChange={(event) => {
            setQuery(event.target.value)
            activeDetailsModelIdRef.current = undefined
            setDetailsModelId(undefined)
          }}
        />
      ) : null}
      {groups.length > 0 ? (
        <AgentVirtualModelList
          groups={groups}
          selectedModelId={selectedModelId}
          resetToStart={Boolean(normalizedQuery)}
          onScroll={() => {
            activeDetailsModelIdRef.current = undefined
            setDetailsModelId(undefined)
          }}
          renderModel={(model, position, total) => (
            <Tooltip
              title={<ModelDetails model={model} />}
              placement="leftTop"
              trigger={['hover', 'focus']}
              open={detailsModelId === model.id}
              destroyOnHidden
              mouseEnterDelay={0.25}
              mouseLeaveDelay={0.16}
              classNames={{
                root: `${uiStyles.tooltip} termous-tooltip ${styles['detail-tooltip']}`,
              }}
              onOpenChange={(nextOpen) => {
                setDetailsModelId((current) => (
                  nextOpen
                    ? activeDetailsModelIdRef.current === model.id ? model.id : current
                    : current === model.id ? undefined : current
                ))
              }}
            >
              <span
                className={styles['model-option-trigger']}
                onMouseEnter={() => { activeDetailsModelIdRef.current = model.id }}
                onMouseLeave={() => {
                  if (activeDetailsModelIdRef.current === model.id) {
                    activeDetailsModelIdRef.current = undefined
                  }
                }}
              >
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={model.id === selectedModelId}
                  aria-disabled={!model.runnable}
                  aria-posinset={position}
                  aria-setsize={total}
                  aria-label={model.runnable
                    ? model.remote_model_id
                    : `${model.remote_model_id} · ${modelUnavailableLabel(model.unavailable_reason, t)}`}
                  className={styles['option-row']}
                  data-pane-focus={!showSearch ? 'true' : undefined}
                  onFocus={() => { activeDetailsModelIdRef.current = model.id }}
                  onBlur={() => {
                    if (activeDetailsModelIdRef.current === model.id) {
                      activeDetailsModelIdRef.current = undefined
                    }
                  }}
                  onClick={() => {
                    if (model.runnable) onChange(model.id)
                  }}
                >
                  <span className={styles['model-name']}>{model.remote_model_id}</span>
                  {!model.runnable ? <AlertTriangle size={13} aria-hidden="true" /> : null}
                  {model.id === selectedModelId ? <Check size={14} aria-hidden="true" /> : null}
                </button>
              </span>
            </Tooltip>
          )}
        />
      ) : (
        <div className={styles['model-empty']}>{t('agent.composer.noMatchingModels')}</div>
      )}
    </div>
  )
}

function groupModels(models: AgentWorkspaceModelOption[]) {
  const groups = new Map<string, AgentModelGroup>()
  for (const model of models) {
    const current = groups.get(model.provider_id)
    if (current) {
      current.models.push(model)
    } else {
      groups.set(model.provider_id, {
        key: model.provider_id,
        label: model.provider_name,
        models: [model],
      })
    }
  }
  return [...groups.values()]
}

function ModelDetails({ model }: { model: AgentWorkspaceModelOption }) {
  const { t } = useTranslation()
  const reasoning = model.supported_reasoning_levels
    .map((level) => t(`settings.agent.reasoning.${level}`))
    .join(' / ')
  return (
    <div className={styles.details} role="group" aria-label={t('agent.composer.modelDetails')}>
      <strong>{model.remote_model_id}</strong>
      <span>{model.provider_name}</span>
      {model.display_name && model.display_name !== model.remote_model_id ? (
        <DetailRow label={t('agent.composer.modelAlias')} value={model.display_name} />
      ) : null}
      {model.effective_context_window_tokens > 0 ? (
        <DetailRow
          label={t('agent.composer.contextBudget')}
          value={model.effective_context_window_tokens.toLocaleString()}
        />
      ) : null}
      {model.effective_max_output_tokens > 0 ? (
        <DetailRow
          label={t('agent.composer.maxOutput')}
          value={model.effective_max_output_tokens.toLocaleString()}
        />
      ) : null}
      <DetailRow label={t('agent.composer.reasoningLevels')} value={reasoning} />
      <div className={styles.capabilities}>
        <span data-enabled={model.supports_images ? 'true' : undefined}>
          <Image size={12} aria-hidden="true" />
          {t(model.supports_images
            ? 'agent.composer.imagesSupported'
            : 'agent.composer.imagesUnsupported')}
        </span>
        <span>{t(`agent.composer.modelSource.${model.source}`)}</span>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className={styles['detail-row']}><span>{label}</span><strong>{value}</strong></div>
}

function missingModel(
  id: string,
  fallbackRemoteModelID: string | undefined,
  fallbackDisplayName: string | undefined,
  fallbackProviderName: string | undefined,
  t: (key: string) => string,
): AgentWorkspaceModelOption {
  return {
    id,
    display_name: fallbackDisplayName ?? fallbackRemoteModelID ?? t('agent.header.modelUnavailable'),
    provider_id: `missing:${id}`,
    provider_name: fallbackProviderName ?? t('agent.header.model'),
    remote_model_id: fallbackRemoteModelID ?? id,
    source: 'sync',
    supports_images: false,
    reasoning_control: 'none',
    supported_reasoning_levels: ['off'],
    effective_default_reasoning_level: 'off',
    effective_context_window_tokens: 0,
    effective_max_output_tokens: 0,
    runnable: false,
    unavailable_reason: 'missing',
  }
}

function modelUnavailableLabel(
  reason: AgentWorkspaceModelUnavailableReason | undefined,
  t: (key: string) => string,
) {
  return reason
    ? t(`agent.header.modelUnavailableReason.${reason}`)
    : t('agent.header.modelUnavailable')
}
