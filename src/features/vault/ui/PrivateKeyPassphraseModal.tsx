import { Alert, Button, Input, Modal, Segmented, Select } from 'antd'
import { KeyRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CredentialView } from '#entities/credential'
import credentialStyles from './CredentialManagement.module.scss'
import styles from './SSHKeyDialogs.module.scss'

type PassphraseSource = 'existing' | 'new'

export type PrivateKeyUnlockInput =
  | { source: 'existing'; credentialId: string }
  | { source: 'new'; passphrase: string }

interface PrivateKeyPassphraseModalProps {
  open: boolean
  fileName: string
  busy: boolean
  error: string
  credentials: CredentialView[]
  defaultCredentialId?: string
  onCancel: () => void
  onInputChange: () => void
  onConfirm: (input: PrivateKeyUnlockInput) => void
}

export function PrivateKeyPassphraseModal({
  open,
  fileName,
  busy,
  error,
  credentials,
  defaultCredentialId,
  onCancel,
  onInputChange,
  onConfirm,
}: PrivateKeyPassphraseModalProps) {
  const { t } = useTranslation()
  const options = useMemo(
    () => credentials.map((credential) => ({ value: credential.id, label: credential.name })),
    [credentials],
  )
  const [source, setSource] = useState<PassphraseSource>('new')
  const [credentialId, setCredentialId] = useState('')
  const [passphrase, setPassphrase] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    const preferredCredentialId = defaultCredentialId && options.some((option) => option.value === defaultCredentialId)
      ? defaultCredentialId
      : options[0]?.value ?? ''
    setSource(preferredCredentialId ? 'existing' : 'new')
    setCredentialId(preferredCredentialId)
    setPassphrase('')
  }, [defaultCredentialId, open, options])

  const canConfirm = source === 'existing' ? Boolean(credentialId) : Boolean(passphrase)

  const confirm = () => {
    if (!canConfirm || busy) {
      return
    }
    if (source === 'existing') {
      onConfirm({ source, credentialId })
      return
    }
    onConfirm({ source, passphrase })
  }

  return (
    <Modal
      open={open}
      width={480}
      title={t('vault.sshKey.importPassphraseTitle')}
      rootClassName={styles['ssh-key-passphrase-modal']}
      destroyOnHidden
      mask={{ closable: !busy }}
      footer={[
        <Button key="cancel" disabled={busy} onClick={onCancel}>{t('app.cancel')}</Button>,
        <Button key="confirm" type="primary" className={styles['ssh-key-primary-action']} loading={busy} disabled={!canConfirm} onClick={confirm}>
          {t('vault.sshKey.verifyAndImport')}
        </Button>,
      ]}
      onCancel={onCancel}
    >
      <div className={styles['ssh-key-import-file']}>
        <span><KeyRound size={18} aria-hidden="true" /></span>
        <div><strong>{fileName}</strong><small>{t('vault.sshKey.encryptedKeyHint')}</small></div>
      </div>
      {error ? <Alert className={styles['ssh-key-modal-alert']} type="error" showIcon message={error} /> : null}
      <div className={styles['ssh-key-unlock-method']}>
        <span>{t('vault.sshKey.unlockMethod')}</span>
        <Segmented<PassphraseSource>
          block
          value={source}
          options={[
            { value: 'existing', label: t('vault.sshKey.savedPassphrase'), disabled: options.length === 0 },
            { value: 'new', label: t('vault.sshKey.newPassphrase') },
          ]}
          onChange={(value) => {
            setSource(value)
            onInputChange()
          }}
        />
      </div>
      {source === 'existing' ? (
        <label className={styles['ssh-key-form-field']}>
          <span>{t('vault.sshKey.savedPassphrase')}</span>
          <Select
            value={credentialId || undefined}
            options={options}
            className="termous-select"
            classNames={{ popup: { root: `termous-select-popup ${credentialStyles['credential-passphrase-popup']}` } }}
            placeholder={t('vault.sshKey.savedPassphrasePlaceholder')}
            notFoundContent={t('vault.sshKey.noSavedPassphrases')}
            onChange={(value) => {
              setCredentialId(value)
              onInputChange()
            }}
          />
          <small>{t('vault.sshKey.savedPassphraseHint')}</small>
        </label>
      ) : (
        <label className={styles['ssh-key-form-field']}>
          <span>{t('vault.sshKey.passphrase')}</span>
          <Input.Password
            name="ssh-key-import-passphrase"
            value={passphrase}
            autoFocus
            autoComplete="current-password"
            placeholder={t('vault.sshKey.importPassphrasePlaceholder')}
            onPressEnter={confirm}
            onChange={(event) => {
              setPassphrase(event.target.value)
              onInputChange()
            }}
          />
          <small>{t('vault.sshKey.newPassphraseHint')}</small>
        </label>
      )}
    </Modal>
  )
}
