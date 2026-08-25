import { Button, Input, Select, Switch } from 'antd'
import { Images, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  HostAvatar,
  buildHostTagOptions,
  normalizeGroupName,
  normalizeHostTags,
} from '#entities/host'
import type { HostAssetInput } from '#entities/host-asset'
import { customSelectStyles } from '#shared/ui'
import type { HostManagementData } from '../model/types.ts'
import styles from './HostManagement.module.scss'

interface HostAssetFormProps {
  data: HostManagementData
  draft: HostAssetInput
  nameError?: string
  disabled: boolean
  getHostIconUrl: (iconId: string) => string
  onChange: (draft: HostAssetInput) => void
  onCreateGroup: HostManagementDataAction['onCreateGroup']
  onManageIcons: () => void
}

interface HostManagementDataAction {
  onCreateGroup: (name: string) => Promise<{ id: string; name: string }>
}

interface HostIconOption {
  value: string
  label: string
  searchText: string
  icon: HostManagementData['hostIcons'][number]
}

export function HostAssetForm({
  data,
  draft,
  nameError,
  disabled,
  getHostIconUrl,
  onChange,
  onCreateGroup,
  onManageIcons,
}: HostAssetFormProps) {
  const { t } = useTranslation()
  const [groupCreatorOpen, setGroupCreatorOpen] = useState(false)
  const [groupDraft, setGroupDraft] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const tagOptions = useMemo(
    () => buildHostTagOptions(data.hosts).map((option) => ({ value: option.label, label: option.label })),
    [data.hosts],
  )
  const hostIconOptions = useMemo<HostIconOption[]>(
    () => data.hostIcons.map((icon) => ({
      value: icon.id,
      label: icon.display_name,
      searchText: `${icon.display_name} ${icon.file_name}`.toLocaleLowerCase(),
      icon,
    })),
    [data.hostIcons],
  )

  const createGroup = async () => {
    const name = normalizeGroupName(groupDraft)
    if (!name) return
    const existing = data.groups.find((group) => (
      normalizeGroupName(group.name).toLocaleLowerCase() === name.toLocaleLowerCase()
    ))
    if (existing) {
      onChange({ ...draft, group_id: existing.id })
      setGroupDraft('')
      setGroupCreatorOpen(false)
      return
    }
    setCreatingGroup(true)
    try {
      const group = await onCreateGroup(name)
      onChange({ ...draft, group_id: group.id })
      setGroupDraft('')
      setGroupCreatorOpen(false)
    } catch {
      return
    } finally {
      setCreatingGroup(false)
    }
  }

  return (
    <div className="host-editor-body">
      <section className="host-editor-section">
        <div className="host-editor-grid">
          <label className="host-editor-field">
            <span className="host-editor-field-label">{t('hosts.name')}</span>
            <Input
              value={draft.name}
              maxLength={80}
              autoFocus
              status={nameError ? 'error' : undefined}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
            />
            {nameError ? <small className="host-editor-field-error" role="alert">{nameError}</small> : null}
          </label>
          <HostSelectField
            label={t('hosts.platform.label')}
            value={draft.platform}
            disabled={disabled}
            options={[{ value: 'linux', label: t('hosts.platform.linux') }]}
            onChange={() => onChange({ ...draft, platform: 'linux' })}
          />
          <div className={`host-editor-field host-icon-select-field is-wide ${styles['is-wide']}`}>
            <span className="host-editor-field-label">
              <span>{t('hosts.icon.title')}</span>
              <Button
                type="text"
                size="small"
                className="host-icon-inline-manage"
                icon={<Images size={12} />}
                disabled={disabled}
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
              disabled={disabled}
              placeholder={t('hosts.iconLibrary.default')}
              className={customSelectStyles.select}
              classNames={{ popup: { root: `${customSelectStyles['select-popup']} ${styles['host-icon-select-popup']}` } }}
              options={hostIconOptions}
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
              onChange={(iconId) => onChange({ ...draft, icon_id: iconId || '' })}
            />
          </div>
          <div className="host-editor-field host-group-editor-field">
            <span className="host-editor-field-label">{t('hosts.group')}</span>
            <div className="host-group-editor-control">
              <Select
                value={draft.group_id}
                disabled={disabled}
                className={customSelectStyles.select}
                classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
                options={[
                  { value: '', label: t('hosts.ungrouped') },
                  ...data.groups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                onChange={(group_id) => onChange({ ...draft, group_id })}
              />
              <Button
                icon={<Plus size={15} />}
                disabled={disabled || creatingGroup}
                aria-label={t('hosts.addGroup')}
                onClick={() => setGroupCreatorOpen((open) => !open)}
              />
            </div>
            {groupCreatorOpen ? (
              <div className="host-group-editor-create">
                <Input
                  value={groupDraft}
                  autoFocus
                  placeholder={t('hosts.groupNamePlaceholder')}
                  disabled={disabled || creatingGroup}
                  onChange={(event) => setGroupDraft(event.target.value)}
                  onPressEnter={() => void createGroup()}
                />
                <Button type="primary" loading={creatingGroup} disabled={!normalizeGroupName(groupDraft) || disabled} onClick={() => void createGroup()}>
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
            disabled={disabled}
            options={tagOptions}
            placeholder={t('hosts.tagsPlaceholder')}
            onChange={(tags) => onChange({ ...draft, tags: normalizeHostTags(tags as string[]) })}
          />
          <label className={`host-editor-field is-wide ${styles['is-wide']}`}>
            <span className="host-editor-field-label">{t('hosts.note')}</span>
            <Input.TextArea
              value={draft.note}
              maxLength={1000}
              autoSize={{ minRows: 3, maxRows: 5 }}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, note: event.target.value })}
            />
          </label>
          <label className={`host-editor-field is-wide ${styles['is-wide']}`}>
            <span className="host-editor-field-label">{t('hosts.access.favorite')}</span>
            <Switch
              checked={draft.favorite}
              disabled={disabled}
              onChange={(favorite) => onChange({ ...draft, favorite })}
            />
            <small className="host-editor-field-hint">{t('hosts.access.favoriteHint')}</small>
          </label>
        </div>
      </section>
    </div>
  )
}

function HostSelectField({
  label,
  value,
  options,
  mode,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string | string[]
  options: Array<{ value: string; label: string }>
  mode?: 'tags'
  placeholder?: string
  disabled: boolean
  onChange: (value: string | string[]) => void
}) {
  return (
    <label className="host-editor-field">
      <span className="host-editor-field-label">{label}</span>
      <Select
        mode={mode}
        value={value}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        maxTagCount={3}
        className={customSelectStyles.select}
        classNames={{ popup: { root: customSelectStyles['select-popup'] } }}
        onChange={onChange}
      />
    </label>
  )
}
