import { KeyRound, Plus, Trash2, Wand2 } from 'lucide-react'
import { Button, Input, Popconfirm, Segmented, Tag } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import type { AppData, CredentialInput, CredentialType } from '../../types/domain'

interface VaultPageProps {
  data: AppData
  actionBusy: boolean
  onSave: (id: string | null, input: CredentialInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onGenerateKey: () => Promise<void>
}

const blankCredential: CredentialInput = {
  name: '',
  type: 'password',
  vault_id: 'local',
  secret: '',
  metadata: {},
}

export function VaultPage({ data, actionBusy, onSave, onDelete, onGenerateKey }: VaultPageProps) {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<'all' | CredentialType>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CredentialInput>(blankCredential)
  const editing = data.credentials.find((credential) => credential.id === editingId)
  const passphraseOptions = useMemo(
    () => [
      { value: '', label: t('vault.noPassphrase') },
      ...data.credentials
        .filter((credential) => credential.type === 'private_key_passphrase')
        .map((credential) => ({ value: credential.id, label: credential.name })),
    ],
    [data.credentials, t],
  )
  const filtered = data.credentials.filter((credential) => filter === 'all' || credential.type === filter)

  useEffect(() => {
    if (!editing) return
    setForm({
      name: editing.name,
      type: editing.type,
      vault_id: editing.vault_id,
      secret: '',
      metadata: editing.metadata ?? {},
    })
  }, [editing])

  const save = async () => {
    await onSave(editingId, form)
    setForm(blankCredential)
    setEditingId(null)
  }

  return (
    <section className="page-grid management-grid">
      <div className="list-panel">
        <div className="page-title-row compact-title">
          <div>
            <h1>{t('vault.title')}</h1>
            <p>{t('vault.subtitle')}</p>
          </div>
        </div>
        <Segmented
          block
          className="segmented-control"
          value={filter}
          options={[
            { value: 'all', label: t('vault.all') },
            { value: 'password', label: t('vault.passwords') },
            { value: 'private_key', label: t('vault.keys') },
            { value: 'private_key_passphrase', label: t('vault.passphrases') },
          ]}
          onChange={(value) => setFilter(value as typeof filter)}
        />
        <div className="toolbar-row">
          <Button className="secondary-button" onClick={onGenerateKey} disabled={actionBusy} icon={<Wand2 size={16} />}>
            {t('vault.generateKey')}
          </Button>
          <ConnectionActionButton
            onClick={() => {
              setEditingId(null)
              setForm(blankCredential)
            }}
            icon={<Plus size={16} />}
          >
            {t('vault.addCredential')}
          </ConnectionActionButton>
        </div>
        {filtered.length === 0 ? (
          <div className="management-empty-slot">
            <EmptyState title={t('app.empty')} description={t('vault.subtitle')} />
          </div>
        ) : (
          <div className="data-list credential-list">
            {filtered.map((credential) => (
              <button
                type="button"
                key={credential.id}
                className={`data-row ${credential.id === editingId ? 'is-active' : ''}`}
                onClick={() => setEditingId(credential.id)}
              >
                <span className="row-icon">
                  <KeyRound size={16} aria-hidden="true" />
                </span>
                <span className="row-copy">
                  <strong>{credential.name}</strong>
                  <small>{t(`vault.typeName.${credential.type}`)}</small>
                </span>
                <span className="row-trailing">
                  <Tag className="soft-tag">{t(`vault.typeName.${credential.type}`)}</Tag>
                  <small>{credential.bound_host_count} {t('vault.boundHosts')}</small>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-panel">
        <div className="panel-heading">
          <div>
            <h2>{t('vault.editor')}</h2>
            <span>{editingId ? t('app.update') : t('app.create')}</span>
          </div>
        </div>
        <div className="editor-sections">
          <section className="form-section">
            <h3>{t('vault.type')}</h3>
            <div className="credential-type-grid">
              {(['password', 'private_key', 'private_key_passphrase'] as CredentialType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  className={`auth-choice ${form.type === type ? 'is-active' : ''}`}
                  onClick={() => setForm({ ...form, type })}
                >
                  <KeyRound size={15} aria-hidden="true" />
                  <span>{t(`vault.typeName.${type}`)}</span>
                </button>
              ))}
            </div>
          </section>
          <section className="form-section">
            <h3>{t('vault.editor')}</h3>
            <div className="form-grid">
              <Field label={t('vault.name')} value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              {form.type === 'private_key' ? (
                <CustomSelect
                  label={t('vault.bindPassphrase')}
                  value={form.metadata.passphrase_credential_id ?? ''}
                  options={passphraseOptions}
                  onChange={(value) =>
                    setForm({
                      ...form,
                      metadata: value
                        ? { ...form.metadata, passphrase_credential_id: value }
                        : omitKey(form.metadata, 'passphrase_credential_id'),
                    })
                  }
                />
              ) : null}
              <label className="field field-wide">
                <span className="field-label">{t('vault.secret')}</span>
                {form.type === 'password' ? (
                  <Input.Password
                    value={form.secret}
                    placeholder={editingId ? t('fields.optional') : t('fields.required')}
                    onChange={(event) => setForm({ ...form, secret: event.target.value })}
                  />
                ) : (
                  <Input.TextArea
                    value={form.secret}
                    placeholder={editingId ? t('fields.optional') : t('fields.required')}
                    onChange={(event) => setForm({ ...form, secret: event.target.value })}
                  />
                )}
              </label>
            </div>
          </section>
        </div>
        <div className="danger-zone">
          <span>{t('vault.deleteHint')}</span>
          <Popconfirm
            title={t('app.confirmDelete')}
            description={t('vault.deleteHint')}
            okText={t('app.delete')}
            cancelText={t('app.cancel')}
            disabled={!editingId || actionBusy}
            onConfirm={() => editingId && void onDelete(editingId)}
          >
            <Button danger className="danger-button" disabled={!editingId || actionBusy} icon={<Trash2 size={16} />}>
              {t('app.delete')}
            </Button>
          </Popconfirm>
        </div>
        <Button type="primary" className="primary-button full-width" disabled={actionBusy} onClick={() => void save()}>
          {editingId ? t('app.update') : t('app.create')}
        </Button>
      </div>
    </section>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function omitKey(source: Record<string, string>, key: string) {
  const next = { ...source }
  delete next[key]
  return next
}
