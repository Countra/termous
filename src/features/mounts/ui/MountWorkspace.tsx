import { useState } from 'react'
import { Alert, App, Button, Empty, Popconfirm, Tag } from 'antd'
import { Edit3, HardDrive, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isMountActive, isMountBusy, type MountInput, type MountInstance, type MountProfile } from '#entities/mount'
import { ConfirmDialog, termousNotificationClassName, termousPopconfirmProps } from '#shared/ui'
import type { MountWorkspaceProps } from '../model/types'
import { MountEditor } from './MountEditor'
import { MountFailure } from './MountFailure'
import styles from './Mounts.module.scss'

export function MountWorkspace(props: MountWorkspaceProps) {
  const { t } = useTranslation()
  const { notification } = App.useApp()
  const [editor, setEditor] = useState<{ profile?: MountProfile; temporary: boolean }>()
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState<MountInstance>()
  const [checking, setChecking] = useState(false)
  const report = (error: unknown) => notification.error({ title: t('mounts.operationFailed'), description: error instanceof Error ? error.message : String(error), className: termousNotificationClassName })
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    try { await operation() } catch (error) { report(error) } finally { setBusy(false) }
  }
  const check = async () => { setChecking(true); try { await props.reload() } catch (error) { report(error) } finally { setChecking(false) } }
  const submit = (input: MountInput) => void run(async () => {
    if (editor?.temporary) await props.start({ temporary: input })
    else await props.save(editor?.profile?.id, input)
    setEditor(undefined)
  })
  const environment = props.environment
  const environmentReason = environment?.reason ?? (environment && !environment.build_supported ? 'build_unsupported' : undefined)
  const environmentTitle = environmentReason ? t(`mounts.environmentReasons.${environmentReason}`) : t('mounts.environmentUnavailable')
  const showEnvironmentHelp = environment?.build_supported && environment.help_url && (!environmentReason || ['dependency_missing', 'dependency_incompatible', 'dependency_error'].includes(environmentReason))
  const environmentHelpLabel = environmentReason === 'dependency_incompatible' ? 'mounts.upgradeDependency' : environmentReason === 'dependency_error' ? 'mounts.dependencyHelp' : 'mounts.download'
  const active = props.instances.filter(isMountActive)
  const disabled = busy || !props.connected
  const profileInstance = (id: string) => [...props.instances].reverse().find((item) => item.profile_id === id)
  const sourceName = (id: string) => props.fileProfiles.find((item) => item.id === id)?.name ?? id
  const runtime = (value: MountInstance, failureOnAutoStart = false) => <div className={styles.runtime}>
    <div className={styles.badges}>
      <Tag color={value.mounted ? 'success' : value.retained ? 'warning' : 'processing'}>{t(`mounts.states.${value.phase}`, { defaultValue: t(`mounts.states.${value.state}`) })}</Tag>
      <span>{t('mounts.dirty', { count: value.dirty_nodes })}</span>
      <span>{t('mounts.handles', { count: value.open_handles })}</span>
      {value.failure && !failureOnAutoStart ? <MountFailure failure={value.failure} /> : null}
    </div>
    {value.retained && !value.mounted ? <p className={styles.hint}>{t('mounts.detachedHint')}</p> : null}
    <div className={styles.actions}>
      <Button size="small" disabled={disabled || isMountBusy(value)} onClick={() => void run(() => props.action(value.id, 'sync'))}>{t('mounts.sync')}</Button>
      <Button size="small" disabled={disabled || isMountBusy(value)} onClick={() => void run(() => props.action(value.id, 'reconnect'))}>{t('mounts.reconnect')}</Button>
      <Button size="small" disabled={disabled || isMountBusy(value) && value.state !== 'starting'} onClick={() => void run(() => props.action(value.id, 'stop'))}>{t(value.state === 'starting' ? 'mounts.cancelStart' : 'mounts.stop')}</Button>
      {value.failure || value.retained ? <Button size="small" danger disabled={disabled || isMountBusy(value)} onClick={() => setDiscard(value)}>{t('mounts.force')}</Button> : null}
    </div>
  </div>
  return <section className={styles.workspace}>
    <header className={styles.header}>
      <div><h2>{t('mounts.title')}</h2><p>{t('mounts.subtitle')}</p></div>
      <div className={styles.actions}>
        <Button icon={<RefreshCw size={16} />} loading={checking} onClick={() => void check()}>{t('mounts.recheck')}</Button>
        <Button disabled={!environment?.available || disabled} onClick={() => setEditor({ temporary: true })}>{t('mounts.temporary')}</Button>
        <Button type="primary" icon={<Plus size={16} />} disabled={busy || !environment} onClick={() => setEditor({ temporary: false })}>{t('mounts.create')}</Button>
      </div>
    </header>
    {props.error ? <Alert type="error" showIcon title={props.error} /> : null}
    {!props.connected ? <Alert type="info" showIcon title={t('mounts.awaitingState')} /> : null}
    {environment && !environment.available ? <Alert type="warning" showIcon title={environmentTitle} description={<>
      {environment.message} {showEnvironmentHelp ? <a href={environment.help_url} target="_blank" rel="noreferrer">{t(environmentHelpLabel, { name: environment.dependency })}</a> : null}
    </>} /> : null}
    <aside className={styles.notice}><HardDrive size={17} aria-hidden="true" /><p>{t('mounts.cacheNotice')}</p></aside>
    <div className={styles['section-heading']}><h3>{t('mounts.saved')}</h3><span>{t('mounts.running', { count: active.filter((item) => item.mounted).length })}</span></div>
    <div className={styles.list}>
      {props.profiles.length === 0 ? <Empty description={t('mounts.empty')} /> : props.profiles.map((profile) => {
        const instance = profileInstance(profile.id)
        const running = instance && isMountActive(instance)
        const displayed = running ? instance : profile
        const incompatible = environment && profile.target_os !== environment.platform
        const startupFailure = profile.auto_start && instance?.start_origin === 'startup' && instance.failure?.operation === 'start' ? instance.failure : undefined
        return <article className={styles.item} key={profile.id}>
          <div className={styles['item-header']}>
            <div className={styles.identity}><HardDrive size={22} /><div><h4>{profile.name}</h4><span>{displayed.mount_point} · {sourceName(displayed.file_profile_id)}</span></div></div>
            <div className={styles.actions}>
              {!running ? <Button icon={<Play size={15} />} disabled={disabled || !environment?.available || Boolean(incompatible)} onClick={() => void run(() => props.start({ profile_id: profile.id }))}>{t('mounts.start')}</Button> : null}
              <Button type="text" icon={<Edit3 size={16} />} aria-label={t('mounts.edit')} disabled={busy} onClick={() => setEditor({ profile, temporary: false })} />
              <Popconfirm {...termousPopconfirmProps} title={t('mounts.deleteTitle')} description={t('mounts.deleteHint')} onConfirm={() => run(() => props.remove(profile))} okText={t('app.delete')} cancelText={t('app.cancel')}>
                <Button type="text" danger icon={<Trash2 size={16} />} aria-label={t('app.delete')} disabled={disabled || Boolean(running)} />
              </Popconfirm>
            </div>
          </div>
          <div className={styles.badges}>
            <Tag>{t(displayed.read_only ? 'mounts.readOnly' : 'mounts.readWrite')}</Tag>
            {profile.auto_start ? startupFailure ? <MountFailure failure={startupFailure} startup /> : <Tag>{t('mounts.autoStartBadge')}</Tag> : null}
            {incompatible ? <Tag color="warning">{t('mounts.platformMismatch')}</Tag> : null}
            {!running && instance?.failure && !startupFailure ? <MountFailure failure={instance.failure} /> : null}
          </div>
          {profile.description ? <p className={styles.hint}>{profile.description}</p> : null}
          {running ? runtime(instance, Boolean(startupFailure)) : null}
        </article>
      })}
    </div>
    {props.instances.some((value) => !value.profile_id && value.state !== 'stopped') ? <>
      <div className={styles['section-heading']}><h3>{t('mounts.temporary')}</h3></div>
      <div className={styles.list}>{props.instances.filter((value) => !value.profile_id && value.state !== 'stopped').map((value) => <article className={styles.item} key={value.id}>
        <div className={styles.identity}><HardDrive size={22} /><div><h4>{value.name}</h4><span>{value.mount_point} · {sourceName(value.file_profile_id)} · {t(value.read_only ? 'mounts.readOnly' : 'mounts.readWrite')}</span></div></div>
        {isMountActive(value) ? runtime(value) : value.failure ? <MountFailure failure={value.failure} /> : null}
      </article>)}</div>
    </> : null}
    {editor ? <MountEditor {...editor} environment={environment} fileProfiles={props.fileProfiles} hosts={props.hosts} busy={busy} onClose={() => setEditor(undefined)} onSubmit={submit} onError={report} /> : null}
    <ConfirmDialog open={Boolean(discard)} title={t('mounts.forceTitle')} description={t('mounts.forceHint', { count: props.instances.find((item) => item.id === discard?.id)?.dirty_nodes ?? discard?.dirty_nodes ?? 0 })} danger confirmLoading={busy}
      onCancel={() => setDiscard(undefined)} onConfirm={() => { if (discard) void run(async () => { await props.action(discard.id, 'stop', true); setDiscard(undefined) }) }} confirmLabel={t('mounts.force')} />
  </section>
}
