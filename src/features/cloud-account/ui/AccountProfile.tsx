import { useEffect, useRef, useState } from 'react'
import { Alert, Avatar, Button, Form, Input, Popconfirm } from 'antd'
import { Camera, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudProfile, CloudProfileFields, CloudProfilePatch } from '#common/contracts'
import { prepareAvatar } from '../model/avatar'
import { WorkspaceEmptyState } from '#shared/ui'
import { AccountLoading, AccountSection } from './AccountSection'
import styles from './AccountProfile.module.scss'
import shared from './CloudAccount.module.scss'

interface Props {
  profile?: CloudProfile
  email?: string
  loading: boolean
  error?: string
  reload: () => Promise<CloudProfile | undefined>
  save: (patch: CloudProfilePatch) => Promise<CloudProfile | undefined>
}

const fields = ['name', 'bio', 'organization', 'avatar'] as const
interface ProfileDraft { base: CloudProfile; fields: CloudProfileFields }
const createDraft = (base: CloudProfile): ProfileDraft => ({ base, fields: { name: base.name, bio: base.bio, organization: base.organization, avatar: base.avatar } })
const isDirty = (draft?: ProfileDraft) => Boolean(draft && fields.some((key) => draft.base[key] !== draft.fields[key]))

export function AccountProfile({ profile, email, loading, error, reload, save }: Props) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState<ProfileDraft>()
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const imageVersion = useRef(0)
  const lifetime = useRef(0)
  useEffect(() => {
    const images = imageVersion
    const scope = lifetime
    scope.current++
    images.current++
    setImageBusy(false)
    setImageError(undefined)
    setSaved(false)
    return () => { images.current++; scope.current++ }
  }, [profile?.user_id])
  useEffect(() => {
    // 后台快照可以更新账号展示，但草稿必须保留编辑时的版本以继续检测冲突。
    setEditing((current) => !profile ? undefined : current?.base.user_id === profile.user_id && (isDirty(current) || imageBusy) ? current : createDraft(profile))
  }, [profile, imageBusy])
  const draft = editing?.fields
  const dirty = isDirty(editing)
  const canSave = dirty && !loading && !imageBusy && Boolean(draft && [...draft.name].length <= 64 && [...draft.organization].length <= 100 && [...draft.bio].length <= 200)
  const edit = (patch: Partial<CloudProfileFields>) => { setEditing((value) => value && { ...value, fields: { ...value.fields, ...patch } }); setSaved(false) }
  const replace = async (request: () => Promise<CloudProfile | undefined>, saved: boolean) => {
    const scope = lifetime.current
    const value = await request()
    if (value && scope === lifetime.current) {
      setEditing(createDraft(value)); setSaved(saved); setImageError(undefined)
    }
  }
  const choose = async (file?: File) => {
    if (!file || loading || imageBusy) return
    const version = ++imageVersion.current
    setImageBusy(true); setImageError(undefined); setSaved(false)
    try {
      const avatar = await prepareAvatar(file)
      if (version === imageVersion.current) edit({ avatar })
    } catch (cause) {
      if (version === imageVersion.current) setImageError(cause instanceof Error ? cause.message : 'avatar_invalid')
    } finally { if (version === imageVersion.current) setImageBusy(false) }
  }
  const failure = imageError ?? error
  return <AccountSection title={t('cloud.tabs.profile')} icon={<UserRound size={18} />} description={t('cloud.profile.privateHint')}>
    {failure ? <Alert type="warning" showIcon title={t(`cloud.errors.${failure}`, { defaultValue: t('cloud.operationFailed') })} /> : null}
    {!profile || !draft || !editing ? loading ? <AccountLoading /> : <WorkspaceEmptyState className={shared.empty} icon={<UserRound size={20} />} title={t('cloud.profile.unavailable')} action={<Button onClick={() => void reload()}>{t('cloud.retry')}</Button>} /> : <Form className={styles.form} layout="horizontal" labelAlign="left" colon={false} disabled={loading || imageBusy} onFinish={() => {
      // 键盘提交也必须经过相同检查，不能仅依赖保存按钮的禁用状态。
      if (canSave) void replace(() => save({ ...draft, expected_revision: editing.base.revision }), true)
    }}>
      <div className={styles['avatar-row']} role="group" aria-labelledby="cloud-profile-avatar-label">
        <span id="cloud-profile-avatar-label" className={styles.label}>{t('cloud.profile.avatarLabel')}</span>
        <div className={styles['avatar-control']}>
          <Avatar className={styles.avatar} size={56} src={draft.avatar || undefined} icon={<UserRound size={25} />} />
          <div className={styles['avatar-options']}>
            <div className={shared.actions}>
              <Button size="small" icon={<Camera size={14} />} loading={imageBusy} onClick={() => input.current?.click()}>{t('cloud.profile.chooseAvatar')}</Button>
              <Button size="small" type="text" disabled={!draft.avatar || loading || imageBusy} onClick={() => edit({ avatar: '' })}>{t('cloud.profile.removeAvatar')}</Button>
            </div>
            <p className={shared.hint}>{t('cloud.profile.avatarHint')}</p>
          </div>
          <input className={styles['file-input']} ref={input} type="file" accept="image/png,image/jpeg" hidden aria-label={t('cloud.profile.chooseAvatar')} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choose(file) }} />
        </div>
      </div>
      <Form.Item label={t('cloud.profile.name')} htmlFor="cloud-profile-name"><Input id="cloud-profile-name" value={draft.name} count={{ show: true, max: 64, strategy: (value) => [...value].length }} onChange={(event) => edit({ name: event.target.value })} placeholder={email} /></Form.Item>
      <Form.Item label={t('cloud.profile.organization')} htmlFor="cloud-profile-organization"><Input id="cloud-profile-organization" value={draft.organization} count={{ show: true, max: 100, strategy: (value) => [...value].length }} onChange={(event) => edit({ organization: event.target.value })} /></Form.Item>
      <Form.Item label={t('cloud.profile.bio')} htmlFor="cloud-profile-bio"><Input.TextArea id="cloud-profile-bio" value={draft.bio} autoSize={{ minRows: 3, maxRows: 6 }} count={{ show: true, max: 200, strategy: (value) => [...value].length }} onChange={(event) => edit({ bio: event.target.value })} /></Form.Item>
      <div className={styles.footer}>
        <span className={`${shared.hint} ${saved && !dirty ? styles.saved : ''}`} role="status">{saved && !dirty ? t('cloud.profile.saved') : dirty ? t('cloud.profile.unsaved') : t('cloud.profile.editHint')}</span>
        <div className={shared.actions}>
          <Popconfirm disabled={!dirty} title={t('cloud.profile.discard')} onConfirm={() => void replace(reload, false)}><Button disabled={loading || imageBusy} onClick={() => { if (!dirty) void replace(reload, false) }}>{t('cloud.profile.reload')}</Button></Popconfirm>
          <Button type="primary" htmlType="submit" loading={loading} disabled={!canSave}>{t('cloud.profile.save')}</Button>
        </div>
      </div>
    </Form>}
  </AccountSection>
}
