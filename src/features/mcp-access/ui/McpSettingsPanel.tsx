import { useEffect, useState } from 'react'
import { Alert, App as AntdApp, Button, Switch, Tag, Tooltip } from 'antd'
import {
  Clipboard,
  KeyRound,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  type McpClient,
  type McpClientToken,
} from '#entities/mcp-access'
import { getTermousBridge } from '#shared/bridge'
import { ConfirmDialog, termousNotificationClassName, uiStyles } from '#shared/ui'
import { useMcpAccessRuntime } from '../runtime/mcpAccessContext'
import { McpClientEditor, type McpClientEditorValue } from './McpClientEditor'
import { McpTokenDialog } from './McpTokenDialog'
import styles from './McpSettingsPanel.module.scss'

interface ClientEditorIntent {
  client: McpClient | null
}

const clientScopePreviewLimit = 5

export function McpSettingsPanel() {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const runtime = useMcpAccessRuntime()
  const [editor, setEditor] = useState<ClientEditorIntent | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<McpClient | null>(null)
  const [tokenResult, setTokenResult] = useState<McpClientToken | null>(null)
  const statusBusy = runtime.mutationKey === 'server'
  const unavailable = runtime.phase === 'degraded'
  const notifyFailure = () => notification.error({
    title: t('settings.mcp.operationFailed'),
    duration: 4,
    className: termousNotificationClassName,
  })

  const openCreate = () => setEditor({ client: null })
  const openEdit = (client: McpClient) => setEditor({ client })
  const saveEditor = async (value: McpClientEditorValue) => {
    if (!editor) return
    try {
      if (editor.client) {
        await runtime.patchClient(editor.client.id, {
          name: value.name,
          approval_bypass: value.approval_bypass,
          scopes: value.scopes,
        })
      } else {
        const issued = await runtime.createClient(value)
        setTokenResult(issued)
      }
      setEditor(null)
    } catch {
      notifyFailure()
    }
  }

  const issueToken = async (client: McpClient) => {
    try {
      setTokenResult(await runtime.issueToken(client.id))
    } catch {
      notifyFailure()
    }
  }

  useEffect(() => {
    if (deleteCandidate && !runtime.clients.some((client) => client.id === deleteCandidate.id)) {
      setDeleteCandidate(null)
    }
  }, [deleteCandidate, runtime.clients])

  return (
    <div className={styles.stack}>
      <section className={styles.surface}>
        <header className={styles.heading}>
          <span className={styles['heading-icon']} aria-hidden="true"><PlugZap size={18} /></span>
          <div>
            <h2>{t('settings.mcp.title')}</h2>
            <p>{t('settings.mcp.description')}</p>
          </div>
          <span className={`${styles['state-pill']} ${styles[`is-${runtime.status?.state ?? 'disabled'}`]}`}>
            <span />
            {t(`settings.mcp.state.${runtime.status?.state ?? 'disabled'}`)}
          </span>
        </header>

        {unavailable ? (
          <Alert
            type="warning"
            showIcon
            title={t('settings.mcp.unavailable')}
            description={runtime.errorCode}
            action={(
              <Button size="small" type="text" icon={<RefreshCw size={14} />} onClick={() => void runtime.reload()}>
                {t('app.retry')}
              </Button>
            )}
          />
        ) : null}

        <div className={styles['setting-row']}>
          <div>
            <strong>{t('settings.mcp.enable')}</strong>
            <p>{t('settings.mcp.enableHint')}</p>
          </div>
          <Switch
            checked={runtime.status?.enabled ?? false}
            loading={runtime.phase === 'loading' || statusBusy}
            disabled={!runtime.status || unavailable || Boolean(runtime.mutationKey)}
            aria-label={t('settings.mcp.enable')}
            onChange={(checked) => void runtime.setEnabled(checked).catch(notifyFailure)}
          />
        </div>

        <div className={styles['endpoint-row']}>
          <div>
            <small>{t('settings.mcp.endpoint')}</small>
            <code>{runtime.status?.endpoint || '—'}</code>
          </div>
          <Button
            icon={<Clipboard size={15} />}
            disabled={!runtime.status?.endpoint}
            onClick={() => void copyText(runtime.status?.endpoint ?? '')
              .then(() => notification.success({
                title: t('settings.mcp.copied'),
                duration: 2,
                className: termousNotificationClassName,
              }))
              .catch(notifyFailure)}
          >
            {t('app.copy')}
          </Button>
        </div>
        <p className={styles['endpoint-hint']}>{t('settings.mcp.endpointHint')}</p>
        <p className={styles.protocol}>MCP {runtime.status?.protocol_version ?? '2025-11-25'}</p>
      </section>

      <section className={styles.surface}>
        <header className={styles['section-header']}>
          <div>
            <h2>{t('settings.mcp.clients')}</h2>
            <p>{t('settings.mcp.clientsHint')}</p>
          </div>
          <Button
            type="primary"
            icon={<Plus size={15} />}
            disabled={!runtime.status || Boolean(runtime.mutationKey)}
            onClick={openCreate}
          >
            {t('settings.mcp.addClient')}
          </Button>
        </header>

        <div className={styles['client-list']}>
          {runtime.clients.length === 0 ? (
            <div className={styles.empty}>{t('settings.mcp.noClients')}</div>
          ) : runtime.clients.map((client) => (
            <ClientRow
              key={client.id}
              client={client}
              busy={runtime.mutationKey.startsWith(`client:${client.id}`)}
              disabled={Boolean(runtime.mutationKey)}
              onEdit={() => openEdit(client)}
              onIssueToken={() => void issueToken(client)}
              onToggle={(enabled) => void runtime.patchClient(client.id, { enabled }).catch(notifyFailure)}
              onDelete={() => setDeleteCandidate(client)}
            />
          ))}
        </div>
      </section>

      <McpClientEditor
        open={Boolean(editor)}
        client={editor?.client ?? null}
        busy={runtime.mutationKey === 'client:create' || Boolean(editor?.client && runtime.mutationKey === `client:${editor.client.id}`)}
        disabled={Boolean(runtime.mutationKey)}
        onCancel={() => setEditor(null)}
        onSubmit={saveEditor}
      />
      <McpTokenDialog result={tokenResult} endpoint={runtime.status?.endpoint ?? ''} onClose={() => setTokenResult(null)} />
      <ConfirmDialog
        open={Boolean(deleteCandidate)}
        title={t('settings.mcp.deleteTitle')}
        description={t('settings.mcp.deleteDescription', { name: deleteCandidate?.name })}
        confirmLabel={t('settings.mcp.deleteConfirm')}
        danger
        confirmLoading={Boolean(deleteCandidate && runtime.mutationKey === `client:${deleteCandidate.id}`)}
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={() => {
          if (!deleteCandidate) return
          void runtime.deleteClient(deleteCandidate.id)
            .then(() => setDeleteCandidate(null))
            .catch(notifyFailure)
        }}
      />
    </div>
  )
}

function ClientRow({
  client,
  busy,
  disabled,
  onEdit,
  onIssueToken,
  onToggle,
  onDelete,
}: {
  client: McpClient
  busy: boolean
  disabled: boolean
  onEdit: () => void
  onIssueToken: () => void
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}) {
  const { t, i18n } = useTranslation()
  const active = client.enabled
  const state = active ? 'active' : 'disabled'
  const scopeItems = client.scopes.map((scope) => ({
    scope,
    label: t(`settings.mcp.scope.${scope.replace(':', '_')}`),
  }))
  const visibleScopeItems = scopeItems.slice(0, clientScopePreviewLimit)
  const hiddenScopeCount = scopeItems.length - visibleScopeItems.length
  const scopePreview = (
    <div
      className={`${styles.scopes} ${hiddenScopeCount > 0 ? styles['is-truncated'] : ''}`}
      role="group"
      aria-label={`${t('settings.mcp.permissions')}: ${scopeItems.map((item) => item.label).join(', ')}`}
    >
      {visibleScopeItems.map(({ scope, label }) => (
        <Tag key={scope} color={scope === 'sessions:close' ? 'error' : undefined}>
          {label}
        </Tag>
      ))}
      {hiddenScopeCount > 0 ? (
        <Tag className={styles['scope-overflow']}>+{hiddenScopeCount}</Tag>
      ) : null}
    </div>
  )
  return (
    <article className={`${styles.client} ${!active ? styles['is-muted'] : ''}`}>
      <div className={styles['client-main']}>
        <span className={styles['client-icon']} aria-hidden="true"><KeyRound size={16} /></span>
        <div>
          <div className={styles['client-name']}>
            <strong>{client.name}</strong>
            <Tag color={active ? 'success' : 'default'}>{t(`settings.mcp.clientState.${state}`)}</Tag>
            {client.approval_bypass ? (
              <Tag color="error">{t('settings.mcp.approvalBypass')}</Tag>
            ) : null}
          </div>
          {hiddenScopeCount > 0 ? (
            <Tooltip
              title={(
                <span className={styles['scope-list-tooltip-content']}>
                  <strong>{t('settings.mcp.permissions')}</strong>
                  <span className={styles['scope-list-tooltip-items']}>
                    {scopeItems.map(({ scope, label }) => (
                      <span
                        key={scope}
                        className={scope === 'sessions:close' ? styles['is-danger'] : undefined}
                      >
                        {label}
                      </span>
                    ))}
                  </span>
                </span>
              )}
              placement="topLeft"
              mouseEnterDelay={0.35}
              destroyOnHidden
              classNames={{
                root: `${uiStyles.tooltip} termous-tooltip ${styles['scope-list-tooltip']}`,
              }}
            >
              {scopePreview}
            </Tooltip>
          ) : scopePreview}
          <small>
            {client.last_used_at
              ? t('settings.mcp.lastUsed', { time: formatDate(client.last_used_at, i18n.resolvedLanguage ?? i18n.language) })
              : t('settings.mcp.neverUsed')}
          </small>
        </div>
      </div>
      <div className={styles['client-actions']}>
        <Switch
          size="small"
          checked={active}
          loading={busy}
          disabled={disabled}
          aria-label={t('settings.mcp.clientToggleLabel', { name: client.name })}
          onChange={onToggle}
        />
        <Tooltip title={t('app.edit')}>
          <Button
            type="text"
            icon={<Pencil size={15} />}
            disabled={disabled}
            aria-label={t('settings.mcp.editClientLabel', { name: client.name })}
            onClick={onEdit}
          />
        </Tooltip>
        <Tooltip title={t('settings.mcp.newToken')}>
          <Button
            type="text"
            icon={<RefreshCw size={15} />}
            disabled={disabled || !active}
            aria-label={t('settings.mcp.newTokenLabel', { name: client.name })}
            onClick={onIssueToken}
          />
        </Tooltip>
        <Tooltip title={t('settings.mcp.deleteClient')}>
          <Button
            type="text"
            danger
            icon={<Trash2 size={15} />}
            disabled={disabled}
            aria-label={t('settings.mcp.deleteClientLabel', { name: client.name })}
            onClick={onDelete}
          />
        </Tooltip>
      </div>
    </article>
  )
}

async function copyText(value: string) {
  const bridge = getTermousBridge()
  if (bridge?.clipboard) {
    await bridge.clipboard.writeText(value)
    return
  }
  await navigator.clipboard.writeText(value)
}

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
