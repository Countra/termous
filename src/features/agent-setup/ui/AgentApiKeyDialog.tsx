import { useEffect, useMemo, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Input, Modal } from 'antd'
import { KeyRound, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentModelProfile } from '#entities/agent'
import styles from './AgentSetup.module.scss'

interface AgentApiKeyDialogProps {
  profile?: AgentModelProfile
  busy: boolean
  conflicted: boolean
  revisionRefreshed: boolean
  onCancel: () => void
  onResolveConflict: () => Promise<void>
  onSave: (value: string) => Promise<void>
}

export function AgentApiKeyDialog({
  profile,
  busy,
  conflicted,
  revisionRefreshed,
  onCancel,
  onResolveConflict,
  onSave,
}: AgentApiKeyDialogProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const tooLarge = useMemo(() => new TextEncoder().encode(value).byteLength > 16 * 1024, [value])
  const canSubmit = Boolean(value.trim()) && !busy && !conflicted && !tooLarge

  useEffect(() => {
    setValue('')
  }, [profile])

  const close = () => {
    flushSync(() => setValue(''))
    onCancel()
  }
  const save = async () => {
    const secret = value
    flushSync(() => setValue(''))
    await onSave(secret)
  }

  return (
    <Modal
      open={Boolean(profile)}
      centered
      width={440}
      title={null}
      footer={null}
      closable={!busy}
      closeIcon={<X size={16} aria-hidden="true" />}
      destroyOnHidden
      mask={{ closable: !busy }}
      keyboard={!busy}
      className={styles['key-modal']}
      rootClassName="termous-modal-root"
      onCancel={close}
    >
      <section className={styles['key-dialog']} aria-labelledby="agent-key-dialog-title">
        <span className={styles['key-icon']} aria-hidden="true"><KeyRound size={18} /></span>
        <div>
          <h2 id="agent-key-dialog-title">{t('settings.agent.apiKey.title')}</h2>
          <p>{t('settings.agent.apiKey.description')}</p>
        </div>
        <label className={styles['key-label']} htmlFor="agent-model-api-key">
          {t('settings.agent.apiKey.fieldLabel', { name: profile?.name })}
        </label>
        <Input.Password
          id="agent-model-api-key"
          value={value}
          disabled={busy || conflicted}
          autoComplete="new-password"
          placeholder={t('settings.agent.apiKey.placeholder')}
          onChange={(event) => setValue(event.target.value)}
          onPressEnter={() => { if (canSubmit) void save().catch(() => undefined) }}
        />
        {conflicted ? (
          <Alert
            type="warning"
            showIcon
            title={t('settings.agent.conflict.title')}
            description={t('settings.agent.conflict.apiKeyDescription')}
            action={<Button size="small" loading={busy} onClick={() => void onResolveConflict()}>{t('settings.agent.conflict.refresh')}</Button>}
          />
        ) : null}
        {revisionRefreshed ? <Alert type="info" showIcon title={t('settings.agent.conflict.apiKeyRefreshed')} /> : null}
        {tooLarge ? <p className={styles.validation} role="alert">{t('settings.agent.apiKey.tooLarge')}</p> : null}
        <div className={styles['key-actions']}>
          <Button disabled={busy} onClick={close}>{t('app.cancel')}</Button>
          <Button type="primary" loading={busy} disabled={!canSubmit} onClick={() => void save().catch(() => undefined)}>{t('app.save')}</Button>
        </div>
      </section>
    </Modal>
  )
}
