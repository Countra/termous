import { useEffect, useRef, useState } from 'react'
import { Alert, Avatar, Button, Form, Input, Popconfirm, Spin } from 'antd'
import { Camera, UserRound } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { CloudProfile, CloudProfileFields, CloudProfilePatch } from '#common/contracts'
import { prepareAvatar } from '../model/avatar'
import styles from './AccountProfile.module.scss'
import shared from './CloudAccount.module.scss'

interface Props {
  profile?: CloudProfile
  email?: string
  loading: boolean
  error?: string
  reload: () => Promise<void>
  save: (patch: CloudProfilePatch) => Promise<boolean>
}

export function AccountProfile({ profile, email, loading, error, reload, save }: Props) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<CloudProfileFields>()
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string>()
  const [saved, setSaved] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const imageVersion = useRef(0)
  useEffect(() => {
    const images = imageVersion
    images.current++
    setImageBusy(false)
    setImageError(undefined)
    setDraft(profile && { name: profile.name, bio: profile.bio, organization: profile.organization, avatar: profile.avatar })
    return () => { images.current++ }
  }, [profile])
  const dirty = Boolean(profile && draft && (['name', 'bio', 'organization', 'avatar'] as const).some((key) => profile[key] !== draft[key]))
  const edit = (patch: Partial<CloudProfileFields>) => { setDraft((value) => value && { ...value, ...patch }); setSaved(false) }
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
  return <section className={`${shared.surface} ${styles.panel}`} aria-label={t('cloud.tabs.profile')}>
    {failure ? <Alert type="warning" showIcon title={t(`cloud.errors.${failure}`, { defaultValue: t('cloud.operationFailed') })} /> : null}
    {!profile || !draft ? loading ? <Spin /> : <Button onClick={() => void reload()}>{t('cloud.retry')}</Button> : <Form layout="vertical" disabled={loading || imageBusy} onFinish={() => void save({ ...draft, expected_revision: profile.revision }).then(setSaved)}>
      <div className={styles['avatar-row']}>
        <Avatar className={styles.avatar} size={72} src={draft.avatar || undefined} icon={<UserRound size={30} />} />
        <div>
          <div className={shared.actions}>
            <Button icon={<Camera size={15} />} loading={imageBusy} onClick={() => input.current?.click()}>{t('cloud.profile.chooseAvatar')}</Button>
            <Button disabled={!draft.avatar || loading || imageBusy} onClick={() => edit({ avatar: '' })}>{t('cloud.profile.removeAvatar')}</Button>
          </div>
          <p className={shared.hint}>{t('cloud.profile.avatarHint')}</p>
        </div>
        <span className={styles['file-input']}><input ref={input} type="file" accept="image/png,image/jpeg" hidden aria-label={t('cloud.profile.chooseAvatar')} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void choose(file) }} /></span>
      </div>
      <div className={styles.fields}>
        <Form.Item label={t('cloud.profile.name')} htmlFor="cloud-profile-name"><Input id="cloud-profile-name" value={draft.name} count={{ show: true, max: 64, strategy: (value) => [...value].length }} onChange={(event) => edit({ name: event.target.value })} placeholder={email} /></Form.Item>
        <Form.Item label={t('cloud.profile.organization')} htmlFor="cloud-profile-organization"><Input id="cloud-profile-organization" value={draft.organization} count={{ show: true, max: 100, strategy: (value) => [...value].length }} onChange={(event) => edit({ organization: event.target.value })} /></Form.Item>
      </div>
      <Form.Item label={t('cloud.profile.bio')} htmlFor="cloud-profile-bio"><Input.TextArea id="cloud-profile-bio" value={draft.bio} autoSize={{ minRows: 3, maxRows: 6 }} count={{ show: true, max: 200, strategy: (value) => [...value].length }} onChange={(event) => edit({ bio: event.target.value })} /></Form.Item>
      <div className={styles.footer}>
        <span className={shared.hint} role="status">{saved && !dirty ? t('cloud.profile.saved') : t('cloud.profile.privateHint')}</span>
        <div className={shared.actions}>
          <Popconfirm disabled={!dirty} title={t('cloud.profile.discard')} onConfirm={() => { setSaved(false); void reload() }}><Button disabled={loading || imageBusy} onClick={() => { if (!dirty) { setSaved(false); void reload() } }}>{t('cloud.profile.reload')}</Button></Popconfirm>
          <Button type="primary" htmlType="submit" loading={loading} disabled={!dirty || imageBusy || [...draft.name].length > 64 || [...draft.organization].length > 100 || [...draft.bio].length > 200}>{t('cloud.profile.save')}</Button>
        </div>
      </div>
    </Form>}
  </section>
}
