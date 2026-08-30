import type { MenuProps } from 'antd'
import { Button, Dropdown, Tag, Tooltip } from 'antd'
import {
  FlaskConical,
  CircleCheck,
  MoreHorizontal,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isAgentModelRunnable, type AgentModel, type AgentModelProvider } from '#entities/agent'
import { contextActionMenuPopupClassName, uiStyles } from '#shared/ui'
import styles from './AgentModelCatalog.module.scss'

interface AgentModelCatalogRowProps {
  provider: AgentModelProvider
  model: AgentModel
  defaultModelId?: string
  disabled: boolean
  onEdit: (model: AgentModel) => void
  onTest: (model: AgentModel) => void
  onSetDefault: (model: AgentModel) => void
  onRemove: (model: AgentModel) => void
  onRestore: (model: AgentModel) => void
}

export function AgentModelCatalogRow({
  provider,
  model,
  defaultModelId,
  disabled,
  onEdit,
  onTest,
  onSetDefault,
  onRemove,
  onRestore,
}: AgentModelCatalogRowProps) {
  const { t } = useTranslation()
  const removed = Boolean(model.removed_at)
  const available = isAgentModelRunnable(model, provider)
  const isDefault = defaultModelId === model.id
  const menuItems: MenuProps['items'] = removed ? [
    { key: 'restore', icon: <RotateCcw size={14} />, label: t('settings.agent.catalog.restore') },
  ] : [
    {
      key: 'default',
      icon: <CircleCheck size={14} />,
      label: t('settings.agent.catalog.setDefault'),
      disabled: !available || isDefault,
    },
    {
      key: 'test',
      icon: <FlaskConical size={14} />,
      label: t('settings.agent.models.test'),
      disabled: !available,
    },
    { key: 'edit', icon: <SlidersHorizontal size={14} />, label: t('settings.agent.catalog.edit') },
    { type: 'divider' },
    {
      key: 'remove',
      icon: <Trash2 size={14} />,
      label: t('settings.agent.catalog.remove'),
      danger: true,
      disabled: isDefault,
    },
  ]

  const executeAction: MenuProps['onClick'] = ({ key }) => {
    if (key === 'default') onSetDefault(model)
    if (key === 'test') onTest(model)
    if (key === 'edit') onEdit(model)
    if (key === 'remove') onRemove(model)
    if (key === 'restore') onRestore(model)
  }

  return (
    <article className={`${styles['catalog-row']} ${removed ? styles['is-removed'] : ''}`}>
      <Tooltip
        placement="left"
        mouseEnterDelay={0.35}
        rootClassName={`${uiStyles.tooltip} ${styles['catalog-detail-tooltip']}`}
        title={<ModelDetails provider={provider} model={model} />}
      >
        <div className={styles['catalog-model-copy']} tabIndex={0}>
          <strong>{model.remote_model_id}</strong>
          <span className={styles['catalog-model-status']}>
            {isDefault ? <Tag color="processing">{t('settings.agent.models.default')}</Tag> : null}
            {model.source === 'manual' ? <Tag>{t('settings.agent.catalog.manual')}</Tag> : null}
            {model.availability === 'missing' ? <Tag>{t('settings.agent.catalog.missing')}</Tag> : null}
            {removed ? <Tag>{t('settings.agent.catalog.removed')}</Tag> : null}
          </span>
        </div>
      </Tooltip>
      <div className={styles['catalog-actions']}>
        <Dropdown
          trigger={['click']}
          disabled={disabled}
          classNames={{ root: contextActionMenuPopupClassName }}
          menu={{ items: menuItems, onClick: executeAction }}
        >
          <Button
            type="text"
            icon={<MoreHorizontal size={16} />}
            aria-label={t('settings.agent.catalog.moreActions', { model: model.remote_model_id })}
            disabled={disabled}
          />
        </Dropdown>
      </div>
    </article>
  )
}

function ModelDetails({ provider, model }: { provider: AgentModelProvider; model: AgentModel }) {
  const { t } = useTranslation()
  const reasoning = model.reasoning_control === 'none'
    ? t('settings.agent.reasoning.off')
    : model.supported_reasoning_levels
      .map((level) => t(`settings.agent.reasoning.${level}`))
      .join(' / ')
  const catalogStatus = model.source === 'manual'
    ? t('settings.agent.catalog.detail.manualUnmanaged')
    : model.removed_at
      ? t('settings.agent.catalog.removed')
      : model.availability === 'missing'
        ? t('settings.agent.catalog.missing')
        : t('settings.agent.catalog.detail.synced')
  return (
    <div className={styles['catalog-detail']}>
      <strong>{model.remote_model_id}</strong>
      <dl>
        <dt>{t('settings.agent.catalog.detail.provider')}</dt><dd>{provider.name}</dd>
        <dt>{t('settings.agent.catalog.detail.alias')}</dt><dd>{model.display_name}</dd>
        <dt>{t('settings.agent.catalog.detail.source')}</dt><dd>{t(`settings.agent.catalog.filterSource.${model.source}`)}</dd>
        <dt>{t('settings.agent.catalog.detail.catalogStatus')}</dt><dd>{catalogStatus}</dd>
        {model.source === 'sync' ? (
          <><dt>{t('settings.agent.catalog.detail.lastSeen')}</dt><dd>{formatDateTime(model.last_seen_at)}</dd></>
        ) : null}
        <dt>{t('settings.agent.catalog.detail.context')}</dt><dd>{formatTokens(model.effective_context_window_tokens)}</dd>
        <dt>{t('settings.agent.catalog.detail.output')}</dt><dd>{formatTokens(model.effective_max_output_tokens)}</dd>
        <dt>{t('settings.agent.catalog.detail.reasoning')}</dt><dd>{reasoning}</dd>
        <dt>{t('settings.agent.catalog.detail.images')}</dt><dd>{t(model.supports_images ? 'app.yes' : 'app.no')}</dd>
      </dl>
    </div>
  )
}

function formatTokens(value: number) {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
    .format(new Date(value))
}
