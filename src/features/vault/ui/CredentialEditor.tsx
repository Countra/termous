import { Alert, Button, Input, Popconfirm, Radio, Select, Tooltip } from 'antd'
import { ArrowLeft, DatabaseZap, FileKey2, FileUp, Fingerprint, KeyRound, ShieldCheck, Trash2 } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  credentialTypeIcon,
  type CredentialInput,
  type CredentialType,
  type CredentialView,
} from '#entities/credential'
import { ConnectionActionButton } from '#shared/ui'
import { ManagementPanel } from '#shared/ui'
import type { CredentialValidationErrors } from '../model/credentialCatalog.ts'
import { sshKeyAlgorithmSummary } from '../model/sshKeyUi.ts'
import styles from './CredentialManagement.module.scss'

interface CredentialEditorProps {
  credentials: CredentialView[]
  editingCredential?: CredentialView
  draft: CredentialInput
  dirty: boolean
  requireSecret: boolean
  errors: CredentialValidationErrors
  actionBusy: boolean
  importBusy: boolean
  importError: string
  onChange: (patch: Partial<CredentialInput>) => void
  onTypeChange: (type: CredentialType) => void
  onBack: () => void
  onSave: () => void
  onDelete: () => void
  onDiscard: () => void
  onImportKey: () => void
}

export function CredentialEditor({
  credentials,
  editingCredential,
  draft,
  dirty,
  requireSecret,
  errors,
  actionBusy,
  importBusy,
  importError,
  onChange,
  onTypeChange,
  onBack,
  onSave,
  onDelete,
  onDiscard,
  onImportKey,
}: CredentialEditorProps) {
  const { t } = useTranslation()
  const Icon = credentialTypeIcon(draft.type)
  const displayName = draft.name.trim() || t('vault.newCredential')
  const hasErrors = Object.values(errors).some(Boolean)
  const visibleErrors = dirty ? errors : {}
  const deleteBlocked = Boolean(editingCredential?.bound_host_count)
  const passphraseOptions = useMemo(
    () => [
      ...(draft.pending_passphrase
        ? [{ value: '__pending__', label: t('vault.sshKey.pendingPassphrase', { name: draft.pending_passphrase.name }) }]
        : []),
      { value: '', label: t('vault.noPassphrase') },
      ...credentials
        .filter((credential) => credential.type === 'private_key_passphrase')
        .map((credential) => ({ value: credential.id, label: credential.name })),
    ],
    [credentials, draft.pending_passphrase, t],
  )

  const changeType = (type: CredentialType) => {
    if (type === draft.type) {
      return
    }
    onTypeChange(type)
  }

  return (
    <ManagementPanel
      className={styles['credential-editor']}
      bodyClassName={styles['credential-editor-body']}
      header={(
        <div className={styles['credential-editor-heading']}>
          <Button type="text" className={styles['credential-editor-back']} icon={<ArrowLeft size={17} />} aria-label={t('vault.backToList')} onClick={onBack} />
          <span className={[
            styles['credential-editor-avatar'],
            draft.type === 'private_key_passphrase' ? styles['is-private-key-passphrase'] : '',
          ].filter(Boolean).join(' ')}><Icon size={21} aria-hidden="true" /></span>
          <div className={styles['credential-editor-title']}>
            <Tooltip title={displayName}><h2>{displayName}</h2></Tooltip>
            <span>{editingCredential ? t('vault.editCredential') : t('vault.newCredential')}</span>
          </div>
          <span className={[styles['credential-editor-state'], dirty ? styles['is-dirty'] : ''].filter(Boolean).join(' ')}>
            {dirty ? t('vault.unsaved') : editingCredential ? t('vault.saved') : t('app.create')}
          </span>
        </div>
      )}
      footer={(
        <div className={styles['credential-editor-footer-actions']}>
          <Tooltip title={deleteBlocked ? t('vault.deleteHint') : undefined}>
            <span>
              <Popconfirm
                title={t('app.confirmDelete')}
                description={t('vault.deleteConfirmHint')}
                okText={t('app.delete')}
                cancelText={t('app.cancel')}
                disabled={!editingCredential || deleteBlocked || actionBusy}
                rootClassName={styles['credential-popconfirm']}
                onConfirm={onDelete}
              >
                <Button danger icon={<Trash2 size={15} />} disabled={!editingCredential || deleteBlocked || actionBusy}>{t('app.delete')}</Button>
              </Popconfirm>
            </span>
          </Tooltip>
          <span className={styles['credential-editor-footer-spacer']} />
          <Button disabled={!dirty || actionBusy} onClick={onDiscard}>{t('vault.discard')}</Button>
          <ConnectionActionButton disabled={!dirty || hasErrors || actionBusy} loading={actionBusy} onClick={onSave}>
            {t('app.save')}
          </ConnectionActionButton>
        </div>
      )}
    >
      <CredentialEditorSection icon={<KeyRound size={16} />} title={t('vault.typeSection')}>
        <Radio.Group
          className={styles['credential-type-options']}
          value={draft.type}
          onChange={(event) => changeType(event.target.value as CredentialType)}
        >
          {(['password', 'private_key', 'private_key_passphrase'] as CredentialType[]).map((type) => {
            const TypeIcon = credentialTypeIcon(type)
            return (
              <Radio.Button key={type} value={type}>
                <TypeIcon size={16} aria-hidden="true" />
                <span>{t(`vault.typeName.${type}`)}</span>
              </Radio.Button>
            )
          })}
        </Radio.Group>
        <p className={styles['credential-type-description']}>{t(`vault.typeHint.${draft.type}`)}</p>
      </CredentialEditorSection>

      <CredentialEditorSection icon={<DatabaseZap size={16} />} title={t('vault.detailsSection')}>
        <div className={styles['credential-editor-grid']}>
          <label className={styles['credential-editor-field']}>
            <span className={styles['credential-editor-field-label']}>{t('vault.name')}</span>
            <Input
              name="credential-name"
              value={draft.name}
              status={visibleErrors.name ? 'error' : undefined}
              placeholder={t('vault.namePlaceholder')}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            {visibleErrors.name ? <small className={styles['credential-editor-field-error']}>{visibleErrors.name}</small> : null}
          </label>
          {draft.type === 'private_key' ? (
            <label className={styles['credential-editor-field']}>
              <span className={styles['credential-editor-field-label']}>{t('vault.bindPassphrase')}</span>
              <Select
                value={draft.pending_passphrase ? '__pending__' : draft.metadata.passphrase_credential_id ?? ''}
                options={passphraseOptions}
                disabled={Boolean(draft.pending_passphrase)}
                className="termous-select"
                classNames={{ popup: { root: `termous-select-popup ${styles['credential-passphrase-popup']}` } }}
                onChange={(value) => onChange({ metadata: value
                  ? { ...draft.metadata, passphrase_credential_id: value }
                  : omitKey(draft.metadata, 'passphrase_credential_id') })}
              />
            </label>
          ) : null}
          <div className={`${styles['credential-editor-field']} ${styles['is-wide']}`}>
            <span className={styles['credential-editor-field-heading']}>
              <span className={styles['credential-editor-field-label']}>{t('vault.secret')}</span>
              {draft.type === 'private_key' ? (
                <Button size="small" icon={<FileUp size={14} />} loading={importBusy} disabled={actionBusy} onClick={onImportKey}>
                  {t('vault.importKey')}
                </Button>
              ) : null}
            </span>
            {draft.type === 'private_key' ? (
              <Input.TextArea
                name="credential-private-key"
                value={draft.secret}
                autoSize={{ minRows: 7, maxRows: 12 }}
                status={visibleErrors.secret ? 'error' : undefined}
                placeholder={requireSecret ? t('vault.secretRequiredPlaceholder') : t('vault.secretKeepPlaceholder')}
                onChange={(event) => onChange({
                  secret: event.target.value,
                  ssh_key_info: undefined,
                  pending_passphrase: undefined,
                })}
              />
            ) : (
              <Input.Password
                name="credential-secret"
                value={draft.secret}
                status={visibleErrors.secret ? 'error' : undefined}
                placeholder={requireSecret ? t('vault.secretRequiredPlaceholder') : t('vault.secretKeepPlaceholder')}
                onChange={(event) => onChange({ secret: event.target.value })}
              />
            )}
            {visibleErrors.secret
              ? <small className={styles['credential-editor-field-error']}>{visibleErrors.secret}</small>
              : <small className={styles['credential-editor-field-hint']}>{requireSecret ? t('vault.secretRequiredHint') : t('vault.secretKeepHint')}</small>}
            {importError ? <Alert className={styles['credential-import-error']} type="error" showIcon title={importError} /> : null}
            {draft.ssh_key_info ? (
              <div className={styles['credential-key-summary']}>
                <span className={styles['credential-key-summary-icon']}><FileKey2 size={18} aria-hidden="true" /></span>
                <div className={styles['credential-key-summary-main']}>
                  <strong>{sshKeyAlgorithmSummary(draft.ssh_key_info, t)}</strong>
                  <span><Fingerprint size={13} aria-hidden="true" />{draft.ssh_key_info.fingerprint_sha256}</span>
                </div>
                <span className={styles['credential-key-verified']}><ShieldCheck size={13} />{t('vault.sshKey.verified')}</span>
              </div>
            ) : null}
          </div>
        </div>
      </CredentialEditorSection>

    </ManagementPanel>
  )
}

function CredentialEditorSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className={styles['credential-editor-section']}>
      <div className={styles['credential-editor-section-title']}><span>{icon}</span><h3>{title}</h3></div>
      {children}
    </section>
  )
}

function omitKey(source: Record<string, string>, key: string) {
  const next = { ...source }
  delete next[key]
  return next
}
