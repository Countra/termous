import { Check, Pencil, RotateCcw, Trash2, Wrench } from 'lucide-react'
import { Button, Popconfirm, Switch, Tooltip } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ShellAlias } from '#entities/alias'
import {
  shellAliasTone,
  type AliasMutationKind,
} from '../model/aliasWorkspaceState'

interface AliasRowProps {
  id: string
  alias: ShellAlias
  mutation: AliasMutationKind | null
  panelBusy: boolean
  deleteConfirmOpen: boolean
  onDeleteConfirmOpenChange: (open: boolean) => void
  onEdit: () => void
  onToggle: (checked: boolean) => void
  onDelete: () => Promise<void>
}

export function AliasRow({
  id,
  alias,
  mutation,
  panelBusy,
  deleteConfirmOpen,
  onDeleteConfirmOpenChange,
  onEdit,
  onToggle,
  onDelete,
}: AliasRowProps) {
  const { t } = useTranslation()
  const tone = shellAliasTone(alias)
  const togglePending = mutation === 'update'
  const deletePending = mutation === 'delete'
  const deleteDisabled = panelBusy && !deletePending
  const detail = (
    <div className="alias-row-tooltip-content">
      <strong>{alias.name}</strong>
      <code>{alias.command}</code>
      {alias.description ? <span>{alias.description}</span> : null}
    </div>
  )
  return (
    <article
      className={`alias-row is-${tone} ${alias.enabled ? '' : 'is-disabled'}`}
      role="listitem"
      aria-busy={mutation ? true : undefined}
    >
      <Tooltip
        title={panelBusy ? null : detail}
        mouseEnterDelay={0.45}
        classNames={{ root: 'termous-tooltip alias-detail-tooltip' }}
      >
        <button
          id={id}
          type="button"
          className="alias-row-main"
          disabled={panelBusy}
          aria-label={t('workbench.aliases.editAlias', { name: alias.name })}
          onClick={onEdit}
        >
          <div className="alias-row-title">
            <strong>{alias.name}</strong>
            <span className={`alias-runtime-state is-${tone}`}>
              {t(alias.enabled ? 'workbench.aliases.enabledStatus' : 'workbench.aliases.disabledStatus')}
            </span>
          </div>
          <code>{alias.command}</code>
          {alias.description ? (
            <span className="alias-row-description">{alias.description}</span>
          ) : null}
        </button>
      </Tooltip>
      <div className="alias-row-actions">
        <Tooltip
          title={t(alias.enabled ? 'workbench.aliases.disable' : 'workbench.aliases.enable')}
          classNames={{ root: 'termous-tooltip' }}
        >
          <Switch
            id={`${id}-toggle`}
            size="small"
            checked={alias.enabled}
            loading={togglePending}
            disabled={panelBusy}
            aria-label={t(
              alias.enabled
                ? 'workbench.aliases.disableAlias'
                : 'workbench.aliases.enableAlias',
              { name: alias.name },
            )}
            onChange={onToggle}
          />
        </Tooltip>
        <Tooltip title={t('app.edit')} classNames={{ root: 'termous-tooltip' }}>
          <Button
            type="text"
            className="alias-row-action"
            aria-label={t('workbench.aliases.editAlias', { name: alias.name })}
            disabled={panelBusy}
            icon={<Pencil size={14} />}
            onClick={onEdit}
          />
        </Tooltip>
        <Popconfirm
          open={deleteConfirmOpen}
          title={t('workbench.aliases.deleteTitle')}
          description={t('workbench.aliases.deleteHint', { name: alias.name })}
          okText={t('app.delete')}
          cancelText={t('app.cancel')}
          okButtonProps={{ danger: true, loading: deletePending }}
          rootClassName="alias-delete-popconfirm"
          disabled={deleteDisabled}
          onOpenChange={onDeleteConfirmOpenChange}
          onConfirm={onDelete}
        >
          <Tooltip title={t('app.delete')} classNames={{ root: 'termous-tooltip' }}>
            <Button
              type="text"
              danger
              className="alias-row-action"
              aria-label={t('workbench.aliases.deleteAlias', { name: alias.name })}
              disabled={deleteDisabled}
              loading={deletePending}
              icon={<Trash2 size={14} />}
            />
          </Tooltip>
        </Popconfirm>
      </div>
    </article>
  )
}

interface AliasBridgeRepairBarProps {
  visible: boolean
  repairing: boolean
  disabled: boolean
  onRepair: () => void
}

export function AliasBridgeRepairBar({
  visible,
  repairing,
  disabled,
  onRepair,
}: AliasBridgeRepairBarProps) {
  const { t } = useTranslation()
  if (!visible) {
    return null
  }
  return (
    <div className="alias-bridge-repair" role="status">
      <Wrench size={14} aria-hidden="true" />
      <div>
        <strong>{t('workbench.aliases.bridgeRepairTitle')}</strong>
        <span>{t('workbench.aliases.bridgeRepairHint')}</span>
      </div>
      <Button
        size="small"
        loading={repairing}
        disabled={disabled}
        onClick={onRepair}
      >
        {t('workbench.aliases.bridgeRepairAction')}
      </Button>
    </div>
  )
}

interface AliasReconnectBarProps {
  visible: boolean
  reconnecting: boolean
  reconnectDisabled: boolean
  onReconnect: () => void
}

export function AliasReconnectBar({
  visible,
  reconnecting,
  reconnectDisabled,
  onReconnect,
}: AliasReconnectBarProps) {
  const { t } = useTranslation()
  if (!visible) {
    return null
  }
  return (
    <footer className="alias-reconnect-bar">
      <span className="alias-reconnect-icon">
        <Check size={14} aria-hidden="true" />
      </span>
      <div>
        <strong>{t('workbench.aliases.savedReconnectTitle')}</strong>
        <span>{t('workbench.aliases.savedReconnectHint')}</span>
      </div>
      <Button
        size="small"
        type="primary"
        loading={reconnecting}
        disabled={reconnectDisabled}
        icon={<RotateCcw size={13} />}
        onClick={onReconnect}
      >
        {t('workbench.aliases.reconnect')}
      </Button>
    </footer>
  )
}
