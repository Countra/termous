import { KeyRound, Plus, ShieldCheck, Trash2, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import { StatusBadge } from '../../components/ui/StatusBadge'
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
        <div className="segmented-control" role="tablist" aria-label={t('vault.list')}>
          {[
            ['all', t('vault.all')],
            ['password', t('vault.passwords')],
            ['private_key', t('vault.keys')],
            ['private_key_passphrase', t('vault.passphrases')],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? 'is-active' : ''}
              onClick={() => setFilter(value as typeof filter)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-row">
          <button type="button" className="secondary-button" disabled={actionBusy}>
            <KeyRound size={16} />
            {t('vault.importKey')}
          </button>
          <button type="button" className="secondary-button" onClick={onGenerateKey} disabled={actionBusy}>
            <Wand2 size={16} />
            {t('vault.generateKey')}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setEditingId(null)
              setForm(blankCredential)
            }}
          >
            <Plus size={16} />
            {t('vault.addCredential')}
          </button>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title={t('app.empty')} description={t('vault.subtitle')} />
        ) : (
          <div className="data-list">
            {filtered.map((credential) => (
              <button
                type="button"
                key={credential.id}
                className={`data-row ${credential.id === editingId ? 'is-active' : ''}`}
                onClick={() => setEditingId(credential.id)}
              >
                <span>
                  <strong>{credential.name}</strong>
                  <small>{credential.type}</small>
                </span>
                <span className="row-meta">{credential.bound_host_count} {t('vault.boundHosts')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-panel">
        <div className="panel-heading">
          <div>
            <h2>{t('vault.editor')}</h2>
            <span>{t('vault.encrypted')}</span>
          </div>
          <StatusBadge status="persisted" label={t('status.persisted')} />
        </div>
        <div className="security-stack">
          <span><ShieldCheck size={16} />{t('vault.encrypted')}</span>
          <span><ShieldCheck size={16} />{t('vault.protected')}</span>
          <span><ShieldCheck size={16} />{t('vault.memory')}</span>
        </div>
        <div className="form-grid">
          <Field label={t('vault.name')} value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <CustomSelect
            label={t('vault.type')}
            value={form.type}
            options={[
              { value: 'password', label: t('hosts.password') },
              { value: 'private_key', label: t('hosts.privateKey') },
              { value: 'private_key_passphrase', label: t('vault.passphrases') },
            ]}
            onChange={(value) => setForm({ ...form, type: value as CredentialType })}
          />
          {form.type === 'private_key' ? (
            <CustomSelect
              label={t('vault.bindPassphrase')}
              value={form.metadata.passphrase_credential_id ?? ''}
              options={passphraseOptions}
              onChange={(value) =>
                setForm({
                  ...form,
                  metadata: value ? { ...form.metadata, passphrase_credential_id: value } : omitKey(form.metadata, 'passphrase_credential_id'),
                })
              }
            />
          ) : null}
          <label className="field field-wide">
            <span className="field-label">{t('vault.secret')}</span>
            <textarea
              value={form.secret}
              placeholder={editingId ? t('fields.optional') : t('fields.required')}
              onChange={(event) => setForm({ ...form, secret: event.target.value })}
            />
          </label>
        </div>
        <div className="danger-zone">
          <span>{t('vault.deleteHint')}</span>
          <button type="button" className="danger-button" disabled={!editingId || actionBusy} onClick={() => editingId && void onDelete(editingId)}>
            <Trash2 size={16} />
            {t('app.delete')}
          </button>
        </div>
        <button type="button" className="primary-button full-width" disabled={actionBusy} onClick={() => void save()}>
          {editingId ? t('app.update') : t('app.create')}
        </button>
      </div>
    </section>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function omitKey(source: Record<string, string>, key: string) {
  const next = { ...source }
  delete next[key]
  return next
}

