import { Button, Input, InputNumber, Popconfirm, Radio, Select, Tooltip } from 'antd'
import { ArrowLeft, FileKey2, Images, KeyRound, Network, Plus, Save, ServerCog, Settings2, Trash2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HostAvatar,
  type AuthMethod,
  type Host,
  type HostGroup,
  type HostIcon,
  type HostInput,
} from '#entities/host'
import { ConnectionActionButton, customSelectStyles, EditorModeContext, ManagementPanel } from '#shared/ui'
import { connectionProxyTypeLabelKey } from '#entities/connection-proxy'
import {
  normalizeGroupName,
  normalizeHostTags,
  type HostValidationErrors,
} from '#entities/host'
import type { HostManagementData } from '../model/types.ts'
import styles from './HostManagement.module.scss'

interface HostEditorProps {
  data: HostManagementData
  editingHost?: Host
  draft: HostInput
  dirty: boolean
  errors: HostValidationErrors
  actionBusy: boolean
  getHostIconUrl: (iconId: string) => string
  onChange: (patch: Partial<HostInput>) => void
  onBack: () => void
  onSave: () => void
  onDelete: () => void
  onDiscard: () => void
  onCreateGroup: (name: string) => Promise<HostGroup>
  onManageProxies: () => void
  onManageIcons: () => void
}

interface HostIconOption {
  value: string
  label: string
  searchText: string
  icon: HostIcon
}

export function HostEditor({
  data,
  editingHost,
  draft,
  dirty,
  errors,
  actionBusy,
  getHostIconUrl,
  onChange,
  onBack,
  onSave,
  onDelete,
  onDiscard,
  onCreateGroup,
  onManageProxies,
  onManageIcons,
}: HostEditorProps) {
  const { t } = useTranslation()
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false)
  const [groupDraft, setGroupDraft] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const credentialOptions = useMemo(() => {
    const type = draft.auth_method === 'password' ? 'password' : 'private_key'
    return data.credentials
      .filter((credential) => credential.type === type)
      .map((credential) => ({ value: credential.id, label: credential.name }))
  }, [data.credentials, draft.auth_method])
  const jumpHostOptions = useMemo(
    () => data.hosts
      .filter((host) => host.id !== editingHost?.id)
      .map((host) => ({ value: host.id, label: host.name, title: `${host.username}@${host.address}:${host.port}` })),
    [data.hosts, editingHost?.id],
  )
  const tagOptions = useMemo(
    () => Array.from(new Set(data.hostAssets.flatMap((host) => host.tags ?? []))).map((tag) => ({ value: tag, label: tag })),
    [data.hostAssets],
  )
  const hostIconOptions = useMemo<HostIconOption[]>(
    () => data.hostIcons.map((icon) => ({
      value: icon.id,
      label: icon.display_name,
      searchText: `${icon.display_name}\n${icon.file_name}`.toLocaleLowerCase(),
      icon,
    })),
    [data.hostIcons],
  )
  const hasErrors = Object.values(errors).some(Boolean)
  const visibleErrors = dirty ? errors : {}
  const displayName = draft.name.trim()
    || draft.address.trim()
    || editingHost?.name.trim()
    || t('hosts.newHost')

  const changeAuthMethod = (authMethod: AuthMethod) => {
    const expectedType = authMethod === 'password' ? 'password' : 'private_key'
    const currentCredential = data.credentials.find((credential) => credential.id === draft.credential_id)
    onChange({
      auth_method: authMethod,
      credential_id: currentCredential?.type !== expectedType ? '' : draft.credential_id,
    })
  }

  const createGroup = async () => {
    const name = normalizeGroupName(groupDraft)
    if (!name) {
      return
    }
    const existing = data.groups.find((group) => normalizeGroupName(group.name).toLocaleLowerCase() === name.toLocaleLowerCase())
    if (existing) {
      onChange({ group_id: existing.id })
      setGroupDraft('')
      setGroupCreatorOpen(false)
      return
    }
    setCreatingGroup(true)
    try {
      const group = await onCreateGroup(name)
      onChange({ group_id: group.id })
      setGroupDraft('')
      setGroupCreatorOpen(false)
    } catch {
      return
    } finally {
      setCreatingGroup(false)
    }
  }

  return (
    <ManagementPanel
      className="host-editor"
      bodyClassName="host-editor-body"
      header={(
        <div className="host-editor-heading">
          <Button type="text" className="host-editor-back" icon={<ArrowLeft size={17} />} aria-label={t('hosts.backToList')} onClick={onBack} />
          <HostAvatar host={{ name: displayName, icon_id: draft.icon_id }} getIconUrl={getHostIconUrl} size={44} iconSize={21} />
          <EditorModeContext
            className="host-editor-title"
            mode={editingHost ? 'edit' : 'create'}
            label={t(editingHost ? 'app.edit' : 'app.add')}
            title={<Tooltip title={displayName}><h2>{displayName}</h2></Tooltip>}
          />
          {dirty || editingHost ? (
            <span className={`host-editor-state ${dirty ? `is-dirty ${styles['is-dirty']}` : ''}`}>
              {dirty ? t('hosts.unsaved') : t('hosts.saved')}
            </span>
          ) : null}
        </div>
      )}
      footer={(
        <div className="host-editor-footer-actions">
          {editingHost ? (
            <Popconfirm
              title={t('app.confirmDelete')}
              description={t('hosts.deleteHint')}
              okText={t('app.delete')}
              cancelText={t('app.cancel')}
              disabled={actionBusy}
              rootClassName={`host-popconfirm ${styles.popconfirm}`}
              onConfirm={onDelete}
            >
              <Button danger icon={<Trash2 size={15} />} disabled={actionBusy}>{t('app.delete')}</Button>
            </Popconfirm>
          ) : null}
          <span className="host-editor-footer-spacer" />
          <Button disabled={!dirty || actionBusy} onClick={onDiscard}>{t('hosts.discard')}</Button>
          <ConnectionActionButton
            disabled={!dirty || hasErrors || actionBusy}
            loading={actionBusy}
            icon={editingHost ? <Save size={15} /> : <Plus size={15} />}
            onClick={onSave}
          >
            {t(editingHost ? 'app.save' : 'app.create')}
          </ConnectionActionButton>
        </div>
      )}
    >
      <HostEditorSection icon={<ServerCog size={16} />} title={t('hosts.basicSection')}>
        <div className="host-editor-grid">
          <HostTextField label={t('hosts.name')} value={draft.name} hint={t('hosts.nameHint')} onChange={(name) => onChange({ name })} />
          <HostSelectField label={t('hosts.platform.label')} value={draft.platform} options={[{ value: 'linux', label: t('hosts.platform.linux') }]} onChange={() => onChange({ platform: 'linux' })} />
          <div className={`host-editor-field host-icon-select-field is-wide ${styles['is-wide']}`}>
            <span className="host-editor-field-label">
              <span>{t('hosts.icon.title')}</span>
              <Button
                type="text"
                size="small"
                className="host-icon-inline-manage"
                aria-haspopup="dialog"
                icon={<Images size={12} aria-hidden="true" />}
                onClick={onManageIcons}
              >
                {t('hosts.iconLibrary.manage')}
              </Button>
            </span>
            <Select<string, HostIconOption>
              value={draft.icon_id || undefined}
              allowClear
              showSearch
              virtual={false}
              aria-label={t('hosts.iconLibrary.select')}
              placeholder={t('hosts.iconLibrary.default')}
              className={customSelectStyles.select}
              classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${styles['host-icon-select-popup']}` } }}
              options={hostIconOptions}
              notFoundContent={t('hosts.iconLibrary.empty')}
              filterOption={(input, option) => option?.searchText.includes(input.trim().toLocaleLowerCase()) ?? false}
              optionRender={(option) => (
                <span className={styles['host-icon-select-option']}>
                  <HostAvatar
                    host={{ name: option.data.icon.display_name, icon_id: option.data.icon.id }}
                    getIconUrl={getHostIconUrl}
                    size={30}
                    iconSize={15}
                    loading="lazy"
                  />
                  <span className={styles['host-icon-select-option-copy']}>
                    <strong>{option.data.icon.display_name}</strong>
                    <small>{option.data.icon.file_name}</small>
                  </span>
                </span>
              )}
              onChange={(iconId) => onChange({ icon_id: iconId || '' })}
            />
          </div>
          <div className="host-editor-field host-group-editor-field">
            <span className="host-editor-field-label">{t('hosts.group')}</span>
            <div className="host-group-editor-control">
              <Select
                value={draft.group_id}
                className={customSelectStyles.select}
                classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
                options={[
                  { value: '', label: t('hosts.ungrouped') },
                  ...data.groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                onChange={(group_id) => onChange({ group_id })}
              />
              <Tooltip title={t('hosts.addGroup')}>
                <Button icon={<Plus size={15} />} disabled={actionBusy || creatingGroup} aria-label={t('hosts.addGroup')} onClick={() => setGroupCreatorOpen((open) => !open)} />
              </Tooltip>
            </div>
            {groupCreatorOpen ? (
              <div className="host-group-editor-create">
                <Input
                  value={groupDraft}
                  autoFocus
                  placeholder={t('hosts.groupNamePlaceholder')}
                  disabled={actionBusy || creatingGroup}
                  onChange={(event) => setGroupDraft(event.target.value)}
                  onPressEnter={() => void createGroup()}
                />
                <Button type="primary" loading={creatingGroup} disabled={!normalizeGroupName(groupDraft) || actionBusy} onClick={() => void createGroup()}>
                  {t('app.create')}
                </Button>
                <Button type="text" disabled={creatingGroup} onClick={() => { setGroupCreatorOpen(false); setGroupDraft('') }}>
                  {t('app.cancel')}
                </Button>
              </div>
            ) : null}
          </div>
          <HostSelectField
            label={t('hosts.tags')}
            value={draft.tags}
            mode="tags"
            options={tagOptions}
            placeholder={t('hosts.tagsPlaceholder')}
            onChange={(tags) => onChange({ tags: normalizeHostTags(tags as string[]) })}
          />
          <label className={`host-editor-field is-wide ${styles['is-wide']}`}>
            <span className="host-editor-field-label">{t('hosts.note')}</span>
            <Input.TextArea value={draft.note} autoSize={{ minRows: 3, maxRows: 5 }} onChange={(event) => onChange({ note: event.target.value })} />
          </label>
        </div>
      </HostEditorSection>

      <HostEditorSection icon={<Settings2 size={16} />} title={t('hosts.accessSection')}>
        <div className="host-access-layout">
          <section className="host-access-pane is-connection">
            <div className="host-access-pane-title"><Network size={16} /><h4>{t('hosts.connectionSection')}</h4></div>
            <div className={`host-editor-grid is-connection ${styles['is-connection']}`}>
              <HostTextField label={t('hosts.address')} value={draft.address} error={visibleErrors.address} onChange={(address) => onChange({ address })} />
              <label className="host-editor-field is-port">
                <span className="host-editor-field-label">{t('hosts.port')}</span>
                <InputNumber
                  min={1}
                  max={65535}
                  value={draft.port}
                  status={visibleErrors.port ? 'error' : undefined}
                  onChange={(port) => onChange({ port: Number(port) || 0 })}
                />
                {visibleErrors.port ? <small className="host-editor-field-error">{visibleErrors.port}</small> : null}
              </label>
              <HostTextField label={t('hosts.username')} value={draft.username} error={visibleErrors.username} onChange={(username) => onChange({ username })} />
              <HostSelectField
                label={t('hosts.jumpHost')}
                value={draft.jump_host_id}
                options={[{ value: '', label: t('hosts.noJumpHost') }, ...jumpHostOptions]}
                onChange={(jump_host_id) => onChange({ jump_host_id: jump_host_id as string })}
              />
              <div className={`host-editor-field is-wide host-proxy-select-field ${styles['is-wide']}`}>
                <span className="host-editor-field-label">
                  <span>{t('hosts.proxy')}</span>
                  <Button
                    type="text"
                    size="small"
                    className="host-proxy-inline-manage"
                    aria-haspopup="dialog"
                    icon={<Network size={12} aria-hidden="true" />}
                    onClick={onManageProxies}
                  >
                    {t('proxies.manage')}
                  </Button>
                </span>
                <Select
                  id="host-connection-proxy"
                  value={draft.proxy_id}
                  className={customSelectStyles.select}
                  classNames={{ popup: { root: `${customSelectStyles['select-popup']} host-proxy-select-popup ${styles['proxy-select-popup']}` } }}
                  status={visibleErrors.proxyId ? 'error' : undefined}
                  options={[
                    { value: '', label: t('hosts.noProxy') },
                    ...data.proxies.map((proxy) => ({
                      value: proxy.id,
                      label: proxy.name,
                      title: proxy.url,
                      proxy,
                    })),
                  ]}
                  optionRender={(option) => {
                    const proxy = 'proxy' in option.data ? option.data.proxy : undefined
                    if (!proxy) {
                      return option.label
                    }
                    return (
                      <span className="host-proxy-option">
                        <strong>{proxy.name}</strong>
                        <small>{t(connectionProxyTypeLabelKey(proxy.type))} · {proxy.url}</small>
                      </span>
                    )
                  }}
                  onChange={(proxy_id) => onChange({ proxy_id })}
                />
                {visibleErrors.proxyId ? <small className="host-editor-field-error">{visibleErrors.proxyId}</small> : null}
              </div>
            </div>
          </section>
          <section className="host-access-pane is-authentication">
            <div className="host-access-pane-title"><KeyRound size={16} /><h4>{t('hosts.authSection')}</h4></div>
            <Radio.Group
              className="host-auth-methods"
              value={draft.auth_method}
              onChange={(event) => changeAuthMethod(event.target.value as AuthMethod)}
            >
              <Radio.Button value="password"><KeyRound size={15} /><span>{t('hosts.auth.password')}</span></Radio.Button>
              <Radio.Button value="private_key"><FileKey2 size={15} /><span>{t('hosts.auth.private_key')}</span></Radio.Button>
            </Radio.Group>
            <div className="host-auth-selection">
              <HostSelectField
                label={t('hosts.credential')}
                value={draft.credential_id}
                options={[{ value: '', label: t('fields.none') }, ...credentialOptions]}
                error={visibleErrors.credentialId}
                onChange={(credential_id) => onChange({ credential_id: credential_id as string })}
              />
            </div>
          </section>
        </div>
      </HostEditorSection>
    </ManagementPanel>
  )
}

function HostEditorSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="host-editor-section">
      <div className="host-editor-section-title"><span>{icon}</span><h3>{title}</h3></div>
      {children}
    </section>
  )
}

function HostTextField({ label, value, hint, error, onChange }: { label: string; value: string; hint?: string; error?: string; onChange: (value: string) => void }) {
  return (
    <label className="host-editor-field">
      <span className="host-editor-field-label">{label}</span>
      <Input value={value} status={error ? 'error' : undefined} onChange={(event) => onChange(event.target.value)} />
      {error ? <small className="host-editor-field-error">{error}</small> : hint ? <small className="host-editor-field-hint">{hint}</small> : null}
    </label>
  )
}

interface HostSelectFieldProps {
  label: string
  value: string | string[]
  options: Array<{ value: string; label: string; title?: string }>
  mode?: 'tags'
  placeholder?: string
  error?: string
  onChange: (value: string | string[]) => void
}

function HostSelectField({ label, value, options, mode, placeholder, error, onChange }: HostSelectFieldProps) {
  return (
    <label className="host-editor-field">
      <span className="host-editor-field-label">{label}</span>
      <Select
        mode={mode}
        value={value}
        options={options}
        placeholder={placeholder}
        status={error ? 'error' : undefined}
        className={customSelectStyles.select}
        classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
        maxTagCount={3}
        onChange={onChange}
      />
      {error ? <small className="host-editor-field-error">{error}</small> : null}
    </label>
  )
}
