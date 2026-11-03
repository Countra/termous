import { useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Form, Input } from 'antd'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useSettingsEditor } from '#entities/settings'
import { EditorModeContext, SelectControl, SettingsSaveBar } from '#shared/ui'
import type { AgentIntegrationSource, AgentIntegrationsGateway, MCPIntegrationInput } from '#entities/agent-integrations'
import styles from './IntegrationEditor.module.scss'

export function MCPSourceEditor({ gateway, source, onClose, onSaved }: {
  gateway: AgentIntegrationsGateway; source?: AgentIntegrationSource; onClose(): void; onSaved(source: AgentIntegrationSource): void
}) {
  const { t } = useTranslation()
  const { modal } = App.useApp()
  const [form] = Form.useForm()
  const transport = Form.useWatch('transport', form) ?? source?.mcp?.transport ?? 'stdio'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const initial = { name: source?.name ?? '', transport: source?.mcp?.transport ?? 'stdio', command: source?.mcp?.command, mode: source?.mcp?.mode ?? '',
    args: JSON.stringify(source?.mcp?.args ?? []), cwd: source?.mcp?.cwd, url: source?.mcp?.url, auth: source?.mcp?.auth || 'none' }
  const pending = useRef<AbortController | null>(null)
  const feedback = useRef<HTMLDivElement>(null)
  useEffect(() => () => { pending.current?.abort() }, [])
  useEffect(() => { if (error) { feedback.current?.scrollIntoView?.({ block: 'nearest' }); feedback.current?.focus() } }, [error])
  const save = async () => {
    if (pending.current) return
    const abort = new AbortController(); pending.current = abort
    setBusy(true); setError('')
    try {
      const fields = await form.validateFields()
      const args: unknown = transport === 'stdio' ? JSON.parse(fields.args || '[]') : []
      if (!Array.isArray(args) || !args.every(value => typeof value === 'string')) throw new Error(t('extensions.invalidArgs'))
      const input: MCPIntegrationInput = { name: fields.name, expected_revision: source?.revision ?? 0,
        mcp: transport === 'stdio' ? { transport, mode: fields.mode || undefined, command: fields.command, args, cwd: fields.cwd || undefined }
          : { transport, url: fields.url, auth: fields.auth || 'none' } }
      if (fields.secrets?.trim()) {
        const secrets: unknown = JSON.parse(fields.secrets)
        if (!secrets || typeof secrets !== 'object' || Array.isArray(secrets) || !Object.values(secrets).every(value => typeof value === 'string')) throw new Error(t('extensions.invalidSecrets'))
        input.secret = transport === 'stdio' ? { environment: secrets as Record<string, string> } : { headers: secrets as Record<string, string> }
      }
      const saved = await gateway.saveMCP(input, source?.id, abort.signal)
      if (!abort.signal.aborted) onSaved(saved)
    } catch (error) { if (!abort.signal.aborted && error instanceof Error) setError(error.message) }
    finally { if (pending.current === abort) pending.current = null; if (!abort.signal.aborted) setBusy(false) }
  }
  useSettingsEditor({ dirty, busy, saving: busy, invalid: false, save: () => { void save() }, reset: onClose })
  const close = () => {
    if (pending.current) return
    if (!dirty) { onClose(); return }
    modal.confirm({ title: t('settings.editor.leaveTitle'), content: t('settings.editor.leaveDescription'),
      okText: t('settings.editor.discard'), cancelText: t('extensions.cancel'), okButtonProps: { danger: true }, onOk: onClose })
  }
  return <section className={styles.editor} aria-label={t(source ? 'extensions.editMCP' : 'extensions.addMCP')} aria-busy={busy}>
    <header className={styles['editor-header']}>
      <EditorModeContext mode={source ? 'edit' : 'create'} label={t(source ? 'app.edit' : 'app.add')}
        title={<h3>{t(source ? 'extensions.editMCP' : 'extensions.addMCP')}</h3>} />
      <Button type="text" icon={<ArrowLeft size={15} />} disabled={busy} onClick={close}>{t('extensions.backToServers')}</Button>
    </header>
    <Form form={form} layout="vertical" disabled={busy} initialValues={initial} onFinish={() => void save()} scrollToFirstError
      onValuesChange={(_, values) => {
        // 隐藏的连接字段不会参与本次保存，也不能使已恢复原值的表单持续显示未保存。
        const fields = values.transport === 'http' ? ['name', 'transport', 'url', 'auth'] : ['name', 'transport', 'mode', 'command', 'args', 'cwd']
        setDirty(Boolean(values.secrets?.trim()) || Object.entries(initial).some(([key, value]) => fields.includes(key) && values[key] !== value))
      }}>
      <div className={styles['form-body']}>
        {error && <div ref={feedback} tabIndex={-1} className={styles.feedback}><Alert type="error" title={error} showIcon /></div>}
        <section className={styles.group}>
          <h4>{t('extensions.editorIdentity')}</h4>
          <div className={`${styles.panel} ${styles.columns}`}>
            <Form.Item name="name" label={t('extensions.name')} rules={[{required: true, whitespace: true}]}><Input maxLength={160} autoFocus /></Form.Item>
            <Form.Item name="transport" label={t('extensions.transport')}><SelectControl onChange={() => form.setFieldValue('secrets', undefined)} options={[{value: 'stdio',label: t('extensions.localTransport')}, {value: 'http',label: t('extensions.remoteTransport')}]} /></Form.Item>
          </div>
        </section>
        <section className={styles.group}>
          <h4>{t('extensions.editorConnection')}</h4>
          <div className={styles.panel}>
            {transport === 'stdio' ? <>
              <Form.Item name="mode" label={t('mcpPreparation.mode')} extra={t('mcpPreparation.modeHint')}><SelectControl options={[{ value: '', label: t('mcpPreparation.auto') }, { value: 'managed_npm', label: t('mcpPreparation.managed') }, { value: 'external', label: t('mcpPreparation.external') }]} /></Form.Item>
              <Form.Item name="command" label={t('extensions.command')} extra={t('extensions.commandHint')} rules={[{required: true, whitespace: true}]}><Input placeholder="npx" spellCheck={false} /></Form.Item>
              <Form.Item name="args" label={t('extensions.args')}><Input.TextArea className={styles.code} autoSize={{minRows: 2,maxRows: 5}} placeholder={'["server.js"]'} spellCheck={false} /></Form.Item>
              <Form.Item name="cwd" label={t('extensions.cwd')}><Input /></Form.Item>
            </> : <>
              <Form.Item name="url" label={t('extensions.url')} rules={[{required: true},{type:'url'}]}><Input /></Form.Item>
              <Form.Item name="auth" label={t('extensions.auth')}><SelectControl options={[{value:'none',label:t('extensions.noAuth')},{value:'headers',label:t('extensions.headerAuth')},{value:'oauth',label:'OAuth'}]} /></Form.Item>
            </>}
          </div>
        </section>
        <section className={styles.group}>
          <h4>{t('extensions.editorAdvanced')}</h4>
          <div className={styles.panel}>
            <Form.Item name="secrets" label={t(transport === 'stdio' ? 'extensions.environment' : 'extensions.headers')} extra={source?.secret_configured ? t('extensions.keepSecrets') : undefined}>
              <Input.TextArea className={styles.code} autoSize={{minRows: 3,maxRows: 6}} placeholder="{}" autoComplete="off" spellCheck={false} />
            </Form.Item>
          </div>
        </section>
      </div>
      <SettingsSaveBar dirty={dirty} busy={busy} invalid={false} pristineLabel={source ? undefined : t('extensions.newServerHint')}
        onSave={() => void save()} onReset={() => { form.resetFields(); setDirty(false); setError('') }} />
    </Form>
  </section>
}
