import { Button, Input, Popconfirm, Segmented, Select, Tooltip } from 'antd'
import { ArrowLeft, DatabaseZap, KeyRound, LockKeyhole, ShieldCheck, Trash2 } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ManagementPanel } from '../../components/management/ManagementWorkspace'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import type { CredentialInput, CredentialType, CredentialView } from '../../types/domain'
import { credentialTypeIcon } from './credentialIcons'
import type { CredentialValidationErrors } from './credentialManagementUtils'

interface CredentialEditorProps {
  credentials: CredentialView[]
  editingCredential?: CredentialView
  draft: CredentialInput
  dirty: boolean
  requireSecret: boolean
  errors: CredentialValidationErrors
  actionBusy: boolean
  onChange: (patch: Partial<CredentialInput>) => void
  onBack: () => void
  onSave: () => void
  onDelete: () => void
  onDiscard: () => void
}

export function CredentialEditor({
  credentials,
  editingCredential,
  draft,
  dirty,
  requireSecret,
  errors,
  actionBusy,
  onChange,
  onBack,
  onSave,
  onDelete,
  onDiscard,
}: CredentialEditorProps) {
  const { t } = useTranslation()
  const Icon = credentialTypeIcon(draft.type)
  const displayName = draft.name.trim() || t('vault.newCredential')
  const hasErrors = Object.values(errors).some(Boolean)
  const visibleErrors = dirty ? errors : {}
  const deleteBlocked = Boolean(editingCredential?.bound_host_count)
  const passphraseOptions = useMemo(
    () => [
      { value: '', label: t('vault.noPassphrase') },
      ...credentials
        .filter((credential) => credential.type === 'private_key_passphrase')
        .map((credential) => ({ value: credential.id, label: credential.name })),
    ],
    [credentials, t],
  )

  const changeType = (type: CredentialType) => {
    if (type === draft.type) {
      return
    }
    onChange({ type, secret: '', metadata: {} })
  }

  return (
    <ManagementPanel
      className="credential-editor"
      bodyClassName="credential-editor-body"
      header={(
        <div className="credential-editor-heading">
          <Button type="text" className="credential-editor-back" icon={<ArrowLeft size={17} />} aria-label={t('vault.backToList')} onClick={onBack} />
          <span className={`credential-editor-avatar is-${draft.type}`}><Icon size={21} aria-hidden="true" /></span>
          <div className="credential-editor-title">
            <Tooltip title={displayName}><h2>{displayName}</h2></Tooltip>
            <span>{editingCredential ? t('vault.editCredential') : t('vault.newCredential')}</span>
          </div>
          <span className={`credential-editor-state ${dirty ? 'is-dirty' : ''}`}>
            {dirty ? t('vault.unsaved') : editingCredential ? t('vault.saved') : t('app.create')}
          </span>
        </div>
      )}
      footer={(
        <div className="credential-editor-footer-actions">
          <Tooltip title={deleteBlocked ? t('vault.deleteHint') : undefined}>
            <span>
              <Popconfirm
                title={t('app.confirmDelete')}
                description={t('vault.deleteConfirmHint')}
                okText={t('app.delete')}
                cancelText={t('app.cancel')}
                disabled={!editingCredential || deleteBlocked || actionBusy}
                rootClassName="credential-popconfirm"
                onConfirm={onDelete}
              >
                <Button danger icon={<Trash2 size={15} />} disabled={!editingCredential || deleteBlocked || actionBusy}>{t('app.delete')}</Button>
              </Popconfirm>
            </span>
          </Tooltip>
          <span className="credential-editor-footer-spacer" />
          <Button disabled={!dirty || actionBusy} onClick={onDiscard}>{t('vault.discard')}</Button>
          <ConnectionActionButton disabled={!dirty || hasErrors || actionBusy} loading={actionBusy} onClick={onSave}>
            {t('app.save')}
          </ConnectionActionButton>
        </div>
      )}
    >
      <CredentialEditorSection icon={<KeyRound size={16} />} title={t('vault.typeSection')}>
        <Segmented
          block
          className="segmented-control credential-type-segmented"
          value={draft.type}
          options={( ['password', 'private_key', 'private_key_passphrase'] as CredentialType[]).map((type) => ({
            value: type,
            label: t(`vault.typeName.${type}`),
          }))}
          onChange={(value) => changeType(value as CredentialType)}
        />
        <p className="credential-type-description">{t(`vault.typeHint.${draft.type}`)}</p>
      </CredentialEditorSection>

      <CredentialEditorSection icon={<DatabaseZap size={16} />} title={t('vault.detailsSection')}>
        <div className="credential-editor-grid">
          <label className="credential-editor-field">
            <span className="credential-editor-field-label">{t('vault.name')}</span>
            <Input
              value={draft.name}
              status={visibleErrors.name ? 'error' : undefined}
              placeholder={t('vault.namePlaceholder')}
              onChange={(event) => onChange({ name: event.target.value })}
            />
            {visibleErrors.name ? <small className="credential-editor-field-error">{visibleErrors.name}</small> : null}
          </label>
          {draft.type === 'private_key' ? (
            <label className="credential-editor-field">
              <span className="credential-editor-field-label">{t('vault.bindPassphrase')}</span>
              <Select
                value={draft.metadata.passphrase_credential_id ?? ''}
                options={passphraseOptions}
                className="termous-select"
                classNames={{ popup: { root: 'termous-select-popup credential-passphrase-popup' } }}
                onChange={(value) => onChange({ metadata: value
                  ? { ...draft.metadata, passphrase_credential_id: value }
                  : omitKey(draft.metadata, 'passphrase_credential_id') })}
              />
            </label>
          ) : null}
          <label className="credential-editor-field is-wide">
            <span className="credential-editor-field-label">{t('vault.secret')}</span>
            {draft.type === 'private_key' ? (
              <Input.TextArea
                value={draft.secret}
                autoSize={{ minRows: 7, maxRows: 12 }}
                status={visibleErrors.secret ? 'error' : undefined}
                placeholder={requireSecret ? t('vault.secretRequiredPlaceholder') : t('vault.secretKeepPlaceholder')}
                onChange={(event) => onChange({ secret: event.target.value })}
              />
            ) : (
              <Input.Password
                value={draft.secret}
                status={visibleErrors.secret ? 'error' : undefined}
                placeholder={requireSecret ? t('vault.secretRequiredPlaceholder') : t('vault.secretKeepPlaceholder')}
                onChange={(event) => onChange({ secret: event.target.value })}
              />
            )}
            {visibleErrors.secret
              ? <small className="credential-editor-field-error">{visibleErrors.secret}</small>
              : <small className="credential-editor-field-hint">{requireSecret ? t('vault.secretRequiredHint') : t('vault.secretKeepHint')}</small>}
          </label>
        </div>
      </CredentialEditorSection>

      <CredentialEditorSection icon={<ShieldCheck size={16} />} title={t('vault.metadata')}>
        <div className="credential-security-list">
          <SecurityItem icon={<ShieldCheck size={15} />} text={t('vault.encrypted')} />
          <SecurityItem icon={<LockKeyhole size={15} />} text={t('vault.protected')} />
          <SecurityItem icon={<DatabaseZap size={15} />} text={t('vault.memory')} />
        </div>
      </CredentialEditorSection>
    </ManagementPanel>
  )
}

function CredentialEditorSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="credential-editor-section">
      <div className="credential-editor-section-title"><span>{icon}</span><h3>{title}</h3></div>
      {children}
    </section>
  )
}

function SecurityItem({ icon, text }: { icon: ReactNode; text: string }) {
  return <span>{icon}<span>{text}</span></span>
}

function omitKey(source: Record<string, string>, key: string) {
  const next = { ...source }
  delete next[key]
  return next
}
