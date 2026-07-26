import { Alert, Button, Input, Modal, Segmented, Switch } from 'antd'
import { Check, Copy, Download, FileKey2, KeyRound, RotateCcw, ShieldCheck } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CredentialInput, SSHKeyAlgorithm, SSHKeyECDSACurve, SSHKeyGenerateRequest, SSHKeyPair } from '../../types/domain'
import { buildPrivateKeyDraft, sshKeyAlgorithmSummary, sshKeyErrorMessage } from './sshKeyUi'

interface SSHKeyGenerationModalProps {
  open: boolean
  onClose: () => void
  onGenerate: (input: SSHKeyGenerateRequest, signal: AbortSignal) => Promise<SSHKeyPair>
  onApply: (draft: CredentialInput) => void
}

type GenerationStage = 'configure' | 'result'

export function SSHKeyGenerationModal({ open, onClose, onGenerate, onApply }: SSHKeyGenerationModalProps) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<GenerationStage>('configure')
  const [name, setName] = useState('')
  const [algorithm, setAlgorithm] = useState<SSHKeyAlgorithm>('ed25519')
  const [rsaBits, setRsaBits] = useState<3072 | 4096>(3072)
  const [ecdsaCurve, setEcdsaCurve] = useState<SSHKeyECDSACurve>('p256')
  const [comment, setComment] = useState('')
  const [protectWithPassphrase, setProtectWithPassphrase] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [passphraseConfirm, setPassphraseConfirm] = useState('')
  const [pair, setPair] = useState<SSHKeyPair | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resultMessage, setResultMessage] = useState('')
  const abortRef = useRef<AbortController | null>(null)
  const requestRevisionRef = useRef(0)

  const clearSecrets = useCallback(() => {
    setPassphrase('')
    setPassphraseConfirm('')
    setPair(null)
  }, [])

  const reset = useCallback(() => {
    requestRevisionRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    setStage('configure')
    setName(t('vault.sshKey.defaultName'))
    setAlgorithm('ed25519')
    setRsaBits(3072)
    setEcdsaCurve('p256')
    setComment('')
    setProtectWithPassphrase(false)
    setBusy(false)
    setError('')
    setResultMessage('')
    clearSecrets()
  }, [clearSecrets, t])

  useEffect(() => {
    if (open) {
      reset()
    }
    return () => {
      requestRevisionRef.current += 1
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [open, reset])

  const close = () => {
    reset()
    onClose()
  }

  const generate = async () => {
    const normalizedName = name.trim()
    if (!normalizedName) {
      setError(t('vault.sshKey.errors.name_required'))
      return
    }
    if (protectWithPassphrase && !passphrase) {
      setError(t('vault.sshKey.errors.passphrase_empty'))
      return
    }
    if (protectWithPassphrase && passphrase !== passphraseConfirm) {
      setError(t('vault.sshKey.errors.passphrase_mismatch'))
      return
    }

    requestRevisionRef.current += 1
    const revision = requestRevisionRef.current
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(true)
    setError('')
    setResultMessage('')
    try {
      const input: SSHKeyGenerateRequest = {
        algorithm,
        comment: comment.trim() || undefined,
        passphrase: protectWithPassphrase ? passphrase : undefined,
      }
      if (algorithm === 'rsa') {
        input.rsa_bits = rsaBits
      }
      if (algorithm === 'ecdsa') {
        input.ecdsa_curve = ecdsaCurve
      }
      const generated = await onGenerate(input, controller.signal)
      if (revision !== requestRevisionRef.current) {
        return
      }
      setPair(generated)
      setStage('result')
    } catch (generateError) {
      if (revision === requestRevisionRef.current && !controller.signal.aborted) {
        setError(sshKeyErrorMessage(generateError, t))
      }
    } finally {
      if (revision === requestRevisionRef.current) {
        setBusy(false)
        abortRef.current = null
      }
    }
  }

  const copyPublicKey = async () => {
    if (!pair) {
      return
    }
    try {
      if (window.termous?.clipboard) {
        await window.termous.clipboard.writeText(pair.public_key_authorized)
      } else {
        await navigator.clipboard.writeText(pair.public_key_authorized)
      }
      setResultMessage(t('vault.sshKey.publicKeyCopied'))
    } catch {
      setError(t('vault.sshKey.errors.clipboard_failed'))
    }
  }

  const savePublicKey = async () => {
    if (!pair || !window.termous?.sshKeys) {
      setError(t('vault.sshKey.errors.file_integration_unavailable'))
      return
    }
    try {
      const saved = await window.termous.sshKeys.savePublicKey({
        suggestedName: name,
        content: pair.public_key_authorized,
      })
      if (!saved.canceled) {
        setResultMessage(t('vault.sshKey.publicKeySaved', { name: saved.file_name }))
      }
    } catch (saveError) {
      setError(sshKeyErrorMessage(saveError, t))
    }
  }

  const saveKeyPair = async () => {
    if (!pair || !window.termous?.sshKeys) {
      setError(t('vault.sshKey.errors.file_integration_unavailable'))
      return
    }
    try {
      const saved = await window.termous.sshKeys.saveKeyPair({
        suggestedName: name,
        privateKey: pair.private_key_openssh,
        publicKey: pair.public_key_authorized,
      })
      if (!saved.canceled) {
        setResultMessage(t('vault.sshKey.keyPairSaved', {
          privateName: saved.file_name,
          publicName: saved.public_file_name,
        }))
      }
    } catch (saveError) {
      setError(sshKeyErrorMessage(saveError, t))
    }
  }

  const apply = () => {
    if (!pair) {
      return
    }
    onApply(buildPrivateKeyDraft(
      name,
      pair.private_key_openssh,
      pair.info,
      pair.encrypted ? passphrase : undefined,
      t('vault.sshKey.generatedPassphraseName', { name: name.trim() }),
    ))
    close()
  }

  const footer = stage === 'configure'
    ? [
        <Button key="cancel" onClick={close}>{t('app.cancel')}</Button>,
        <Button key="generate" type="primary" className="ssh-key-primary-action" loading={busy} icon={<KeyRound size={16} />} onClick={() => void generate()}>
          {t('vault.sshKey.generate')}
        </Button>,
      ]
    : [
        <Button key="regenerate" icon={<RotateCcw size={15} />} onClick={() => { setStage('configure'); setPair(null); setError(''); setResultMessage('') }}>
          {t('vault.sshKey.backToConfigure')}
        </Button>,
        <Button key="apply" type="primary" className="ssh-key-primary-action" icon={<Check size={16} />} onClick={apply}>
          {t('vault.sshKey.applyToCredential')}
        </Button>,
      ]

  return (
    <Modal
      open={open}
      width={720}
      title={t('vault.sshKey.generatorTitle')}
      footer={footer}
      rootClassName="ssh-key-generation-modal"
      destroyOnHidden
      mask={{ closable: !busy }}
      onCancel={close}
    >
      <div className="ssh-key-modal-intro">
        <span><ShieldCheck size={19} aria-hidden="true" /></span>
        <div>
          <strong>{stage === 'configure' ? t('vault.sshKey.configureTitle') : t('vault.sshKey.resultTitle')}</strong>
          {stage === 'result' ? <small>{t('vault.sshKey.resultHint')}</small> : null}
        </div>
      </div>

      {error ? <Alert className="ssh-key-modal-alert" type="error" showIcon message={error} /> : null}
      {stage === 'configure' ? (
        <div className="ssh-key-config-form">
          <label className="ssh-key-form-field">
            <span>{t('vault.sshKey.credentialName')}</span>
            <Input name="ssh-key-credential-name" value={name} maxLength={120} placeholder={t('vault.sshKey.namePlaceholder')} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="ssh-key-form-field">
            <span>{t('vault.sshKey.algorithmLabel')}</span>
            <Segmented
              block
              value={algorithm}
              options={[
                { value: 'ed25519', label: t('vault.sshKey.algorithm.ed25519') },
                { value: 'rsa', label: 'RSA' },
                { value: 'ecdsa', label: 'ECDSA' },
              ]}
              onChange={(value) => setAlgorithm(value as SSHKeyAlgorithm)}
            />
          </label>
          {algorithm === 'rsa' ? (
            <label className="ssh-key-form-field">
              <span>{t('vault.sshKey.rsaBits')}</span>
              <Segmented block value={rsaBits} options={[3072, 4096]} onChange={(value) => setRsaBits(value as 3072 | 4096)} />
            </label>
          ) : null}
          {algorithm === 'ecdsa' ? (
            <label className="ssh-key-form-field">
              <span>{t('vault.sshKey.ecdsaCurve')}</span>
              <Segmented block value={ecdsaCurve} options={['p256', 'p384', 'p521']} onChange={(value) => setEcdsaCurve(value as SSHKeyECDSACurve)} />
            </label>
          ) : null}
          <label className="ssh-key-form-field">
            <span>{t('vault.sshKey.comment')}</span>
            <Input name="ssh-key-comment" value={comment} maxLength={255} placeholder={t('vault.sshKey.commentPlaceholder')} onChange={(event) => setComment(event.target.value)} />
          </label>
          <div className="ssh-key-passphrase-setting">
            <strong>{t('vault.sshKey.protectWithPassphrase')}</strong>
            <Switch checked={protectWithPassphrase} onChange={(checked) => { setProtectWithPassphrase(checked); if (!checked) { setPassphrase(''); setPassphraseConfirm('') } }} />
          </div>
          {protectWithPassphrase ? (
            <div className="ssh-key-passphrase-fields">
              <label className="ssh-key-form-field">
                <span>{t('vault.sshKey.passphrase')}</span>
                <Input.Password name="ssh-key-passphrase" value={passphrase} autoComplete="new-password" onChange={(event) => setPassphrase(event.target.value)} />
              </label>
              <label className="ssh-key-form-field">
                <span>{t('vault.sshKey.confirmPassphrase')}</span>
                <Input.Password name="ssh-key-passphrase-confirmation" value={passphraseConfirm} autoComplete="new-password" onChange={(event) => setPassphraseConfirm(event.target.value)} />
              </label>
            </div>
          ) : null}
        </div>
      ) : pair ? (
        <div className="ssh-key-result">
          <div className="ssh-key-result-summary">
            <span className="ssh-key-result-icon"><FileKey2 size={24} aria-hidden="true" /></span>
            <div><strong>{name}</strong><small>{sshKeyAlgorithmSummary(pair.info, t)}</small></div>
            <span className="ssh-key-result-state"><Check size={13} />{t('vault.sshKey.generated')}</span>
          </div>
          <dl className="ssh-key-result-details">
            <div><dt>{t('vault.sshKey.fingerprint')}</dt><dd>{pair.info.fingerprint_sha256}</dd></div>
            <div><dt>{t('vault.sshKey.protection')}</dt><dd>{pair.encrypted ? t('vault.sshKey.passphraseProtected') : t('vault.sshKey.unencrypted')}</dd></div>
          </dl>
          <div className="ssh-key-public-preview">
            <div><strong>{t('vault.sshKey.publicKey')}</strong><small>{t('vault.sshKey.publicKeyHint')}</small></div>
            <pre>{pair.public_key_authorized}</pre>
          </div>
          <div className="ssh-key-result-actions">
            <Button icon={<Copy size={15} />} onClick={() => void copyPublicKey()}>{t('vault.sshKey.copyPublicKey')}</Button>
            <Button icon={<Download size={15} />} onClick={() => void savePublicKey()}>{t('vault.sshKey.savePublicKey')}</Button>
            <Button icon={<FileKey2 size={15} />} onClick={() => void saveKeyPair()}>{t('vault.sshKey.saveKeyPair')}</Button>
          </div>
          {resultMessage ? <div className="ssh-key-result-message"><Check size={14} />{resultMessage}</div> : null}
        </div>
      ) : null}
    </Modal>
  )
}
