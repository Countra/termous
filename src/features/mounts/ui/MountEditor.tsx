import { useState } from 'react'
import { Button, Collapse, Form, Input, InputNumber, Modal, Select, Switch } from 'antd'
import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { projectFileAccessProfile } from '#entities/file-access-profile'
import type { MountInput, MountProfile } from '#entities/mount'
import { getTermousBridge } from '#shared/bridge'
import type { MountWorkspaceProps } from '../model/types'
import styles from './Mounts.module.scss'

interface Props extends Pick<MountWorkspaceProps, 'environment' | 'fileProfiles' | 'hosts'> {
  profile?: MountProfile
  temporary: boolean
  busy: boolean
  onClose: () => void
  onSubmit: (input: MountInput) => void
  onError: (error: unknown) => void
}

export function MountEditor({ profile, temporary, environment, fileProfiles, hosts, busy, onClose, onSubmit, onError }: Props) {
  const { t } = useTranslation()
  const platform = environment?.platform ?? ''
  const [form] = Form.useForm<MountInput>()
  const [picking, setPicking] = useState(false)
  const defaults: MountInput = {
    name: profile?.name ?? '', description: profile?.description ?? '',
    file_profile_id: profile?.file_profile_id ?? '', target_os: platform,
    mount_point: profile?.target_os === platform ? profile.mount_point : '',
    volume_name: profile?.volume_name ?? '', read_only: profile?.read_only ?? false,
    case_sensitive: profile?.target_os === platform ? profile.case_sensitive : platform !== 'windows',
    attribute_ttl_seconds: profile?.attribute_ttl_seconds ?? 5,
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
  const source = fileProfiles.find((item) => item.id === selected)
  const summary = source ? projectFileAccessProfile(source).endpoint : undefined
  const pick = async () => {
    setPicking(true)
    try {
      const selected = await getTermousBridge()?.files?.pickDirectory()
      if (selected?.[0]) form.setFieldValue('mount_point', selected[0])
    } catch (error) { onError(error) } finally { setPicking(false) }
  }
  return (
    <Modal open centered width={620} title={t(temporary ? 'mounts.temporary' : profile ? 'mounts.edit' : 'mounts.create')}
      className={styles.editor} rootClassName="termous-modal-root" destroyOnHidden
      mask={{ closable: !busy }} keyboard={!busy} closable={!busy}
      onCancel={onClose} onOk={() => form.submit()} confirmLoading={busy}
      okText={t(temporary ? 'mounts.start' : 'app.save')} cancelText={t('app.cancel')}>
      <Form form={form} layout="vertical" initialValues={defaults} onFinish={(value) => onSubmit({ ...defaults, ...value, target_os: platform, expected_updated_at: profile?.updated_at })}>
        <Form.Item name="name" label={t('mounts.name')} rules={[{ required: true, whitespace: true, max: 80, message: t('mounts.nameRequired') }]}><Input maxLength={80} autoFocus /></Form.Item>
        <Form.Item name="file_profile_id" label={t('mounts.source')} rules={[{ required: true, message: t('mounts.sourceRequired') }]} extra={summary}>
          <Select showSearch={{ optionFilterProp: 'label' }} options={groups} placeholder={t('mounts.sourceRequired')} />
        </Form.Item>
        <Form.Item label={t(platform === 'windows' ? 'mounts.drive' : 'mounts.directory')} htmlFor="mount_point" required>
          <div className={styles.location}>
            <Form.Item name="mount_point" noStyle rules={[{ required: true, message: t('mounts.locationRequired') }]}>
              {platform === 'windows' ? <Select options={[...new Set([...(environment?.free_drives ?? []), ...(defaults.mount_point ? [defaults.mount_point] : [])])].map((value) => ({ value, label: value }))} placeholder={t('mounts.locationRequired')} /> : <Input placeholder="/path/to/empty-directory" />}
            </Form.Item>
            {platform !== 'windows' && getTermousBridge()?.files ? <Button icon={<FolderOpen size={16} />} onClick={() => void pick()} loading={picking} aria-label={t('mounts.chooseDirectory')} /> : null}
          </div>
        </Form.Item>
        <Form.Item name="description" label={t('mounts.description')}><Input.TextArea rows={2} maxLength={1024} /></Form.Item>
        <div className={styles.switches}>
          <label><span>{t('mounts.readOnly')}</span><Form.Item name="read_only" valuePropName="checked" noStyle><Switch /></Form.Item></label>
          {!temporary ? <label><span>{t('mounts.autoStart')}<small>{t('mounts.autoStartHint')}</small></span><Form.Item name="auto_start" valuePropName="checked" noStyle><Switch /></Form.Item></label> : null}
        </div>
        <Collapse ghost items={[{ key: 'advanced', label: t('mounts.advanced'), children: <>
          <Form.Item name="volume_name" label={t('mounts.volume')} rules={[{ max: 32, message: t('mounts.volumeLimit') }]}><Input maxLength={32} placeholder={t('mounts.volumeDefault')} /></Form.Item>
          <Form.Item name="case_sensitive" label={t('mounts.caseSensitive')} valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="attribute_ttl_seconds" label={t('mounts.refreshInterval')} rules={[{ required: true }]}><InputNumber min={1} max={300} precision={0} suffix={t('mounts.seconds')} /></Form.Item>
        </> }]} />
        <p className={styles.hint}>{t('mounts.nextStartOnly')}</p>
      </Form>
    </Modal>
  )
}
