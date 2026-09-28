import { useRef, useState } from 'react'
import { Button, Collapse, Form, Input, Modal, Select, Switch, Tooltip } from 'antd'
import { FolderOpen, FolderTree, HardDrive, Play, Plus, Save, Settings2, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { projectFileAccessProfile } from '#entities/file-access-profile'
import type { FileAccessProfile } from '#entities/file-access-profile'
import type { MountInput, MountProfile } from '#entities/mount'
import { getTermousBridge } from '#shared/bridge'
import { customSelectStyles, EditorModeContext } from '#shared/ui'
import type { MountWorkspaceProps } from '../model/types'
import styles from './Mounts.module.scss'
import { MountAdvancedOptions } from './MountAdvancedOptions'

interface Props extends Pick<MountWorkspaceProps, 'environment' | 'fileProfiles' | 'hosts'> {
  profile?: MountProfile
  temporary: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (input: MountInput) => void
  onError: (error: unknown) => void
}

function suggestedMountName(source: FileAccessProfile) {
  const prefix = 'Termous - '
  const sourceName = source.name.replace(/[<>:"/\\|?*,=\p{Cc}]/gu, ' ').replace(/\s+/gu, ' ').trim() || source.id
  let name = prefix
  for (const character of sourceName) {
    if (name.length + character.length > 80) break
    name += character
  }
  return name.trimEnd()
}

export function MountEditor({ profile, temporary, environment, fileProfiles, hosts, busy, onClose, onSubmit, onError }: Props) {
  const { t } = useTranslation()
  const platform = environment?.platform ?? ''
  const [form] = Form.useForm<MountInput>()
  const [picking, setPicking] = useState(false)
  const nameEdited = useRef(false)
  const defaults: MountInput = {
    name: profile?.name ?? '', description: profile?.description ?? '',
    file_profile_id: profile?.file_profile_id ?? '', target_os: platform,
    mount_point: profile?.target_os === platform ? profile.mount_point : '',
    volume_name: profile?.volume_name ?? '', read_only: profile?.read_only ?? false,
    case_sensitive: profile?.target_os === platform ? profile.case_sensitive : platform !== 'windows',
    attribute_ttl_seconds: profile?.attribute_ttl_seconds ?? 5,
    directory_ttl_seconds: profile?.directory_ttl_seconds ?? 60,
    metadata_concurrency: profile?.metadata_concurrency ?? 0,
    auto_start: profile?.auto_start ?? false,
  }
  const groups = [...hosts, { id: '', name: t('mounts.unassigned') }].map((host) => ({
    label: host.name,
    options: fileProfiles.filter((item) => (item.host_id ?? '') === host.id).map((item) => {
      const projection = projectFileAccessProfile(item)
      return { value: item.id, label: `${item.name} · ${projection.technology.label}`, title: projection.endpoint ?? item.name }
    }),
  })).filter((group) => group.options.length > 0)
  const selected = Form.useWatch('file_profile_id', form)
  const name = Form.useWatch('name', form)
  const source = fileProfiles.find((item) => item.id === selected)
  const summary = source ? projectFileAccessProfile(source).endpoint : undefined
  const selectSource = (value: string) => {
    if (profile || nameEdited.current) return
    const nextSource = fileProfiles.find((item) => item.id === value)
    if (nextSource) form.setFieldValue('name', suggestedMountName(nextSource))
  }
  const canPick = platform !== 'windows' && Boolean(getTermousBridge()?.files)
  const pick = async () => {
    setPicking(true)
    try {
      const selected = await getTermousBridge()?.files?.pickDirectory()
      if (selected?.[0]) form.setFieldValue('mount_point', selected[0])
    } catch (error) { onError(error) } finally { setPicking(false) }
  }
  return (
    <Modal open centered width={640}
      title={temporary ? <span className={styles['editor-title']}><span className={styles['editor-title-icon']} aria-hidden="true"><Play size={17} /></span>{t('mounts.temporary')}</span>
        : <EditorModeContext mode={profile ? 'edit' : 'create'} label={t(profile ? 'app.edit' : 'app.add')}
          title={<span className={styles['editor-profile-title']}>{name?.trim() || profile?.name || t('mounts.configuration')}</span>} />}
      className={styles.editor} rootClassName="termous-modal-root" destroyOnHidden
      mask={{ closable: !busy }} keyboard={!busy} closable={!busy}
      onCancel={() => { if (!busy) onClose() }}
      footer={<div className={styles['editor-footer']}>
        <Button disabled={busy} onClick={onClose}>{t('app.cancel')}</Button>
        <Button type="primary" icon={temporary ? <Play size={15} /> : profile ? <Save size={15} /> : <Plus size={15} />}
          loading={busy} onClick={() => form.submit()}>{t(temporary ? 'mounts.start' : profile ? 'app.save' : 'app.create')}</Button>
      </div>}>
      <Form form={form} layout="vertical" requiredMark={false} className={styles['editor-form']}
        initialValues={defaults} onFinish={(value) => onSubmit({ ...defaults, ...value, target_os: platform, expected_updated_at: profile?.updated_at })}>
        <section className={styles['editor-section']}>
          <div className={styles['editor-section-heading']}><span className={styles['editor-section-icon']}><FolderTree size={15} aria-hidden="true" /></span><h3>{t('mounts.sourceSection')}</h3></div>
          <Form.Item name="file_profile_id" label={t('mounts.source')} rules={[{ required: true, message: t('mounts.sourceRequired') }]} extra={summary ? <span className={styles['source-endpoint']}>{summary}</span> : undefined}>
            <Select showSearch={{ optionFilterProp: 'label' }} options={groups} placeholder={t('mounts.sourceRequired')} disabled={busy} autoFocus onChange={selectSource}
              className={`${customSelectStyles.select} termous-select`}
              classNames={{ popup: { root: `${customSelectStyles['select-popup']} termous-select-popup` } }} />
          </Form.Item>
          <Form.Item name="name" label={t('mounts.name')} rules={[{ required: true, whitespace: true, max: 80, message: t('mounts.nameRequired') }]}>
            <Input maxLength={80} disabled={busy} placeholder={t('mounts.namePlaceholder')} onChange={() => { nameEdited.current = true }} />
          </Form.Item>
        </section>

        <section className={styles['editor-section']}>
          <div className={styles['editor-section-heading']}><span className={styles['editor-section-icon']}><HardDrive size={15} aria-hidden="true" /></span><h3>{t('mounts.locationSection')}</h3></div>
          <Form.Item label={t(platform === 'windows' ? 'mounts.drive' : 'mounts.directory')} htmlFor="mount_point" required>
            <div className={styles.location}>
              <Form.Item name="mount_point" noStyle rules={[{ required: true, message: t('mounts.locationRequired') }]}>
                {platform === 'windows' ? <Select options={(environment?.free_drives ?? []).map((value) => ({ value, label: value }))} placeholder={t('mounts.locationRequired')} disabled={busy}
                  className={`${customSelectStyles.select} termous-select`}
                  classNames={{ popup: { root: `${customSelectStyles['select-popup']} termous-select-popup` } }} />
                  : <Input placeholder="/path/to/empty-directory" disabled={busy} />}
              </Form.Item>
              {canPick ? <Tooltip title={t('mounts.chooseDirectory')}><Button icon={<FolderOpen size={16} />} onClick={() => void pick()} loading={picking} disabled={busy} aria-label={t('mounts.chooseDirectory')} /></Tooltip> : null}
            </div>
          </Form.Item>
          <p className={styles['location-hint']}>{t(platform === 'windows' ? 'mounts.locationHintDrive' : 'mounts.locationHint')}</p>
          <div className={styles.switches}>
            <div className={styles['switch-row']}><span>{t('mounts.readOnly')}</span><Form.Item name="read_only" valuePropName="checked" noStyle><Switch aria-label={t('mounts.readOnly')} disabled={busy} /></Form.Item></div>
            {!temporary ? <div className={styles['switch-row']}><span>{t('mounts.autoStart')}<small>{t('mounts.autoStartHint')}</small></span><Form.Item name="auto_start" valuePropName="checked" noStyle><Switch aria-label={t('mounts.autoStart')} disabled={busy} /></Form.Item></div> : null}
          </div>
        </section>

        <section className={styles['editor-section']}>
          <div className={styles['editor-section-heading']}><span className={styles['editor-section-icon']}><Settings2 size={15} aria-hidden="true" /></span><h3>{t('mounts.detailsSection')}</h3></div>
          <Form.Item name="description" label={t('mounts.description')} rules={[{
            validator: async (_, value: string | undefined) => {
              if (value && new TextEncoder().encode(value.trim()).byteLength > 1024) {
                throw new Error(t('mounts.descriptionTooLong'))
              }
            },
          }]}><Input.TextArea rows={2} maxLength={1024} disabled={busy} /></Form.Item>
          <Collapse bordered={false} expandIconPlacement="end" className={styles['advanced-collapse']}
            items={[{ key: 'advanced', label: <span className={styles['advanced-label']}><SlidersHorizontal size={15} aria-hidden="true" />{t('mounts.advanced')}</span>, children: <MountAdvancedOptions busy={busy} /> }]} />
        </section>
        {profile ? <p className={styles['editor-note']}>{t(platform === 'windows' ? 'mounts.nextStartOnlyDrive' : 'mounts.nextStartOnly')}</p> : null}
      </Form>
    </Modal>
  )
}
