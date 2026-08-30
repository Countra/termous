import { AlertTriangle, Cpu, Image, Settings2 } from 'lucide-react'
import { Button, Tooltip } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AssociationSelect,
  type AssociationSelectItem,
  uiStyles,
} from '#shared/ui'
import type {
  AgentWorkspaceModelOption,
  AgentWorkspaceModelUnavailableReason,
} from '../model/types.ts'
import styles from './AgentModelSelector.module.scss'

interface AgentModelSelectItem extends AssociationSelectItem {
  model: AgentWorkspaceModelOption
}

function groupAgentModelByProvider(item: AgentModelSelectItem) {
  return { key: item.model.provider_id, label: item.model.provider_name }
}

export function AgentModelSelector({
  models,
  selectedModelId,
  fallbackName,
  fallbackDisplayName,
  fallbackProviderName,
  disabled,
  onChange,
  onOpenSettings,
}: {
  models: AgentWorkspaceModelOption[]
  selectedModelId?: string
  fallbackName?: string
  fallbackDisplayName?: string
  fallbackProviderName?: string
  disabled: boolean
  onChange: (modelId: string) => void
  onOpenSettings: () => void
}) {
  const { t } = useTranslation()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const visibleModels = useMemo(
    () => models.filter((model) => (
      model.unavailable_reason !== 'removed' || model.id === selectedModelId
    )),
    [models, selectedModelId],
  )
  const effectiveModels = useMemo(() => {
    if (!selectedModelId || visibleModels.some(({ id }) => id === selectedModelId)) return visibleModels
    return [...visibleModels, missingModel(
      selectedModelId,
      fallbackName,
      fallbackDisplayName,
      fallbackProviderName,
      t,
    )]
  }, [fallbackDisplayName, fallbackName, fallbackProviderName, selectedModelId, t, visibleModels])
  const selectedModel = models.find(({ id }) => id === selectedModelId)
  const unavailable = Boolean(selectedModelId && (!selectedModel || !selectedModel.runnable))
  const requiresConfiguration = !selectedModelId && !effectiveModels.some(({ runnable }) => runnable)
  const unavailableReason = selectedModel?.unavailable_reason
    ?? (selectedModelId && !selectedModel ? 'missing' : undefined)
  const selectedPresentation = effectiveModels.find(({ id }) => id === selectedModelId)
  const items = useMemo<AgentModelSelectItem[]>(() => effectiveModels.map((model) => ({
    value: model.id,
    label: model.remote_model_id || model.display_name,
    searchText: `${model.remote_model_id} ${model.display_name} ${model.provider_name}`,
    disabled: !model.runnable,
    ariaLabel: model.runnable
      ? model.remote_model_id
      : `${model.remote_model_id} · ${modelUnavailableLabel(model.unavailable_reason, t)}`,
    model,
  })), [effectiveModels, t])

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
      <Tooltip
        title={selectedPresentation ? <ModelDetails model={selectedPresentation} /> : null}
        placement="topRight"
        trigger={['hover', 'focus']}
        open={detailsOpen && !catalogOpen}
        destroyOnHidden
        mouseEnterDelay={0.25}
        mouseLeaveDelay={0.15}
        classNames={{
          root: `${uiStyles.tooltip} termous-tooltip ${styles['detail-tooltip']}`,
        }}
        onOpenChange={setDetailsOpen}
      >
        <div
          className={styles['selection-detail-trigger']}
          data-detail-open={detailsOpen && !catalogOpen ? 'true' : 'false'}
        >
          <AssociationSelect
            label={t('agent.header.model')}
            value={selectedModelId ?? ''}
            items={items}
            disabled={disabled}
            className={styles.select}
            popupClassName={styles.popup}
            detailClassName={styles['detail-tooltip']}
            detailPlacement="topRight"
            virtual
            groupBy={groupAgentModelByProvider}
            renderSelection={(item) => (
              <span className={styles.selection}>
                <Cpu size={13} aria-hidden="true" />
                <span>{item?.model.remote_model_id || t('agent.header.selectModel')}</span>
              </span>
            )}
            renderOption={(item) => (
              <span className={styles.option}>
                <span className={styles['option-name']}>{item.model.remote_model_id}</span>
                {!item.model.runnable ? <AlertTriangle size={12} aria-hidden="true" /> : null}
              </span>
            )}
            renderDetails={(item) => <ModelDetails model={item.model} />}
            onOpenChange={(open) => {
              setCatalogOpen(open)
              if (open) setDetailsOpen(false)
            }}
            onChange={(modelId) => onChange(modelId)}
          />
        </div>
      </Tooltip>
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
      <DetailRow
        label={t('agent.composer.reasoningLevels')}
        value={reasoning}
      />
      <div className={styles.capabilities}>
        <span data-enabled={model.supports_images ? 'true' : undefined}>
          <Image size={12} aria-hidden="true" />
          {t(model.supports_images ? 'agent.composer.imagesSupported' : 'agent.composer.imagesUnsupported')}
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

function modelUnavailableHint(
  reason: AgentWorkspaceModelUnavailableReason | undefined,
  t: (key: string) => string,
) {
  return reason
    ? t(`agent.header.modelUnavailableHint.${reason}`)
    : t('agent.header.modelUnavailableHint.unknown')
}
