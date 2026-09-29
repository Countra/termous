import { Alert, Checkbox, Input, Modal } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockerResource, DockerResourceKind } from '#entities/docker'
import styles from './DockerResources.module.scss'

export type DockerResourceIntent =
  | { action: 'create' }
  | { action: 'remove' | 'tag' | 'connect'; resource: DockerResource }
  | { action: 'disconnect'; resource: DockerResource; container: string; containerName: string }

export function DockerResourceDialog({ intent, kind, busy, error, onCancel, onSubmit }: {
  intent: DockerResourceIntent
  kind: DockerResourceKind
  busy: boolean
  error: string
  onCancel: () => void
  onSubmit: (value: string, internal: boolean) => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [internal, setInternal] = useState(false)
  const text = (key: string) => t(`workbench.docker.resources.${key}`)
  const needsInput = ['create', 'tag', 'connect'].includes(intent.action)
  const title = intent.action === 'create' ? text(`create_${kind}`) : text(intent.action)
  return <Modal open centered title={title} destroyOnHidden
    okText={title} cancelText={t('app.cancel')} confirmLoading={busy} closable={!busy}
    mask={{ closable: !busy }} keyboard={!busy} cancelButtonProps={{ disabled: busy }}
    okButtonProps={{ danger: intent.action === 'remove' || intent.action === 'disconnect', disabled: busy || (needsInput && !value.trim()) }}
    onCancel={onCancel} onOk={() => onSubmit(value.trim(), internal)}>
    <div className={styles.dialog}>
      {'resource' in intent && <strong className={styles.target}>{intent.resource.name}</strong>}
      {intent.action === 'remove' && <p>{text(kind === 'volumes' ? 'removeVolumeHint' : 'removeHint')}</p>}
      {intent.action === 'disconnect' && <p>{t('workbench.docker.resources.disconnectHint', { name: intent.containerName || intent.container })}</p>}
      {needsInput && <label>
        <span>{text(intent.action === 'tag' ? 'tagName' : intent.action === 'connect' ? 'containerName' : 'name')}</span>
        <Input autoFocus value={value} disabled={busy} maxLength={255}
          placeholder={intent.action === 'tag' ? 'registry.example.com/app:latest' : undefined}
          onChange={(event) => setValue(event.target.value)}
          onPressEnter={() => { if (!busy && value.trim()) onSubmit(value.trim(), internal) }} />
      </label>}
      {intent.action === 'tag' && <p>{text('tagHint')}</p>}
      {intent.action === 'create' && <p>{text(kind === 'volumes' ? 'createVolumeHint' : 'createNetworkHint')}</p>}
      {intent.action === 'create' && kind === 'networks' && <Checkbox checked={internal} disabled={busy} onChange={(event) => setInternal(event.target.checked)}>{text('internal')}</Checkbox>}
      {error && <Alert type="error" showIcon title={error} description={text('failureHint')} />}
    </div>
  </Modal>
}
