import { App as AntdApp, Button, Input, InputNumber, Modal, Segmented, Switch } from 'antd'
import { Cable, MonitorPlay, Pencil, Plus, Save, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteDesktopDisplayMode,
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
} from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import { confirmDialogStyles, CustomSelect, uiStyles } from '#shared/ui'
import styles from './RemoteDesktopLauncher.module.scss'

interface RemoteDesktopLauncherProps {
  open: boolean
  profiles: RemoteDesktopProfile[]
  hosts: Host[]
  actionBusy: boolean
  onClose: () => void
  onCreate: (input: RemoteDesktopProfileInput) => Promise<RemoteDesktopProfile>
  onUpdate: (id: string, input: RemoteDesktopProfileInput) => Promise<RemoteDesktopProfile>
  onDelete: (id: string) => Promise<void>
  onConnect: (profileId: string) => Promise<void>
}

const defaultDraft: RemoteDesktopProfileInput = {
  name: '',
  description: '',
  protocol: 'vnc',
  transport: 'ssh_tunnel',
  ssh_host_id: '',
  vnc: {
    loopback_host: '127.0.0.1',
    port: 5900,
    shared: true,
    default_view_only: false,
    default_display_mode: 'fit',
  },
}

type LauncherIntent =
  | { type: 'close' }
  | { type: 'new' }
  | { type: 'select'; profileId: string }
  | { type: 'connect'; profileId: string }
  | { type: 'cancel_edit' }

export function RemoteDesktopLauncher({
  open,
  profiles,
  hosts,
  actionBusy,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  onConnect,
}: RemoteDesktopLauncherProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState<RemoteDesktopProfileInput>(defaultDraft)
  const [baseline, setBaseline] = useState<RemoteDesktopProfileInput>(defaultDraft)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const confirmationOpenRef = useRef(false)
  const pendingIntentRef = useRef<LauncherIntent | null>(null)
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null
  const dirty = editing && !profileInputsEqual(draft, baseline)

  useEffect(() => {
    if (!open) {
      return
    }
    if (!editing && (!selectedId || !profiles.some((profile) => profile.id === selectedId))) {
      setSelectedId(profiles[0]?.id ?? '')
    }
  }, [editing, open, profiles, selectedId])

  useEffect(() => {
    if (!editing && selected) {
      const next = profileToInput(selected)
      setDraft(next)
      setBaseline(next)
    }
  }, [editing, selected])

  const visibleProfiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return profiles.filter((profile) => (
      !normalized
      || profile.name.toLocaleLowerCase().includes(normalized)
      || profile.description.toLocaleLowerCase().includes(normalized)
      || hosts.find((host) => host.id === profile.ssh_host_id)?.name.toLocaleLowerCase().includes(normalized)
    ))
  }, [hosts, profiles, query])

  const save = async (connectAfterSave: boolean) => {
    const validation = validateDraft(draft)
    if (validation) {
      notification.warning({ title: t('remoteDesktop.profileInvalid'), description: t(`remoteDesktop.${validation}`) })
      return
    }
    setBusy(true)
    try {
      const saved = editing && selected
        ? await onUpdate(selected.id, normalizedDraft(draft))
        : await onCreate(normalizedDraft(draft))
      const savedInput = profileToInput(saved)
      setSelectedId(saved.id)
      setDraft(savedInput)
      setBaseline(savedInput)
      setEditing(false)
      if (connectAfterSave) {
        try {
          await onConnect(saved.id)
          onClose()
        } catch (error) {
          notification.error({
            title: t('remoteDesktop.connectFailed'),
            description: error instanceof Error ? error.message : t('app.error'),
          })
        }
      }
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.profileSaveFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
      })
    } finally {
      setBusy(false)
    }
  }

  const remove = () => {
    if (!selected) {
      return
    }
    modal.confirm({
      title: t('remoteDesktop.deleteProfileTitle'),
      content: t('remoteDesktop.deleteProfileDescription', { name: selected.name }),
      okText: t('app.delete'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      centered: true,
      async onOk() {
        try {
          await onDelete(selected.id)
          setSelectedId('')
          setEditing(false)
        } catch (error) {
          notification.error({
            title: t('remoteDesktop.profileDeleteFailed'),
            description: error instanceof Error ? error.message : t('app.error'),
          })
          throw error
        }
      },
    })
  }

  const startNew = () => {
    const next = createDefaultDraft(hosts[0]?.id ?? '')
    setSelectedId('')
    setDraft(next)
    setBaseline(next)
    setEditing(true)
  }

  const connectProfile = async (profileId: string) => {
    setBusy(true)
    try {
      await onConnect(profileId)
      setEditing(false)
      onClose()
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.connectFailed'),
        description: error instanceof Error ? error.message : t('app.error'),
      })
    } finally {
      setBusy(false)
    }
  }

  const applyIntent = async (intent: LauncherIntent) => {
    if (intent.type === 'close') {
      setEditing(false)
      onClose()
      return
    }
    if (intent.type === 'new') {
      startNew()
      return
    }
    if (intent.type === 'select') {
      setSelectedId(intent.profileId)
      setEditing(false)
      return
    }
    if (intent.type === 'connect') {
      await connectProfile(intent.profileId)
      return
    }
    if (selected) {
      const next = profileToInput(selected)
      setDraft(next)
      setBaseline(next)
      setEditing(false)
      return
    }
    setEditing(false)
    onClose()
  }

  const requestIntent = (intent: LauncherIntent) => {
    if (!dirty) {
      void applyIntent(intent)
      return
    }
    if (confirmationOpenRef.current) {
      pendingIntentRef.current = intent
      return
    }
    confirmationOpenRef.current = true
    pendingIntentRef.current = intent
    modal.confirm({
      centered: true,
      className: confirmDialogStyles.modal,
      rootClassName: confirmDialogStyles['modal-wrap'],
      title: t('remoteDesktop.discardDraftTitle'),
      content: t('remoteDesktop.discardDraftDescription'),
      okText: t('remoteDesktop.discardDraft'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      onOk: () => {
        const pendingIntent = pendingIntentRef.current
        return pendingIntent ? applyIntent(pendingIntent) : undefined
      },
      afterClose: () => {
        confirmationOpenRef.current = false
        pendingIntentRef.current = null
      },
    })
  }

  const formDisabled = busy || actionBusy || !editing
  return (
    <Modal
      open={open}
      centered
      width={860}
      title={null}
      footer={null}
      destroyOnHidden
      mask={{ closable: !busy && !actionBusy }}
      keyboard={!busy && !actionBusy}
      onCancel={busy || actionBusy ? undefined : () => requestIntent({ type: 'close' })}
      className={styles.modal}
    >
      <section className={styles.launcher}>
        <header className={styles.header}>
          <span className={styles['header-icon']}><MonitorPlay size={20} /></span>
          <div>
            <h2>{t('remoteDesktop.launcherTitle')}</h2>
            <p>{t('remoteDesktop.launcherDescription')}</p>
          </div>
        </header>
        <div className={styles.body}>
          <aside className={styles.catalog}>
            <Input
              allowClear
              value={query}
              prefix={<Search size={15} />}
              placeholder={t('remoteDesktop.searchProfiles')}
              className={uiStyles['search-input']}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className={styles.list} role="listbox" aria-label={t('remoteDesktop.profiles')}>
              {visibleProfiles.map((profile) => {
                const host = hosts.find((item) => item.id === profile.ssh_host_id)
                return (
                  <button
                    key={profile.id}
                    type="button"
                    role="option"
                    aria-selected={profile.id === selected?.id}
                    disabled={busy || actionBusy}
                    className={`${styles.item} ${profile.id === selected?.id ? styles['is-active'] : ''}`}
                    onClick={() => requestIntent({ type: 'select', profileId: profile.id })}
                    onDoubleClick={() => requestIntent({ type: 'connect', profileId: profile.id })}
                  >
                    <span className={styles['item-icon']}><MonitorPlay size={16} /></span>
                    <span className={styles['item-copy']}>
                      <strong>{profile.name}</strong>
                      <small>{host?.name ?? t('fields.none')} · {profile.vnc.loopback_host}:{profile.vnc.port}</small>
                    </span>
                  </button>
                )
              })}
              {visibleProfiles.length === 0 ? <p className={styles.empty}>{t('remoteDesktop.noProfiles')}</p> : null}
            </div>
            <Button
              className={uiStyles['secondary-button']}
              icon={<Plus size={15} />}
              disabled={busy || actionBusy}
              onClick={() => requestIntent({ type: 'new' })}
            >
              {t('remoteDesktop.newProfile')}
            </Button>
          </aside>
          <main className={styles.editor}>
            <div className={styles['editor-heading']}>
              <div>
                <small>{t('remoteDesktop.vncOverSsh')}</small>
                <h3>{editing ? (selected ? t('remoteDesktop.editProfile') : t('remoteDesktop.newProfile')) : selected?.name ?? t('remoteDesktop.profileDetail')}</h3>
              </div>
              {selected && !editing ? (
                <Button
                  type="text"
                  icon={<Pencil size={15} />}
                  disabled={busy || actionBusy}
                  onClick={() => {
                    const next = profileToInput(selected)
                    setDraft(next)
                    setBaseline(next)
                    setEditing(true)
                  }}
                >
                  {t('app.edit')}
                </Button>
              ) : null}
            </div>
            <div className={styles.form}>
              <label className={uiStyles.field}>
                <span className={uiStyles['field-label']}>{t('remoteDesktop.profileName')}</span>
                <Input value={draft.name} disabled={formDisabled} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <CustomSelect
                label={t('remoteDesktop.sshHost')}
                value={draft.ssh_host_id}
                disabled={formDisabled}
                options={hosts.map((host) => ({ value: host.id, label: host.name, description: `${host.username}@${host.address}` }))}
                onChange={(ssh_host_id) => setDraft((current) => ({ ...current, ssh_host_id }))}
              />
              <label className={`${uiStyles.field} ${styles['field-wide']}`}>
                <span className={uiStyles['field-label']}>{t('remoteDesktop.description')}</span>
                <Input value={draft.description} disabled={formDisabled} maxLength={240} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
              </label>
              <CustomSelect
                label={t('remoteDesktop.loopbackHost')}
                value={draft.vnc.loopback_host}
                disabled={formDisabled}
                options={[
                  { value: '127.0.0.1', label: '127.0.0.1', description: t('remoteDesktop.ipv4Loopback') },
                  { value: '::1', label: '::1', description: t('remoteDesktop.ipv6Loopback') },
                ]}
                onChange={(loopback_host) => setDraft((current) => ({
                  ...current,
                  vnc: { ...current.vnc, loopback_host: loopback_host as '127.0.0.1' | '::1' },
                }))}
              />
              <label className={uiStyles.field}>
                <span className={uiStyles['field-label']}>{t('remoteDesktop.port')}</span>
                <InputNumber
                  min={1}
                  max={65535}
                  value={draft.vnc.port}
                  disabled={formDisabled}
                  onChange={(port) => setDraft((current) => ({ ...current, vnc: { ...current.vnc, port: port ?? 5900 } }))}
                />
              </label>
              <div className={`${styles.option} ${styles['field-wide']}`}>
                <span>
                  <strong>{t('remoteDesktop.displayMode')}</strong>
                  <small>{t('remoteDesktop.displayModeHint')}</small>
                </span>
                <Segmented<RemoteDesktopDisplayMode>
                  value={draft.vnc.default_display_mode}
                  disabled={formDisabled}
                  options={[
                    { value: 'fit', label: t('remoteDesktop.display.fit') },
                    { value: 'resize', label: t('remoteDesktop.display.resize') },
                    { value: 'actual', label: t('remoteDesktop.display.actual') },
                  ]}
                  onChange={(default_display_mode) => setDraft((current) => ({
                    ...current,
                    vnc: { ...current.vnc, default_display_mode },
                  }))}
                />
              </div>
              <div className={styles.option}>
                <span><strong>{t('remoteDesktop.shared')}</strong><small>{t('remoteDesktop.sharedHint')}</small></span>
                <Switch checked={draft.vnc.shared} disabled={formDisabled} onChange={(shared) => setDraft((current) => ({ ...current, vnc: { ...current.vnc, shared } }))} />
              </div>
              <div className={styles.option}>
                <span><strong>{t('remoteDesktop.viewOnly')}</strong><small>{t('remoteDesktop.viewOnlyHint')}</small></span>
                <Switch checked={draft.vnc.default_view_only} disabled={formDisabled} onChange={(default_view_only) => setDraft((current) => ({ ...current, vnc: { ...current.vnc, default_view_only } }))} />
              </div>
            </div>
            <footer className={styles.footer}>
              <div>
                {selected ? <Button danger type="text" icon={<Trash2 size={15} />} disabled={busy || actionBusy} onClick={remove}>{t('app.delete')}</Button> : null}
              </div>
              <div>
                {editing ? (
                  <>
                    <Button disabled={busy || actionBusy} onClick={() => requestIntent({ type: 'cancel_edit' })}>{t('app.cancel')}</Button>
                    <Button className={uiStyles['secondary-button']} icon={<Save size={15} />} disabled={actionBusy} loading={busy} onClick={() => void save(false)}>{t('app.save')}</Button>
                    <Button type="primary" icon={<Cable size={16} />} disabled={actionBusy} loading={busy} onClick={() => void save(true)}>{t('remoteDesktop.saveAndConnect')}</Button>
                  </>
                ) : (
                  <Button type="primary" icon={<Cable size={16} />} disabled={!selected || actionBusy} loading={busy} onClick={() => selected && requestIntent({ type: 'connect', profileId: selected.id })}>{t('app.connect')}</Button>
                )}
              </div>
            </footer>
          </main>
        </div>
      </section>
    </Modal>
  )
}

function profileToInput(profile: RemoteDesktopProfile): RemoteDesktopProfileInput {
  return {
    name: profile.name,
    description: profile.description,
    protocol: 'vnc',
    transport: 'ssh_tunnel',
    ssh_host_id: profile.ssh_host_id,
    vnc: { ...profile.vnc },
  }
}

function createDefaultDraft(sshHostId: string): RemoteDesktopProfileInput {
  return {
    ...defaultDraft,
    ssh_host_id: sshHostId,
    vnc: { ...defaultDraft.vnc },
  }
}

function profileInputsEqual(left: RemoteDesktopProfileInput, right: RemoteDesktopProfileInput) {
  return (
    left.name === right.name
    && left.description === right.description
    && left.protocol === right.protocol
    && left.transport === right.transport
    && left.ssh_host_id === right.ssh_host_id
    && left.vnc.loopback_host === right.vnc.loopback_host
    && left.vnc.port === right.vnc.port
    && left.vnc.shared === right.vnc.shared
    && left.vnc.default_view_only === right.vnc.default_view_only
    && left.vnc.default_display_mode === right.vnc.default_display_mode
  )
}

function normalizedDraft(input: RemoteDesktopProfileInput): RemoteDesktopProfileInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description.trim(),
  }
}

function validateDraft(input: RemoteDesktopProfileInput) {
  if (!input.name.trim()) return 'validationName'
  if (!input.ssh_host_id) return 'validationHost'
  if (!Number.isSafeInteger(input.vnc.port) || input.vnc.port < 1 || input.vnc.port > 65535) return 'validationPort'
  return ''
}
