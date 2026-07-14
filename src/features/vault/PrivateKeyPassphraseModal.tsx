import { Alert, Button, Input, Modal } from 'antd'
import { KeyRound } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface PrivateKeyPassphraseModalProps {
  open: boolean
  fileName: string
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: (passphrase: string) => void
}

export function PrivateKeyPassphraseModal({ open, fileName, busy, error, onCancel, onConfirm }: PrivateKeyPassphraseModalProps) {
  const { t } = useTranslation()
  const [passphrase, setPassphrase] = useState('')

  useEffect(() => {
    if (!open) {
      setPassphrase('')
    }
  }, [open])

  return (
    <Modal
      open={open}
      width={480}
      title={t('vault.sshKey.importPassphraseTitle')}
      rootClassName="ssh-key-passphrase-modal"
      destroyOnHidden
      mask={{ closable: !busy }}
      footer={[
        <Button key="cancel" disabled={busy} onClick={onCancel}>{t('app.cancel')}</Button>,
        <Button key="confirm" type="primary" className="ssh-key-primary-action" loading={busy} disabled={!passphrase} onClick={() => onConfirm(passphrase)}>
          {t('vault.sshKey.verifyAndImport')}
        </Button>,
      ]}
      onCancel={onCancel}
    >
      <div className="ssh-key-import-file">
        <span><KeyRound size={18} aria-hidden="true" /></span>
        <div><strong>{fileName}</strong><small>{t('vault.sshKey.encryptedKeyHint')}</small></div>
      </div>
      {error ? <Alert className="ssh-key-modal-alert" type="error" showIcon message={error} /> : null}
      <label className="ssh-key-form-field">
        <span>{t('vault.sshKey.passphrase')}</span>
        <Input.Password
          name="ssh-key-import-passphrase"
          value={passphrase}
          autoFocus
          autoComplete="current-password"
          placeholder={t('vault.sshKey.importPassphrasePlaceholder')}
          onPressEnter={() => { if (passphrase && !busy) { onConfirm(passphrase) } }}
          onChange={(event) => setPassphrase(event.target.value)}
        />
      </label>
    </Modal>
  )
}
