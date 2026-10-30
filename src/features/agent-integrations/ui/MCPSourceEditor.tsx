import { useEffect, useRef, useState } from 'react'
import { Alert, Form, Input, Modal, Select } from 'antd'
import { useTranslation } from 'react-i18next'
import { modalSurfaceStyles } from '#shared/ui'
import type { AgentIntegrationSource, AgentIntegrationsGateway, MCPIntegrationInput } from '#entities/agent-integrations'

export function MCPSourceEditor({ gateway, source, onClose, onSaved }: {
  gateway: AgentIntegrationsGateway; source?: AgentIntegrationSource; onClose(): void; onSaved(source: AgentIntegrationSource): void
}) {
  const { t } = useTranslation()
  const [form] = Form.useForm()
  const transport = Form.useWatch('transport', form) ?? source?.mcp?.transport ?? 'stdio'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => { pending.current?.abort() }, [])
  const save = async () => {
    if (pending.current) return
    const abort = new AbortController(); pending.current = abort
    try {
      const fields = await form.validateFields()
      const args: unknown = JSON.parse(fields.args || '[]')
      if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw new Error(t('extensions.invalidArgs'))
      const input: MCPIntegrationInput = { name: fields.name, expected_revision: source?.revision ?? 0,
        mcp: transport === 'stdio' ? { transport, mode: fields.mode || undefined, command: fields.command, args, cwd: fields.cwd || undefined }
          : { transport, url: fields.url, auth: fields.auth || 'none' } }
      if (fields.secrets?.trim()) {
        const secrets: unknown = JSON.parse(fields.secrets)
        if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets) || !Object.values(secrets).every(value => typeof value === 'string')) throw new Error(t('extensions.invalidSecrets'))
        input.secret = transport === 'stdio' ? { environment: secrets as Record<string, string> } : { headers: secrets as Record<string, string> }
      }
      setBusy(true); setError('')
      const saved = await gateway.saveMCP(input, source?.id, abort.signal)
      if (!abort.signal.aborted) onSaved(saved)
    } catch (error) { if (!abort.signal.aborted && error instanceof Error) setError(error.message) }
    finally { if (pending.current === abort) pending.current = null; if (!abort.signal.aborted) setBusy(false) }
  }
  return <Modal open centered width={620} title={t(source ? 'extensions.editMCP' : 'extensions.addMCP')}
    rootClassName={modalSurfaceStyles.root} confirmLoading={busy} onOk={() => void save()} onCancel={onClose}
    cancelButtonProps={{disabled: busy}} closable={!busy} mask={{closable: !busy}} okText={t('extensions.save')} destroyOnHidden>
    <Form form={form} layout="vertical" disabled={busy} initialValues={{ name: source?.name ?? '', transport: source?.mcp?.transport ?? 'stdio', command: source?.mcp?.command, mode: source?.mcp?.mode ?? '',
      args: JSON.stringify(source?.mcp?.args ?? []), cwd: source?.mcp?.cwd, url: source?.mcp?.url, auth: source?.mcp?.auth || 'none' }}>
      <Form.Item name="name" label={t('extensions.name')} rules={[{required: true, whitespace: true}]}><Input maxLength={160} autoFocus /></Form.Item>
      <Form.Item name="transport" label={t('extensions.transport')}><Select options={[{value: 'stdio',label: 'stdio'}, {value: 'http',label: 'Streamable HTTP'}]} /></Form.Item>
      {transport === 'stdio' ? <>
        <Form.Item name="mode" label={t('mcpPreparation.mode')} extra={t('mcpPreparation.modeHint')}><Select options={[{ value: '', label: t('mcpPreparation.auto') }, { value: 'managed_npm', label: t('mcpPreparation.managed') }, { value: 'external', label: t('mcpPreparation.external') }]} /></Form.Item>
        <Form.Item name="command" label={t('extensions.command')} rules={[{required: true, whitespace: true}]}><Input /></Form.Item>
        <Form.Item name="args" label={t('extensions.args')}><Input.TextArea autoSize={{minRows: 2,maxRows: 5}} placeholder={'["server.js"]'} /></Form.Item>
        <Form.Item name="cwd" label={t('extensions.cwd')}><Input /></Form.Item>
      </> : <>
        <Form.Item name="url" label={t('extensions.url')} rules={[{required: true},{type:'url'}]}><Input /></Form.Item>
        <Form.Item name="auth" label={t('extensions.auth')}><Select options={[{value:'none',label:t('extensions.noAuth')},{value:'headers',label:t('extensions.headers')},{value:'oauth',label:'OAuth'}]} /></Form.Item>
      </>}
      <Form.Item name="secrets" label={t(transport === 'stdio' ? 'extensions.environment' : 'extensions.headers')} extra={source?.secret_configured ? t('extensions.keepSecrets') : undefined}>
        <Input.TextArea autoSize={{minRows: 2,maxRows: 4}} placeholder="{}" autoComplete="off" spellCheck={false} />
      </Form.Item>
    </Form>
    {error && <Alert type="error" title={error} showIcon />}
  </Modal>
}
