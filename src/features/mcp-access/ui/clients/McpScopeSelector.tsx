import { useMemo } from 'react'
import { Alert, Button, Checkbox, Switch, Tooltip } from 'antd'
import {
  Activity,
  CalendarClock,
  Container,
  Cpu,
  FolderKey,
  KeyRound,
  ListChecks,
  ListX,
  RotateCcw,
  Server,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { defaultMcpScopes, type McpScope } from '#entities/mcp-access'
import { uiStyles } from '#shared/ui'
import {
  getMcpScopeCatalogEntry,
  mcpScopeCatalog,
  mcpScopeGroups,
  normalizeMcpScopes,
  type McpScopeGroupKey,
} from '../../model/mcpScopeCatalog'
import styles from '../McpClientEditor.module.scss'

interface McpScopeSelectorProps {
  scopes: McpScope[]
  approvalBypass: boolean
  disabled: boolean
  onScopesChange: (scopes: McpScope[]) => void
  onApprovalBypassChange: (enabled: boolean) => void
}

const permissionGroupIcons: Record<McpScopeGroupKey, LucideIcon> = {
  hosts: Server,
  sessions: KeyRound,
  commands: TerminalSquare,
  sftp: FolderKey,
  system: Cpu,
  processes: Activity,
  services: ServerCog,
  docker: Container,
  crontab: CalendarClock,
}

export function McpScopeSelector({
  scopes,
  approvalBypass,
  disabled,
  onScopesChange,
  onApprovalBypassChange,
}: McpScopeSelectorProps) {
  const { t } = useTranslation()
  const selected = useMemo(() => new Set(scopes), [scopes])
  const destructive = scopes.includes('sessions:close')
  const toggleScope = (scope: McpScope, checked: boolean) => {
    const next = new Set(scopes)
    if (checked) next.add(scope)
    else next.delete(scope)
    onScopesChange(normalizeMcpScopes(next))
  }
  const toggleScopeGroup = (groupScopes: readonly McpScope[], checked: boolean) => {
    const next = new Set(scopes)
    for (const scope of groupScopes) {
      if (checked) next.add(scope)
      else next.delete(scope)
    }
    onScopesChange(normalizeMcpScopes(next))
  }

  return (
    <section className={styles.section} aria-labelledby="mcp-client-permissions-title">
      <header className={styles['section-heading']}>
        <h3 id="mcp-client-permissions-title">{t('settings.mcp.permissions')}</h3>
        <div className={styles['permission-summary']}>
          <span aria-live="polite" aria-atomic="true">
            {t('settings.mcp.selectedPermissions', { count: scopes.length, total: mcpScopeCatalog.length })}
          </span>
          <Button
            type="text"
            size="small"
            icon={<RotateCcw size={13} />}
            disabled={disabled}
            onClick={() => {
              onScopesChange([...defaultMcpScopes])
              onApprovalBypassChange(false)
            }}
          >
            {t('settings.mcp.restoreReadOnly')}
          </Button>
        </div>
      </header>

      <div className={styles['permission-groups']}>
        {mcpScopeGroups.map((group) => {
          const Icon = permissionGroupIcons[group.key]
          const groupName = t(`settings.mcp.permissionGroup.${group.key}`)
          const groupTitleId = `mcp-permission-group-${group.key}-title`
          const groupHintId = `mcp-permission-group-${group.key}-hint`
          const selectedCount = group.scopes.reduce(
            (count, scope) => count + (selected.has(scope) ? 1 : 0),
            0,
          )
          const allSelected = selectedCount === group.scopes.length
          const partiallySelected = selectedCount > 0 && !allSelected
          const groupActionLabel = allSelected
            ? t('settings.mcp.clearGroupPermissions')
            : t('settings.mcp.selectGroupPermissions')
          const groupToggleLabel = t('settings.mcp.groupPermissionsToggleLabel', { group: groupName })
          const groupSelectionState = allSelected ? 'all' : partiallySelected ? 'partial' : 'none'
          const GroupActionIcon = allSelected ? ListX : ListChecks
          return (
            <fieldset
              key={group.key}
              className={styles['permission-group']}
              disabled={disabled}
              aria-labelledby={groupTitleId}
              aria-describedby={groupHintId}
            >
              <legend>
                <span className={styles['group-icon']} aria-hidden="true"><Icon size={15} /></span>
                <span className={styles['group-copy']}>
                  <strong id={groupTitleId}>{groupName}</strong>
                  <small id={groupHintId}>{t(`settings.mcp.permissionGroupHint.${group.key}`)}</small>
                </span>
                <span className={styles['group-selection']}>
                  <span className={styles['group-selection-count']} aria-hidden="true">
                    {selectedCount}<span>/</span>{group.scopes.length}
                  </span>
                  <Tooltip
                    title={groupActionLabel}
                    mouseEnterDelay={0.35}
                    destroyOnHidden
                    classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
                  >
                    <Button
                      type="text"
                      size="small"
                      disabled={disabled}
                      className={styles['group-toggle']}
                      data-selection-state={groupSelectionState}
                      aria-label={groupToggleLabel}
                      aria-pressed={partiallySelected ? 'mixed' : allSelected}
                      icon={<GroupActionIcon size={14} strokeWidth={1.9} aria-hidden="true" />}
                      onClick={() => toggleScopeGroup(group.scopes, !allSelected)}
                    />
                  </Tooltip>
                </span>
              </legend>
              <div className={styles['scope-grid']}>
                {group.scopes.map((scope) => {
                  const scopeEntry = getMcpScopeCatalogEntry(scope)
                  const scopeName = t(scopeEntry.labelKey)
                  const scopeDescription = t(scopeEntry.descriptionKey)
                  const checked = selected.has(scope)
                  const danger = scopeEntry.destructive
                  const approval = scopeEntry.requiresApproval
                  const defaultScope = scopeEntry.defaultEnabled
                  return (
                    <Checkbox
                      key={scope}
                      checked={checked}
                      disabled={disabled}
                      className={[
                        styles['scope-option'],
                        checked ? styles['is-selected'] : '',
                        danger ? styles['is-danger'] : '',
                        disabled ? styles['is-disabled'] : '',
                      ].filter(Boolean).join(' ')}
                      onChange={(event) => toggleScope(scope, event.target.checked)}
                    >
                      <span className={styles['scope-copy']}>
                        <span className={styles['scope-name']}>
                          <strong>{scopeName}</strong>
                          {danger ? <em className={styles['danger-badge']}>{t('settings.mcp.highRisk')}</em> : null}
                          {approval ? (
                            <em className={approvalBypass ? styles['danger-badge'] : undefined}>
                              {t(approvalBypass
                                ? 'settings.mcp.approvalBypassed'
                                : 'settings.mcp.approvalRequired')}
                            </em>
                          ) : null}
                          {defaultScope ? <em>{t('settings.mcp.defaultPermission')}</em> : null}
                        </span>
                        <Tooltip
                          title={(
                            <span className={styles['scope-tooltip-content']}>
                              <strong>{scopeName}</strong>
                              <span>{scopeDescription}</span>
                            </span>
                          )}
                          placement="top"
                          mouseEnterDelay={0.35}
                          destroyOnHidden
                          classNames={{
                            root: `${uiStyles.tooltip} termous-tooltip ${styles['scope-description-tooltip']}`,
                          }}
                        >
                          <small>{scopeDescription}</small>
                        </Tooltip>
                      </span>
                    </Checkbox>
                  )
                })}
              </div>
            </fieldset>
          )
        })}
      </div>

      <div className={`${styles['approval-bypass']} ${approvalBypass ? styles['is-enabled'] : ''}`}>
        <span className={styles['approval-bypass-icon']} aria-hidden="true">
          <ShieldCheck size={17} />
        </span>
        <span className={styles['approval-bypass-copy']}>
          <span className={styles['approval-bypass-title']}>
            <strong>{t('settings.mcp.approvalBypass')}</strong>
            <em>{t('settings.mcp.highRisk')}</em>
          </span>
          <small id="mcp-approval-bypass-description">
            {t('settings.mcp.approvalBypassHint')}
          </small>
        </span>
        <Switch
          checked={approvalBypass}
          disabled={disabled}
          aria-label={t('settings.mcp.approvalBypass')}
          aria-describedby="mcp-approval-bypass-description"
          onChange={onApprovalBypassChange}
        />
      </div>

      {scopes.length === 0 ? (
        <p className={styles['permission-error']} role="status">{t('settings.mcp.permissionsEmpty')}</p>
      ) : null}
      {approvalBypass ? (
        <Alert
          className={styles['danger-alert']}
          type="warning"
          showIcon
          icon={<ShieldAlert size={17} />}
          title={t('settings.mcp.approvalBypassTitle')}
          description={t('settings.mcp.approvalBypassDescription')}
        />
      ) : null}
      {destructive ? (
        <Alert
          className={styles['danger-alert']}
          type="warning"
          showIcon
          icon={<ShieldAlert size={17} />}
          title={t('settings.mcp.closeScopeTitle')}
          description={t('settings.mcp.closeScopeDescription')}
        />
      ) : null}
    </section>
  )
}
