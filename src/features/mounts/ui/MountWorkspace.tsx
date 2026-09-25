import { useState } from 'react'
import { Alert, App, Button, Input, Popconfirm, Tag, Tooltip } from 'antd'
import { Activity, ArrowRight, Edit3, FolderOpen, FolderTree, HardDrive, Play, Plus, RefreshCw, Search, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isMountActive, type MountEnvironment, type MountInput, type MountInstance, type MountProfile } from '#entities/mount'
import { ConfirmDialog, ConnectionActionButton, ManagementFilterTabs, StatusBadge, uiStyles, termousNotificationClassName, termousPopconfirmProps } from '#shared/ui'
import type { MountWorkspaceProps } from '../model/types'
import { MountEditor } from './MountEditor'
import { MountFailure } from './MountFailure'
import { MountRuntime } from './MountRuntime'
import styles from './Mounts.module.scss'

type ProfileFilter = 'all' | 'active' | 'issues'

export function MountWorkspace(props: MountWorkspaceProps) {
  const { t } = useTranslation()
  const { notification } = App.useApp()
  const [editor, setEditor] = useState<{ profile?: MountProfile; temporary: boolean; environment: MountEnvironment }>()
  const [busy, setBusy] = useState(false)
  const [discard, setDiscard] = useState<MountInstance>()
  const [checking, setChecking] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ProfileFilter>('all')
  const report = (error: unknown) => notification.error({ title: t('mounts.operationFailed'), description: error instanceof Error ? error.message : String(error), className: termousNotificationClassName })
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    try { await operation() } catch (error) { report(error) } finally { setBusy(false) }
  }
  const check = async () => { setChecking(true); try { await props.reload() } catch (error) { report(error) } finally { setChecking(false) } }
  const openEditor = async (next: { profile?: MountProfile; temporary: boolean }) => {
    setChecking(true)
    try {
      const snapshot = await props.reload()
      if (!snapshot) return
      const profile = next.profile ? snapshot.profiles.find((item) => item.id === next.profile?.id) : undefined
      if (next.profile && !profile) { report(new Error(t('mounts.profileUnavailable'))); return }
      if (next.temporary && !snapshot.environment.available) { report(new Error(snapshot.environment.message || t('mounts.environmentUnavailable'))); return }
      setEditor({ ...next, profile, environment: snapshot.environment })
    } catch (error) { report(error) } finally { setChecking(false) }
  }
  const submit = (input: MountInput) => void run(async () => {
    if (editor?.temporary) await props.start({ temporary: input })
    else await props.save(editor?.profile?.id, input)
    if (!editor?.temporary && !editor?.profile) { setFilter('all'); setSearch('') }
    setEditor(undefined)
  })
  const environment = props.environment
  const environmentState = !props.connected || !environment ? 'pending' : environment.available ? 'ready' : 'unavailable'
  const environmentStateLabel = t(`mounts.environmentStates.${environmentState}`)
  const environmentReason = environment?.reason ?? (environment && !environment.build_supported ? 'build_unsupported' : undefined)
  const environmentTitle = environmentReason ? t(`mounts.environmentReasons.${environmentReason}`) : t('mounts.environmentUnavailable')
  const showEnvironmentHelp = environment?.build_supported && environment.help_url && (!environmentReason || ['dependency_missing', 'dependency_incompatible', 'dependency_error'].includes(environmentReason))
  const environmentHelpLabel = environmentReason === 'dependency_incompatible' ? 'mounts.upgradeDependency' : environmentReason === 'dependency_error' ? 'mounts.dependencyHelp' : 'mounts.download'
  const disabled = busy || !props.connected
  const instancesNewestFirst = [...props.instances].reverse()
  const profileInstance = (id: string) => instancesNewestFirst.find((item) => item.profile_id === id && isMountActive(item))
    ?? instancesNewestFirst.find((item) => item.profile_id === id)
  const sourceName = (id: string) => props.fileProfiles.find((item) => item.id === id)?.name ?? id
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const matchesSearch = (value: MountProfile | MountInstance) => !normalizedSearch || [value.name, value.mount_point, sourceName(value.file_profile_id)]
    .some((field) => field.toLocaleLowerCase().includes(normalizedSearch))
  const filteredProfiles = props.profiles.filter((profile) => {
    const instance = profileInstance(profile.id)
    const incompatible = environment && profile.target_os !== environment.platform
    const matchesStatus = filter === 'all' || filter === 'active' && Boolean(instance && isMountActive(instance))
      || filter === 'issues' && Boolean(incompatible || instance?.failure || instance?.retained)
    return matchesStatus && (matchesSearch(profile) || Boolean(instance && isMountActive(instance) && matchesSearch(instance)))
  })
  const emptyProfileKey = !props.profiles.length ? 'mounts.empty' : normalizedSearch ? 'mounts.noResults'
    : filter === 'active' ? 'mounts.noActiveProfiles' : filter === 'issues' ? 'mounts.noIssues' : 'mounts.noResults'
  const runtimeInstances = props.instances.filter((value) => isMountActive(value) || !value.profile_id && value.state === 'failed')
  const mountedCount = runtimeInstances.filter((value) => value.mounted).length
  const discardDirtyCount = props.instances.find((item) => item.id === discard?.id)?.dirty_nodes ?? discard?.dirty_nodes ?? 0
  const environmentNotice = environment && !environment.available ? <div className={styles['environment-notice']} role="status">
    <TriangleAlert size={17} aria-hidden="true" />
    <div><strong>{environmentTitle}</strong><p>{environment.message} {showEnvironmentHelp ? <a href={environment.help_url} target="_blank" rel="noreferrer">{t(environmentHelpLabel, { name: environment.dependency })}</a> : null}</p></div>
  </div> : null
  return <section className={styles.workspace}>
    <header className={styles.header}>
      <div className={styles['header-main']}>
        <div className={styles['environment-status']} role="status" aria-label={`${t('mounts.environmentStatus')}: ${environmentStateLabel}`} data-state={environmentState}>
          <span className={styles['environment-status-icon']}><HardDrive size={17} aria-hidden="true" /></span>
          <span className={styles['environment-status-value']}>{environmentStateLabel}</span>
        </div>
        <div className={styles.actions}>
          <Button className={`${uiStyles['secondary-button']} ${styles['recheck-button']}`} icon={<RefreshCw size={16} />} aria-label={t('mounts.recheck')} title={t('mounts.recheck')} loading={checking} onClick={() => void check()} />
          <Button className={uiStyles['secondary-button']} icon={<Play size={15} />} disabled={!environment?.available || disabled || checking} onClick={() => void openEditor({ temporary: true })}>{t('mounts.temporary')}</Button>
          <ConnectionActionButton icon={<Plus size={16} />} disabled={busy || checking || !environment} onClick={() => void openEditor({ temporary: false })}>{t('mounts.create')}</ConnectionActionButton>
        </div>
      </div>
      <div className={styles['profile-tools']}>
        <Input allowClear className={styles.search} prefix={<Search size={15} aria-hidden="true" />} value={search} aria-label={t('mounts.searchPlaceholder')} placeholder={t('mounts.searchPlaceholder')} onChange={(event) => setSearch(event.target.value)} />
        <ManagementFilterTabs activeKey={filter} aria-label={t('mounts.filterLabel')} onChange={(key) => setFilter(key as ProfileFilter)} items={[
          { key: 'all', label: t('mounts.filterAll') },
          { key: 'active', label: t('mounts.filterActive') },
          { key: 'issues', label: t('mounts.filterIssues') },
        ]} />
        <span className={styles['filter-count']}>{filteredProfiles.length} / {props.profiles.length}</span>
      </div>
    </header>
    <div className={styles.feedback}>
      {props.error ? <Alert className={styles.alert} type="error" showIcon title={props.error} /> : null}
      {!props.connected ? <Alert className={styles.alert} type="info" showIcon title={t('mounts.awaitingState')} /> : null}
    </div>
    <div className={styles.board}>
      <section className={styles['profiles-pane']} aria-label={t('mounts.saved')}>
        <div className={styles['pane-heading']}>
          <span className={styles['pane-icon']}><FolderTree size={17} aria-hidden="true" /></span>
          <div className={styles['pane-title']}><h2>{t('mounts.saved')}</h2><small>{t('mounts.profileCount', { count: props.profiles.length })}</small></div>
          <span className={styles['pane-count']}>{filteredProfiles.length}</span>
        </div>
        <div className={styles['profile-content']}>
          {filteredProfiles.length === 0 ? <div className={styles.empty}>
            <FolderOpen size={27} aria-hidden="true" />
            <strong>{t(emptyProfileKey)}</strong>
          </div> : <div className={styles['profile-list']}>{filteredProfiles.map((profile) => {
          const instance = profileInstance(profile.id)
          const running = instance && isMountActive(instance)
          const displayed = running ? instance : profile
          const displayedSource = sourceName(displayed.file_profile_id)
          const incompatible = environment && profile.target_os !== environment.platform
          const startupFailure = profile.auto_start && instance?.start_origin === 'startup' && instance.failure?.operation === 'start' ? instance.failure : undefined
          const status = running ? instance.mounted ? 'connected' : instance.retained || instance.failure ? 'failed' : 'connecting' : instance?.failure ? 'failed' : 'disconnected'
          return <article className={styles['profile-row']} key={profile.id}>
            <div className={styles['profile-details']}>
              <span className={styles['profile-heading']}>
                <strong>{profile.name}</strong>
                <StatusBadge
                  status={status}
                  label={running ? t(`mounts.states.${instance.phase}`, { defaultValue: t(`mounts.states.${instance.state}`) }) : t(instance?.failure ? 'mounts.states.failed' : 'mounts.states.stopped')}
                />
              </span>
              <span className={styles['profile-route']}>
                <span className={styles['profile-endpoint']}><small>{t('mounts.source')}</small><span title={displayedSource}>{displayedSource}</span></span>
                <ArrowRight size={14} aria-hidden="true" />
                <span className={styles['profile-endpoint']}><small>{t('mounts.locationSection')}</small><code title={displayed.mount_point}>{displayed.mount_point}</code></span>
              </span>
              {profile.description ? <span className={styles.hint}>{profile.description}</span> : null}
            </div>
            <div className={styles['profile-footer']}>
              <div className={styles['profile-flags']}>
                <span>{t(displayed.read_only ? 'mounts.readOnly' : 'mounts.readWrite')}</span>
                {profile.auto_start ? startupFailure ? <MountFailure failure={startupFailure} startup /> : <Tag>{t('mounts.autoStartBadge')}</Tag> : null}
                {incompatible ? <Tag color="warning">{t('mounts.platformMismatch')}</Tag> : null}
                {!running && instance?.failure && !startupFailure ? <MountFailure failure={instance.failure} /> : null}
              </div>
              <div className={styles['row-actions']}>
                {!running ? <Tooltip title={t('mounts.start')} mouseEnterDelay={0.25}><span className={styles['profile-action-slot']}>
                  <Button size="small" icon={<Play size={14} />} disabled={disabled || !environment?.available || Boolean(incompatible)} onClick={() => void run(() => props.start({ profile_id: profile.id }))}>{t('mounts.start')}</Button>
                </span></Tooltip> : null}
                <Tooltip title={t('mounts.edit')} mouseEnterDelay={0.25}><span className={styles['profile-action-slot']}>
                  <Button type="text" icon={<Edit3 size={16} />} aria-label={t('mounts.edit')} disabled={busy || checking} onClick={() => void openEditor({ profile, temporary: false })} />
                </span></Tooltip>
                <Tooltip title={t('app.delete')} mouseEnterDelay={0.25}><span className={styles['profile-action-slot']}>
                  <Popconfirm {...termousPopconfirmProps} title={t('mounts.deleteTitle')} description={t('mounts.deleteHint')} onConfirm={() => run(() => props.remove(profile))} okText={t('app.delete')} cancelText={t('app.cancel')}>
                    <Button type="text" danger icon={<Trash2 size={16} />} aria-label={t('app.delete')} disabled={disabled || Boolean(running)} />
                  </Popconfirm>
                </span></Tooltip>
              </div>
            </div>
          </article>
          })}</div>}
        </div>
      </section>
      <section className={styles['runtime-pane']} aria-label={t('mounts.runtime')}>
        <div className={styles['pane-heading']}>
          <span className={styles['pane-icon']}><Activity size={17} aria-hidden="true" /></span>
          <div className={styles['pane-title']}><h2>{t('mounts.runtime')}</h2><small>{t('mounts.running', { count: mountedCount })}</small></div>
          <span className={styles['pane-count']}>{runtimeInstances.length}</span>
        </div>
        <div className={styles['runtime-content']}>
          <div className={styles['runtime-list']}>
            {environmentNotice}
            {runtimeInstances.length === 0 ? <div className={styles.empty}>
              <HardDrive size={27} aria-hidden="true" />
              <strong>{t('mounts.noRuntime')}</strong>
            </div> : runtimeInstances.map((value) => <MountRuntime key={value.id} instance={value} disabled={disabled} sourceName={sourceName(value.file_profile_id)}
              onAction={(action) => void run(() => props.action(value.id, action))} onDiscard={() => setDiscard(value)} />)}
          </div>
        </div>
        {runtimeInstances.length > 0 ? <aside className={styles.notice}><HardDrive size={15} aria-hidden="true" /><p>{t('mounts.cacheNotice')}</p></aside> : null}
      </section>
    </div>
    {editor ? <MountEditor {...editor} fileProfiles={props.fileProfiles} hosts={props.hosts} busy={busy} onClose={() => setEditor(undefined)} onSubmit={submit} onError={report} /> : null}
    <ConfirmDialog open={Boolean(discard)} title={t(discardDirtyCount > 0 ? 'mounts.forceTitle' : 'mounts.forceCleanTitle')}
      description={t(discardDirtyCount > 0 ? 'mounts.forceHint' : 'mounts.forceCleanHint', { count: discardDirtyCount })} danger confirmLoading={busy}
      onCancel={() => setDiscard(undefined)} onConfirm={() => { if (discard) void run(async () => { await props.action(discard.id, 'stop', true); setDiscard(undefined) }) }} confirmLabel={t('mounts.force')} />
  </section>
}
