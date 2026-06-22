import { FileInput, Pencil, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import type { AppData, AuthMethod, HostInput } from '../../types/domain'

interface HostsPageProps {
  data: AppData
  selectedHostId: string
  actionBusy: boolean
  onSelectHost: (hostId: string) => void
  onSave: (id: string | null, input: HostInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onImport: () => Promise<void>
}

const blankHost: HostInput = {
  name: '',
  group_id: '',
  address: '',
  port: 22,
  username: '',
  auth_method: 'password',
  credential_id: '',
  jump_host_id: '',
  tags: [],
  fingerprint_policy: 'confirm_on_change',
  note: '',
}

export function HostsPage({ data, selectedHostId, actionBusy, onSelectHost, onSave, onDelete, onImport }: HostsPageProps) {
  const { t } = useTranslation()
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId)
  const [editingId, setEditingId] = useState<string | null>(selectedHost?.id ?? null)
  const [form, setForm] = useState<HostInput>(blankHost)
  const [tagText, setTagText] = useState('')

  useEffect(() => {
    if (!selectedHost) {
      setEditingId(null)
      setForm(blankHost)
      setTagText('')
      return
    }
    setEditingId(selectedHost.id)
    setForm({
      name: selectedHost.name,
      group_id: selectedHost.group_id,
      address: selectedHost.address,
      port: selectedHost.port,
      username: selectedHost.username,
      auth_method: selectedHost.auth_method,
      credential_id: selectedHost.credential_id,
      jump_host_id: selectedHost.jump_host_id ?? '',
      tags: selectedHost.tags ?? [],
      fingerprint_policy: selectedHost.fingerprint_policy,
      note: selectedHost.note ?? '',
    })
    setTagText((selectedHost.tags ?? []).join(', '))
  }, [selectedHost])

  const groupOptions = useMemo(
    () => [
      { value: '', label: t('hosts.ungrouped') },
      ...data.groups.map((group) => ({ value: group.id, label: group.name })),
    ],
    [data.groups, t],
  )
  const credentialOptions = useMemo(
    () => [
      { value: '', label: t('fields.none') },
      ...data.credentials.map((credential) => ({ value: credential.id, label: credential.name, description: credential.type })),
    ],
    [data.credentials, t],
  )
  const jumpHostOptions = useMemo(
    () => [
      { value: '', label: t('hosts.noJumpHost') },
      ...data.hosts
        .filter((host) => host.id !== editingId)
        .map((host) => ({ value: host.id, label: host.name, description: host.address })),
    ],
    [data.hosts, editingId, t],
  )

  const save = async () => {
    const input = { ...form, tags: tagText.split(',').map((tag) => tag.trim()).filter(Boolean) }
    await onSave(editingId, input)
  }

  return (
    <section className="page-grid management-grid">
      <div className="list-panel">
        <div className="page-title-row compact-title">
          <div>
            <h1>{t('hosts.title')}</h1>
            <p>{t('hosts.subtitle')}</p>
          </div>
        </div>
        <div className="toolbar-row">
          <button type="button" className="secondary-button" onClick={onImport} disabled={actionBusy}>
            <FileInput size={16} />
            {t('hosts.importConfig')}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setEditingId(null)
              setForm(blankHost)
              setTagText('')
            }}
          >
            <Plus size={16} />
            {t('hosts.addHost')}
          </button>
        </div>
        {data.hosts.length === 0 ? (
          <EmptyState title={t('app.empty')} description={t('hosts.subtitle')} />
        ) : (
          <div className="data-list">
            {data.hosts.map((host) => (
              <button
                type="button"
                key={host.id}
                className={`data-row ${host.id === selectedHostId ? 'is-active' : ''}`}
                onClick={() => onSelectHost(host.id)}
              >
                <span>
                  <strong>{host.name}</strong>
                  <small>{host.username}@{host.address}:{host.port}</small>
                </span>
                <span className="row-meta">{host.tags?.join(' / ') || t('fields.none')}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-panel">
        <div className="panel-heading">
          <div>
            <h2>{t('hosts.editor')}</h2>
            <span>{editingId ? t('app.update') : t('app.create')}</span>
          </div>
          <Pencil size={18} aria-hidden="true" />
        </div>
        <div className="form-grid">
          <Field label={t('hosts.name')} value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
          <Field label={t('hosts.address')} value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
          <Field label={t('hosts.username')} value={form.username} onChange={(value) => setForm({ ...form, username: value })} />
          <Field
            label={t('hosts.port')}
            value={String(form.port)}
            type="number"
            onChange={(value) => setForm({ ...form, port: Number(value) || 22 })}
          />
          <CustomSelect label={t('hosts.group')} value={form.group_id} options={groupOptions} onChange={(value) => setForm({ ...form, group_id: value })} />
          <CustomSelect
            label={t('hosts.authMethod')}
            value={form.auth_method}
            options={[
              { value: 'password', label: t('hosts.password') },
              { value: 'private_key', label: t('hosts.privateKey') },
            ]}
            onChange={(value) => setForm({ ...form, auth_method: value as AuthMethod })}
          />
          <CustomSelect
            label={t('hosts.credential')}
            value={form.credential_id}
            options={credentialOptions}
            onChange={(value) => setForm({ ...form, credential_id: value })}
          />
          <CustomSelect
            label={t('hosts.jumpHost')}
            value={form.jump_host_id}
            options={jumpHostOptions}
            onChange={(value) => setForm({ ...form, jump_host_id: value })}
          />
          <Field label={t('hosts.tags')} value={tagText} onChange={setTagText} />
          <Field label={t('hosts.note')} value={form.note} onChange={(value) => setForm({ ...form, note: value })} />
        </div>
        <div className="danger-zone">
          <span>{t('hosts.deleteHint')}</span>
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

function Field({
  label,
  value,
  type = 'text',
  onChange,
}: {
  label: string
  value: string
  type?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input value={value} type={type} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

