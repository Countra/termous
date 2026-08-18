import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Switch, Tooltip } from 'antd'
import {
  Activity,
  CalendarClock,
  Container,
  Cpu,
  FolderKey,
  KeyRound,
  RotateCcw,
  Server,
  ServerCog,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  approvalRequiredScopes,
  defaultMcpScopes,
  mcpScopes,
  type McpClient,
  type McpScope,
} from '#entities/mcp-access'
import { EditorModeContext, uiStyles } from '#shared/ui'
import {
  isValidMcpClientName,
  maximumMcpClientNameBytes,
  mcpClientNameBytes,
} from '../model/mcpClientName'
import styles from './McpClientEditor.module.scss'

export interface McpClientEditorValue {
  name: string
  approval_bypass: boolean
  scopes: McpScope[]
}

interface McpClientEditorProps {
  open: boolean
  client: McpClient | null
  busy: boolean
  disabled: boolean
  onCancel: () => void
  onSubmit: (value: McpClientEditorValue) => Promise<void>
}

interface PermissionGroup {
  key: 'hosts' | 'sessions' | 'commands' | 'sftp' | 'system' | 'processes' | 'services' | 'docker' | 'crontab'
  icon: LucideIcon
  scopes: readonly McpScope[]
}

const permissionGroups: readonly PermissionGroup[] = [
  {
    key: 'hosts',
    icon: Server,
    scopes: ['hosts:read', 'hosts:probe'],
  },
  {
    key: 'sessions',
    icon: KeyRound,
    scopes: ['sessions:read', 'sessions:connect', 'sessions:close'],
  },
  {
    key: 'commands',
    icon: TerminalSquare,
    scopes: ['commands:execute', 'commands:read', 'commands:interrupt'],
  },
  {
    key: 'sftp',
    icon: FolderKey,
    scopes: ['sftp:read', 'sftp:connect', 'sftp:close', 'sftp:write', 'sftp:transfer', 'sftp:cancel'],
  },
  {
    key: 'system',
    icon: Cpu,
    scopes: ['system:read'],
  },
  {
    key: 'processes',
    icon: Activity,
    scopes: ['processes:read', 'processes:terminate'],
  },
  {
    key: 'services',
    icon: ServerCog,
    scopes: ['services:read', 'services:manage'],
  },
  {
    key: 'docker',
    icon: Container,
    scopes: ['docker:read', 'docker:manage'],
  },
  {
    key: 'crontab',
    icon: CalendarClock,
    scopes: ['crontab:read', 'crontab:write'],
  },
]

export function McpClientEditor({
  open,
  client,
  busy,
  disabled,
  onCancel,
  onSubmit,
}: McpClientEditorProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<McpScope[]>([...defaultMcpScopes])
  const [approvalBypass, setApprovalBypass] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const loading = busy || submitting
  const locked = disabled || loading
  const mode = client ? 'edit' : 'create'
  const nameBytes = mcpClientNameBytes(name)
  const nameTooLarge = nameBytes > maximumMcpClientNameBytes
  const destructive = scopes.includes('sessions:close')
  const canSubmit = isValidMcpClientName(name) && scopes.length > 0 && !locked

  useEffect(() => {
    if (!open) return
    setName(client?.name ?? '')
    setScopes(client ? normalizeScopes(client.scopes) : [...defaultMcpScopes])
    setApprovalBypass(client?.approval_bypass ?? false)
    setSubmitting(false)
  }, [client, open])

  const selected = useMemo(() => new Set(scopes), [scopes])
  const toggleScope = (scope: McpScope, checked: boolean) => {
    const next = new Set(scopes)
    if (checked) next.add(scope)
    else next.delete(scope)
    setScopes(normalizeScopes(next))
  }

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        approval_bypass: approvalBypass,
        scopes: normalizeScopes(scopes),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      centered
      width={720}
      rootClassName={styles['editor-modal-root']}
      title={(
        <div className={styles['editor-title']}>
          <span className={styles['editor-title-icon']} aria-hidden="true"><KeyRound size={18} /></span>
          <EditorModeContext
            mode={mode}
            label={t(mode === 'edit' ? 'app.edit' : 'app.add')}
            title={<strong>{t(mode === 'edit' ? 'settings.mcp.editClient' : 'settings.mcp.addClient')}</strong>}
          />
        </div>
      )}
      confirmLoading={loading}
      okText={mode === 'edit' ? t('app.save') : t('settings.mcp.createClient')}
      cancelText={t('app.cancel')}
      okButtonProps={{ disabled: !canSubmit }}
      cancelButtonProps={{ disabled: locked }}
      closable={!locked}
      keyboard={!locked}
      mask={{ closable: !locked }}
      destroyOnHidden
      onCancel={() => {
        if (!locked) onCancel()
      }}
      onOk={() => void submit()}
    >
      <div className={styles.editor} aria-busy={loading}>
        <div className={styles.section}>
          <div className={styles.field}>
            <label htmlFor="mcp-client-name">{t('settings.mcp.clientName')}</label>
            <Input
              id="mcp-client-name"
              name="mcp-client-name"
              value={name}
              autoFocus
              disabled={locked}
              status={nameTooLarge ? 'error' : undefined}
              aria-invalid={nameTooLarge}
              aria-describedby="mcp-client-name-count"
              placeholder={t('settings.mcp.clientNamePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
            <small
              id="mcp-client-name-count"
              className={nameTooLarge ? styles['field-error'] : styles['field-hint']}
            >
              {t('settings.mcp.clientNameBytes', {
                current: nameBytes,
                maximum: maximumMcpClientNameBytes,
              })}
            </small>
          </div>
        </div>

        <section className={styles.section} aria-labelledby="mcp-client-permissions-title">
          <header className={styles['section-heading']}>
            <h3 id="mcp-client-permissions-title">{t('settings.mcp.permissions')}</h3>
            <div className={styles['permission-summary']}>
              <span aria-live="polite" aria-atomic="true">
                {t('settings.mcp.selectedPermissions', { count: scopes.length, total: mcpScopes.length })}
              </span>
              <Button
                type="text"
                size="small"
                icon={<RotateCcw size={13} />}
                disabled={locked}
                onClick={() => {
                  setScopes([...defaultMcpScopes])
                  setApprovalBypass(false)
                }}
              >
                {t('settings.mcp.restoreReadOnly')}
              </Button>
            </div>
          </header>

          <div className={styles['permission-groups']}>
            {permissionGroups.map((group) => {
              const Icon = group.icon
              return (
                <fieldset key={group.key} className={styles['permission-group']} disabled={locked}>
                  <legend>
                    <span className={styles['group-icon']} aria-hidden="true"><Icon size={15} /></span>
                    <span>
                      <strong>{t(`settings.mcp.permissionGroup.${group.key}`)}</strong>
                      <small>{t(`settings.mcp.permissionGroupHint.${group.key}`)}</small>
                    </span>
                  </legend>
                  <div className={styles['scope-grid']}>
                    {group.scopes.map((scope) => {
                      const scopeKey = scope.replace(':', '_')
                      const scopeName = t(`settings.mcp.scope.${scopeKey}`)
                      const scopeDescription = t(`settings.mcp.scopeDescription.${scopeKey}`)
                      const checked = selected.has(scope)
                      const danger = scope === 'sessions:close'
                      const approval = approvalRequiredScopes.includes(scope)
                      const defaultScope = defaultMcpScopes.includes(scope)
                      return (
                        <Checkbox
                          key={scope}
                          checked={checked}
                          disabled={locked}
                          className={[
                            styles['scope-option'],
                            checked ? styles['is-selected'] : '',
                            danger ? styles['is-danger'] : '',
                            locked ? styles['is-disabled'] : '',
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
              disabled={locked}
              aria-label={t('settings.mcp.approvalBypass')}
              aria-describedby="mcp-approval-bypass-description"
              onChange={setApprovalBypass}
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
      </div>
    </Modal>
  )
}

function normalizeScopes(scopes: Iterable<McpScope>) {
  const selected = new Set(scopes)
  return mcpScopes.filter((scope) => selected.has(scope))
}
