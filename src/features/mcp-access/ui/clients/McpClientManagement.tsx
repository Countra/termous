import { useEffect, useState } from 'react'
import { Button, Switch, Tag, Tooltip } from 'antd'
import { KeyRound, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { McpClient, McpClientToken } from '#entities/mcp-access'
import { ConfirmDialog, uiStyles } from '#shared/ui'
import { getMcpScopeCatalogEntry } from '../../model/mcpScopeCatalog'
import type { McpAccessRuntimeValue } from '../../runtime/mcpAccessContext'
import { McpClientEditor, type McpClientEditorValue } from '../McpClientEditor'
import styles from '../McpSettingsPanel.module.scss'
import { McpTokenDialog } from '../McpTokenDialog'

interface ClientEditorIntent {
  client: McpClient | null
}

interface McpClientManagementProps {
  runtime: McpAccessRuntimeValue
  onFailure: () => void
}

const clientScopePreviewLimit = 5

export function McpClientManagement({ runtime, onFailure }: McpClientManagementProps) {
  const { t } = useTranslation()
  const [editor, setEditor] = useState<ClientEditorIntent | null>(null)
  const [deleteCandidate, setDeleteCandidate] = useState<McpClient | null>(null)
  const [tokenCandidateId, setTokenCandidateId] = useState<string | null>(null)
  const [tokenResult, setTokenResult] = useState<McpClientToken | null>(null)
  const tokenCandidate = tokenCandidateId
    ? runtime.clients.find((client) => client.id === tokenCandidateId && client.enabled) ?? null
    : null

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
      onFailure()
    }
  }

  const issueToken = async () => {
    if (!tokenCandidateId) return
    try {
      const issued = await runtime.issueToken(tokenCandidateId)
      setTokenCandidateId(null)
      setTokenResult(issued)
    } catch {
      onFailure()
    }
  }

  useEffect(() => {
    if (deleteCandidate && !runtime.clients.some((client) => client.id === deleteCandidate.id)) {
      setDeleteCandidate(null)
    }
    if (tokenCandidateId && !runtime.clients.some((client) => (
      client.id === tokenCandidateId && client.enabled
    ))) {
      setTokenCandidateId(null)
    }
  }, [deleteCandidate, runtime.clients, tokenCandidateId])

  return (
    <>
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
              onIssueToken={() => setTokenCandidateId(client.id)}
              onToggle={(enabled) => void runtime.patchClient(client.id, { enabled }).catch(onFailure)}
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
        open={Boolean(tokenCandidate)}
        title={t('settings.mcp.newTokenConfirmTitle')}
        description={t('settings.mcp.newTokenConfirmDescription', { name: tokenCandidate?.name })}
        confirmLabel={t('settings.mcp.newTokenConfirm')}
        danger
        confirmLoading={Boolean(tokenCandidateId && runtime.mutationKey === `client:${tokenCandidateId}:token`)}
        onCancel={() => setTokenCandidateId(null)}
        onConfirm={() => void issueToken()}
      />
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
            .catch(onFailure)
        }}
      />
    </>
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
  const scopeItems = client.scopes.map((scope) => {
    const entry = getMcpScopeCatalogEntry(scope)
    return { scope, label: t(entry.labelKey), destructive: entry.destructive }
  })
  const visibleScopeItems = scopeItems.slice(0, clientScopePreviewLimit)
  const hiddenScopeCount = scopeItems.length - visibleScopeItems.length
  const scopePreview = (
    <div
      className={`${styles.scopes} ${hiddenScopeCount > 0 ? styles['is-truncated'] : ''}`}
      role="group"
      aria-label={`${t('settings.mcp.permissions')}: ${scopeItems.map((item) => item.label).join(', ')}`}
    >
      {visibleScopeItems.map(({ scope, label, destructive }) => (
        <Tag key={scope} color={destructive ? 'error' : undefined}>
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
                    {scopeItems.map(({ scope, label, destructive }) => (
                      <span
                        key={scope}
                        className={destructive ? styles['is-danger'] : undefined}
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

function formatDate(value: string, locale: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
