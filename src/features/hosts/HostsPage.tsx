import { ImagePlus, KeyRound, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { App as AntdApp, Button, Input, InputNumber, Popconfirm, Select, Tag } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { HostAvatar } from '../../components/hosts/HostAvatar'
import { CustomSelect } from '../../components/ui/CustomSelect'
import { EmptyState } from '../../components/ui/EmptyState'
import { AuthMethodBadge } from '../../components/ui/AuthMethodBadge'
import { ConnectionActionButton } from '../../components/ui/ConnectionActionButton'
import type { AppData, AuthMethod, HostGroup, HostIcon, HostInput } from '../../types/domain'
import { hostToInput } from './hostInput'

interface HostsPageProps {
  data: AppData
  selectedHostId: string
  createIntentKey?: number
  actionBusy: boolean
  onSelectHost: (hostId: string) => void
  onSave: (id: string | null, input: HostInput) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onCreateGroup: (name: string) => Promise<HostGroup>
  onUploadHostIcon: (file: File) => Promise<HostIcon>
  onDeleteHostIcon: (id: string) => Promise<void>
  getHostIconUrl: (iconId: string) => string
}

const blankHost: HostInput = {
  name: '',
  platform: 'linux',
  icon_id: '',
  group_id: '',
  address: '',
  port: 22,
  username: '',
  auth_method: 'system',
  credential_id: '',
  jump_host_id: '',
  tags: [],
  favorite: false,
  fingerprint_policy: 'confirm_on_change',
  note: '',
}

const systemHost: HostInput = { ...blankHost, auth_method: 'system', credential_id: '' }
const hostIconAccept = '.png,.jpg,.jpeg,.svg,.ico,image/png,image/jpeg,image/svg+xml,image/x-icon,image/vnd.microsoft.icon'
const maxHostIconBytes = 5 * 1024 * 1024

interface HostTagOption {
  key: string
  label: string
  count: number
}

export function HostsPage({
  data,
  selectedHostId,
  createIntentKey = 0,
  actionBusy,
  onSelectHost,
  onSave,
  onDelete,
  onCreateGroup,
  onUploadHostIcon,
  onDeleteHostIcon,
  getHostIconUrl,
}: HostsPageProps) {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId)
  const [editingId, setEditingId] = useState<string | null>(selectedHost?.id ?? null)
  const [form, setForm] = useState<HostInput>({ ...blankHost, tags: [] })
  const iconFileInputRef = useRef<HTMLInputElement>(null)
  const pendingIconIdRef = useRef('')
  const deleteHostIconRef = useRef(onDeleteHostIcon)
  const [, setPendingIconId] = useState('')
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false)
  const [groupDraft, setGroupDraft] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)

  useEffect(() => {
    deleteHostIconRef.current = onDeleteHostIcon
  }, [onDeleteHostIcon])

  useEffect(() => () => {
    const iconId = pendingIconIdRef.current
    if (iconId) {
      void deleteHostIconRef.current(iconId).catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const pendingUploadIconId = pendingIconIdRef.current
    if (pendingUploadIconId) {
      pendingIconIdRef.current = ''
      void deleteHostIconRef.current(pendingUploadIconId).catch(() => undefined)
    }
    if (!selectedHost) {
      setEditingId(null)
      setForm({ ...blankHost, tags: [] })
      setPendingIconId('')
      return
    }
    setEditingId(selectedHost.id)
    setForm({ ...hostToInput(selectedHost), tags: normalizeHostTags(selectedHost.tags ?? []) })
    setPendingIconId('')
  }, [selectedHost])

  useEffect(() => {
    const pendingUploadIconId = pendingIconIdRef.current
    if (pendingUploadIconId) {
      pendingIconIdRef.current = ''
      void deleteHostIconRef.current(pendingUploadIconId).catch(() => undefined)
    }
    if (createIntentKey <= 0) {
      return
    }
    setEditingId(null)
    setForm({ ...systemHost, tags: [] })
    setPendingIconId('')
  }, [createIntentKey])

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
  const platformOptions = useMemo(() => [{ value: 'linux', label: t('hosts.platform.linux') }], [t])
  const jumpHostOptions = useMemo(
    () => [
      { value: '', label: t('hosts.noJumpHost') },
      ...data.hosts
        .filter((host) => host.id !== editingId)
        .map((host) => ({ value: host.id, label: host.name, description: host.address })),
    ],
    [data.hosts, editingId, t],
  )
  const groupNameById = useMemo(() => new Map(data.groups.map((group) => [group.id, group.name])), [data.groups])
  const availableTags = useMemo(() => buildHostTagOptions(data.hosts), [data.hosts])
  const searchTokens = useMemo(
    () => searchQuery.trim().split(/\s+/).map(normalizeSearchToken).filter(Boolean),
    [searchQuery],
  )
  const selectedTagKeys = useMemo(() => selectedTags.map(tagKey).filter(Boolean), [selectedTags])
  const filteredHosts = useMemo(
    () => data.hosts.filter((host) => hostMatchesFilters(host, groupNameById, searchTokens, selectedTagKeys)),
    [data.hosts, groupNameById, searchTokens, selectedTagKeys],
  )
  const tagSelectOptions = useMemo(
    () => availableTags.map((tag) => ({ value: tag.label, label: `${tag.label} (${tag.count})` })),
    [availableTags],
  )
  const hasFilters = searchTokens.length > 0 || selectedTagKeys.length > 0

  useEffect(() => {
    if (filteredHosts.length === 0 || filteredHosts.some((host) => host.id === selectedHostId)) {
      return
    }
    onSelectHost(filteredHosts[0].id)
  }, [filteredHosts, onSelectHost, selectedHostId])

  const save = async () => {
    const input = { ...form, tags: normalizeHostTags(form.tags) }
    await onSave(editingId, input)
    pendingIconIdRef.current = ''
    setPendingIconId('')
  }

  const uploadIcon = async (file: File) => {
    const validationMessage = validateHostIconFile(file, t)
    if (validationMessage) {
      void message.warning(validationMessage)
      return
    }
    setUploadingIcon(true)
    try {
      const uploaded = await onUploadHostIcon(file)
      const previousPendingIconId = pendingIconIdRef.current
      setForm((current) => ({ ...current, icon_id: uploaded.id }))
      pendingIconIdRef.current = uploaded.id
      setPendingIconId(uploaded.id)
      if (previousPendingIconId && previousPendingIconId !== uploaded.id) {
        try {
          await onDeleteHostIcon(previousPendingIconId)
        } catch {
          // 临时 icon 清理失败不阻塞主机编辑，后端仍会按引用保护处理。
        }
      }
    } finally {
      setUploadingIcon(false)
      if (iconFileInputRef.current) {
        iconFileInputRef.current.value = ''
      }
    }
  }

  const removeIcon = async () => {
    const iconId = form.icon_id
    setForm((current) => ({ ...current, icon_id: '' }))
    if (iconId && iconId === pendingIconIdRef.current) {
      pendingIconIdRef.current = ''
      setPendingIconId('')
      try {
        await onDeleteHostIcon(iconId)
      } catch {
        // 临时 icon 可能已被其他主机复用或被清理，移除表单引用即可。
      }
    }
  }

  const createGroup = async () => {
    const name = normalizeGroupName(groupDraft)
    if (!name) {
      return
    }
    const existing = data.groups.find((group) => normalizeGroupName(group.name).toLowerCase() === name.toLowerCase())
    if (existing) {
      setForm((current) => ({ ...current, group_id: existing.id }))
      setGroupDraft('')
      setGroupCreatorOpen(false)
      return
    }
    setCreatingGroup(true)
    try {
      const group = await onCreateGroup(name)
      setForm((current) => ({ ...current, group_id: group.id }))
      setGroupDraft('')
      setGroupCreatorOpen(false)
    } finally {
      setCreatingGroup(false)
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSelectedTags([])
  }

  const toggleTagFilter = (tag: string, checked: boolean) => {
    setSelectedTags((current) => {
      if (checked) {
        return normalizeHostTags([...current, tag])
      }
      const key = tagKey(tag)
      return current.filter((item) => tagKey(item) !== key)
    })
  }

  const startCreateHost = () => {
    setEditingId(null)
    setForm({ ...systemHost, tags: [] })
  }

  return (
    <section className="page-grid management-grid">
      <div className="list-panel">
        <div className={`host-filter-panel ${data.hosts.length === 0 ? 'is-empty' : ''}`}>
          <div className="host-filter-primary-row">
            <Input
              className="host-search-input termous-search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              allowClear
              disabled={data.hosts.length === 0}
              variant="borderless"
              prefix={<Search size={15} aria-hidden="true" />}
              placeholder={t('hosts.searchPlaceholder')}
            />
            <ConnectionActionButton className="host-add-action" onClick={startCreateHost} disabled={actionBusy} icon={<Plus size={16} />}>
              {t('hosts.addHost')}
            </ConnectionActionButton>
          </div>
          {data.hosts.length > 0 ? (
            <>
              <div className="host-filter-meta">
                <span>{t('hosts.filterResult', { count: filteredHosts.length, total: data.hosts.length })}</span>
                {hasFilters ? (
                  <Button
                    type="text"
                    size="small"
                    className="host-filter-clear"
                    onClick={clearFilters}
                    icon={<X size={14} aria-hidden="true" />}
                  >
                    {t('hosts.clearFilters')}
                  </Button>
                ) : null}
              </div>
              {availableTags.length > 0 ? (
                <div className="host-filter-tags" aria-label={t('hosts.allTags')}>
                  {availableTags.map((tag) => (
                    <Tag.CheckableTag
                      key={tag.key}
                      className="host-filter-chip"
                      checked={selectedTagKeys.includes(tag.key)}
                      onChange={(checked) => toggleTagFilter(tag.label, checked)}
                    >
                      <span>{tag.label}</span>
                      <small>{tag.count}</small>
                    </Tag.CheckableTag>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {data.hosts.length === 0 ? (
          <div className="management-empty-slot">
            <EmptyState title={t('app.empty')} />
          </div>
        ) : (
          <>
            {filteredHosts.length === 0 ? (
              <div className="management-empty-slot is-filtered">
                <EmptyState title={t('hosts.noFilterResults')} description={t('hosts.noFilterResultsHint')} />
              </div>
            ) : (
              <div className="data-list host-data-list">
                {filteredHosts.map((host) => {
                  const tags = normalizeHostTags(host.tags ?? [])
                  const visibleTags = tags.slice(0, 2)
                  const hiddenTagCount = tags.length - visibleTags.length

                  return (
                    <button
                      type="button"
                      key={host.id}
                      className={`data-row ${host.id === selectedHostId ? 'is-active' : ''}`}
                      onClick={() => onSelectHost(host.id)}
                    >
                      <HostAvatar host={host} getIconUrl={getHostIconUrl} className="row-icon" size={32} iconSize={16} />
                      <span className="row-copy">
                        <strong>{host.name}</strong>
                        <span className="host-row-meta-line">
                          <small className="host-row-endpoint">{host.username}@{host.address}:{host.port}</small>
                          {tags.length ? (
                            <span className="host-row-tags" aria-label={t('hosts.tags')}>
                              {visibleTags.map((tag) => (
                                <span className="host-row-tag" key={tagKey(tag)}>{tag}</span>
                              ))}
                              {hiddenTagCount > 0 ? <span className="host-row-tag is-count">+{hiddenTagCount}</span> : null}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <span className="row-trailing">
                        <AuthMethodBadge method={host.auth_method} />
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </>
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
        <div className="editor-sections">
          <section className="form-section host-icon-section">
            <div className="host-icon-editor">
              <HostAvatar
                host={{ name: form.name || t('hosts.icon.defaultName'), icon_id: form.icon_id }}
                getIconUrl={getHostIconUrl}
                className="host-icon-preview"
                size={52}
                iconSize={24}
              />
              <div className="host-icon-copy">
                <h3>{t('hosts.icon.title')}</h3>
                <p>{t('hosts.icon.hint')}</p>
                <small>{t('hosts.icon.formats')}</small>
              </div>
              <input
                id="host-icon-upload"
                name="host-icon-upload"
                ref={iconFileInputRef}
                type="file"
                accept={hostIconAccept}
                className="visually-hidden-input"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void uploadIcon(file)
                  }
                }}
              />
              <Button
                className="secondary-button host-icon-upload"
                icon={<ImagePlus size={15} />}
                loading={uploadingIcon}
                disabled={actionBusy}
                onClick={() => iconFileInputRef.current?.click()}
              >
                {t('hosts.icon.upload')}
              </Button>
              <Button
                type="text"
                className="host-icon-remove"
                disabled={!form.icon_id || actionBusy || uploadingIcon}
                onClick={() => void removeIcon()}
              >
                {t('hosts.icon.remove')}
              </Button>
            </div>
          </section>
          <section className="form-section">
            <h3>{t('hosts.list')}</h3>
            <div className="form-grid">
              <Field label={t('hosts.name')} value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
              <CustomSelect
                label={t('hosts.platform.label')}
                value={form.platform}
                options={platformOptions}
                onChange={() => setForm({ ...form, platform: 'linux' })}
              />
              <Field label={t('hosts.address')} value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
              <Field label={t('hosts.username')} value={form.username} onChange={(value) => setForm({ ...form, username: value })} />
              <NumberField
                label={t('hosts.port')}
                value={form.port}
                onChange={(value) => setForm({ ...form, port: Number(value) || 22 })}
              />
              <div className="host-group-field">
                <span className="field-label">{t('hosts.group')}</span>
                <div className="host-group-control">
                  <Select
                    value={form.group_id}
                    classNames={{ popup: { root: 'termous-select-popup' } }}
                    className="termous-select"
                    optionLabelProp="label"
                    onChange={(value) => setForm({ ...form, group_id: value })}
                    options={groupOptions.map((option) => ({
                      value: option.value,
                      label: option.label,
                      title: option.label,
                    }))}
                  />
                  <Button
                    className="secondary-button host-group-create-trigger"
                    icon={<Plus size={15} />}
                    aria-label={t('hosts.addGroup')}
                    disabled={actionBusy || creatingGroup}
                    onClick={() => setGroupCreatorOpen((open) => !open)}
                  />
                </div>
                {groupCreatorOpen ? (
                  <div className="host-group-create-row">
                    <Input
                      value={groupDraft}
                      autoFocus
                      placeholder={t('hosts.groupNamePlaceholder')}
                      disabled={actionBusy || creatingGroup}
                      onChange={(event) => setGroupDraft(event.target.value)}
                      onPressEnter={() => void createGroup()}
                    />
                    <Button
                      className="secondary-button"
                      disabled={!normalizeGroupName(groupDraft) || actionBusy || creatingGroup}
                      loading={creatingGroup}
                      onClick={() => void createGroup()}
                    >
                      {t('app.create')}
                    </Button>
                    <Button
                      type="text"
                      className="host-group-cancel"
                      disabled={creatingGroup}
                      onClick={() => {
                        setGroupCreatorOpen(false)
                        setGroupDraft('')
                      }}
                    >
                      {t('app.cancel')}
                    </Button>
                  </div>
                ) : null}
              </div>
              <CustomSelect
                label={t('hosts.jumpHost')}
                value={form.jump_host_id}
                options={jumpHostOptions}
                onChange={(value) => setForm({ ...form, jump_host_id: value })}
              />
            </div>
          </section>
          <section className="form-section">
            <h3>{t('hosts.authMethod')}</h3>
            <div className="auth-choice-grid">
              {(['system', 'password', 'private_key'] as AuthMethod[]).map((method) => (
                <button
                  key={method}
                  type="button"
                  className={`auth-choice ${form.auth_method === method ? 'is-active' : ''}`}
                  onClick={() =>
                    setForm({
                      ...form,
                      auth_method: method,
                      credential_id: method === 'system' ? '' : form.credential_id,
                    })
                  }
                >
                  <KeyRound size={15} aria-hidden="true" />
                  <span>{method === 'system' ? t('hosts.systemAuth') : t(`hosts.auth.${method}`)}</span>
                </button>
              ))}
            </div>
            <div className="form-grid">
              <CustomSelect
                label={t('hosts.credential')}
                value={form.credential_id}
                options={credentialOptions}
                onChange={(value) => setForm({ ...form, credential_id: value })}
                disabled={form.auth_method === 'system'}
              />
              <label className="field host-tags-field">
                <span className="field-label">{t('hosts.tags')}</span>
                <Select
                  mode="tags"
                  value={form.tags}
                  allowClear
                  tokenSeparators={[',']}
                  classNames={{ popup: { root: 'termous-select-popup' } }}
                  className="termous-select"
                  optionLabelProp="value"
                  placeholder={t('hosts.tagsPlaceholder')}
                  options={tagSelectOptions}
                  onChange={(tags) => setForm({ ...form, tags: normalizeHostTags(tags) })}
                />
              </label>
              <Field label={t('hosts.note')} value={form.note} onChange={(value) => setForm({ ...form, note: value })} />
            </div>
          </section>
        </div>
        <div className="danger-zone">
          <span>{t('hosts.deleteHint')}</span>
          <Popconfirm
            title={t('app.confirmDelete')}
            description={t('hosts.deleteHint')}
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

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number | null) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <InputNumber min={1} max={65535} value={value} onChange={onChange} />
    </label>
  )
}

function validateHostIconFile(file: File, t: (key: string) => string) {
  if (file.size <= 0) {
    return t('hosts.icon.emptyFile')
  }
  if (file.size > maxHostIconBytes) {
    return t('hosts.icon.tooLarge')
  }
  const name = file.name.toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.svg', '.ico'].some((extension) => name.endsWith(extension))) {
    return t('hosts.icon.invalidType')
  }
  return ''
}

function normalizeSearchToken(value: string) {
  return value.trim().toLowerCase()
}

function tagKey(value: string) {
  return value.trim().toLowerCase()
}

function normalizeHostTags(tags: string[]) {
  const result: string[] = []
  const seen = new Set<string>()
  for (const tag of tags) {
    const clean = tag.trim().replace(/\s+/g, ' ')
    const key = tagKey(clean)
    if (!clean || seen.has(key)) {
      continue
    }
    seen.add(key)
    result.push(clean)
  }
  return result
}

function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function buildHostTagOptions(hosts: AppData['hosts']) {
  const tagMap = new Map<string, HostTagOption>()
  for (const host of hosts) {
    const seenInHost = new Set<string>()
    for (const tag of normalizeHostTags(host.tags ?? [])) {
      const key = tagKey(tag)
      if (seenInHost.has(key)) {
        continue
      }
      seenInHost.add(key)
      const existing = tagMap.get(key)
      if (existing) {
        existing.count += 1
      } else {
        tagMap.set(key, { key, label: tag, count: 1 })
      }
    }
  }
  return Array.from(tagMap.values()).sort((left, right) => left.label.localeCompare(right.label))
}

function hostMatchesFilters(
  host: AppData['hosts'][number],
  groupNameById: Map<string, string>,
  searchTokens: string[],
  selectedTagKeys: string[],
) {
  const hostTags = normalizeHostTags(host.tags ?? [])
  const hostTagKeys = new Set(hostTags.map(tagKey))
  if (selectedTagKeys.length > 0 && !selectedTagKeys.every((tag) => hostTagKeys.has(tag))) {
    return false
  }

  if (searchTokens.length === 0) {
    return true
  }

  const searchable = [
    host.name,
    host.address,
    host.username,
    String(host.port),
    host.note ?? '',
    groupNameById.get(host.group_id) ?? '',
    hostTags.join(' '),
  ]
    .join(' ')
    .toLowerCase()

  return searchTokens.every((token) => searchable.includes(token))
}
