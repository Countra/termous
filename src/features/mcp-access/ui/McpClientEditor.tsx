import { useEffect, useState } from 'react'
import { Input, Modal } from 'antd'
import { KeyRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  defaultMcpScopes,
  type McpClient,
  type McpScope,
} from '#entities/mcp-access'
import { EditorModeContext } from '#shared/ui'
import {
  isValidMcpClientName,
  maximumMcpClientNameBytes,
  mcpClientNameBytes,
} from '../model/mcpClientName'
import { normalizeMcpScopes } from '../model/mcpScopeCatalog'
import { McpScopeSelector } from './clients/McpScopeSelector'
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
  const canSubmit = isValidMcpClientName(name) && scopes.length > 0 && !locked

  useEffect(() => {
    if (!open) return
    setName(client?.name ?? '')
    setScopes(client ? normalizeMcpScopes(client.scopes) : [...defaultMcpScopes])
    setApprovalBypass(client?.approval_bypass ?? false)
    setSubmitting(false)
  }, [client, open])

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        approval_bypass: approvalBypass,
        scopes: normalizeMcpScopes(scopes),
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

        <McpScopeSelector
          scopes={scopes}
          approvalBypass={approvalBypass}
          disabled={locked}
          onScopesChange={setScopes}
          onApprovalBypassChange={setApprovalBypass}
        />
      </div>
    </Modal>
  )
}
