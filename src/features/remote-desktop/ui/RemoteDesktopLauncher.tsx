import { App as AntdApp, Empty, Modal } from 'antd'
import { MonitorPlay, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  RemoteDesktopProfile,
  RemoteDesktopProfileInput,
} from '#entities/remote-desktop'
import type { Host } from '#entities/host'
import {
  confirmDialogStyles,
  ConnectionActionButton,
  termousNotificationClassName,
} from '#shared/ui'
import {
  createRemoteDesktopProfileDraft,
  hasRemoteDesktopProfileDraftErrors,
  normalizeRemoteDesktopProfileDraft,
  remoteDesktopProfileDraftsEqual,
  remoteDesktopProfileToDraft,
  validateRemoteDesktopProfileDraft,
  type RemoteDesktopProfileDraft,
} from '../model/remoteDesktopProfileDraft'
import { RemoteDesktopProfileCatalog } from './RemoteDesktopProfileCatalog'
import { RemoteDesktopProfileEditor } from './RemoteDesktopProfileEditor'
import { RemoteDesktopProfileOverview } from './RemoteDesktopProfileOverview'
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

type LauncherIntent =
  | { type: 'close' }
  | { type: 'new' }
  | { type: 'select'; profileId: string }
  | { type: 'connect'; profileId: string }
  | { type: 'cancel_edit' }

type PendingAction = 'save' | 'save_connect' | 'connect' | 'delete' | null

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
  const [draft, setDraft] = useState<RemoteDesktopProfileDraft>(() => createRemoteDesktopProfileDraft())
  const [baseline, setBaseline] = useState<RemoteDesktopProfileDraft>(() => createRemoteDesktopProfileDraft())
  const [editing, setEditing] = useState(false)
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction>(null)
  const confirmationOpenRef = useRef(false)
  const pendingIntentRef = useRef<LauncherIntent | null>(null)
  const visibleProfiles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    return profiles.filter((profile) => (
      !normalized
      || profile.name.toLocaleLowerCase().includes(normalized)
      || profile.description.toLocaleLowerCase().includes(normalized)
      || hosts.find((host) => host.id === profile.ssh_host_id)?.name.toLocaleLowerCase().includes(normalized)
    ))
  }, [hosts, profiles, query])
  const editingProfile = editingProfileId
    ? profiles.find((profile) => profile.id === editingProfileId) ?? null
    : null
  const selected = editing
    ? editingProfile
    : visibleProfiles.find((profile) => profile.id === selectedId) ?? visibleProfiles[0] ?? null
  const availableHostIds = useMemo(() => new Set(hosts.map((host) => host.id)), [hosts])
  const errors = useMemo(
    () => validateRemoteDesktopProfileDraft(draft, availableHostIds),
    [availableHostIds, draft],
  )
  const dirty = editing && !remoteDesktopProfileDraftsEqual(draft, baseline)
  const operationBusy = pendingAction !== null
  const busy = actionBusy || operationBusy

  useEffect(() => {
    if (!open || editing) {
      return
    }
    if (!selectedId || !visibleProfiles.some((profile) => profile.id === selectedId)) {
      setSelectedId(visibleProfiles[0]?.id ?? '')
    }
  }, [editing, open, selectedId, visibleProfiles])

  useEffect(() => {
    if (editing && editingProfileId && !editingProfile) {
      setEditing(false)
      setEditingProfileId(null)
      setSubmitted(false)
    }
  }, [editing, editingProfile, editingProfileId])

  useEffect(() => {
    if (!editing && selected) {
      const next = remoteDesktopProfileToDraft(selected)
      setDraft(next)
      setBaseline(next)
      setSubmitted(false)
    }
  }, [editing, selected])

  const save = async (connectAfterSave: boolean) => {
    setSubmitted(true)
    if (hasRemoteDesktopProfileDraftErrors(errors) || busy) {
      if (!busy) {
        notification.warning({
          title: t('remoteDesktop.profileInvalid'),
          description: t('remoteDesktop.profileInvalidHint'),
          className: termousNotificationClassName,
        })
      }
      return
    }
    setPendingAction(connectAfterSave ? 'save_connect' : 'save')
    try {
      const input = normalizeRemoteDesktopProfileDraft(draft)
      const saved = editingProfileId
        ? await onUpdate(editingProfileId, input)
        : await onCreate(input)
      const savedDraft = remoteDesktopProfileToDraft(saved)
      setSelectedId(saved.id)
      setDraft(savedDraft)
      setBaseline(savedDraft)
      setEditing(false)
      setEditingProfileId(null)
      setSubmitted(false)
      if (connectAfterSave) {
        try {
          await onConnect(saved.id)
          onClose()
        } catch (error) {
          notification.error({
            title: t('remoteDesktop.connectFailed'),
            description: publicError(error, t('app.error')),
            className: termousNotificationClassName,
          })
        }
      }
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.profileSaveFailed'),
        description: publicError(error, t('app.error')),
        className: termousNotificationClassName,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const deleteProfile = async (profileId: string) => {
    if (!profiles.some((profile) => profile.id === profileId) || busy) {
      return
    }
    setPendingAction('delete')
    try {
      await onDelete(profileId)
      const remaining = visibleProfiles.filter((profile) => profile.id !== profileId)
      setSelectedId(remaining[0]?.id ?? '')
      setEditing(false)
      setEditingProfileId(null)
      setSubmitted(false)
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.profileDeleteFailed'),
        description: publicError(error, t('app.error')),
        className: termousNotificationClassName,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const startNew = () => {
    const next = createRemoteDesktopProfileDraft(hosts[0]?.id ?? '')
    setDraft(next)
    setBaseline(next)
    setEditing(true)
    setEditingProfileId(null)
    setSubmitted(false)
  }

  const startEdit = () => {
    if (!selected) {
      return
    }
    const next = remoteDesktopProfileToDraft(selected)
    setDraft(next)
    setBaseline(next)
    setEditing(true)
    setEditingProfileId(selected.id)
    setSubmitted(false)
  }

  const connectProfile = async (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId)
    if (busy || !profile || !availableHostIds.has(profile.ssh_host_id)) {
      return
    }
    setSelectedId(profileId)
    setEditing(false)
    setEditingProfileId(null)
    setSubmitted(false)
    setPendingAction('connect')
    try {
      await onConnect(profileId)
      onClose()
    } catch (error) {
      notification.error({
        title: t('remoteDesktop.connectFailed'),
        description: publicError(error, t('app.error')),
        className: termousNotificationClassName,
      })
    } finally {
      setPendingAction(null)
    }
  }

  const applyIntent = async (intent: LauncherIntent) => {
    if (intent.type === 'close') {
      setEditing(false)
      setEditingProfileId(null)
      setSubmitted(false)
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
      setEditingProfileId(null)
      setSubmitted(false)
      return
    }
    if (intent.type === 'connect') {
      await connectProfile(intent.profileId)
      return
    }
    setEditing(false)
    setEditingProfileId(null)
    setSubmitted(false)
    if (selected) {
      const next = remoteDesktopProfileToDraft(selected)
      setDraft(next)
      setBaseline(next)
    }
  }

  const requestIntent = (intent: LauncherIntent) => {
    if (busy) {
      return
    }
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
      rootClassName: confirmDialogStyles['modal-root'],
      title: t('remoteDesktop.discardDraftTitle'),
      content: t('remoteDesktop.discardDraftDescription'),
      okText: t('remoteDesktop.discardDraft'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      onOk: () => {
        const pendingIntent = pendingIntentRef.current
        if (pendingIntent) {
          void applyIntent(pendingIntent)
        }
      },
      afterClose: () => {
        confirmationOpenRef.current = false
        pendingIntentRef.current = null
      },
    })
  }

  const editorOnly = profiles.length === 0 && editing
  const showOnboarding = profiles.length === 0 && !editing
  const selectedHost = selected
    ? hosts.find((host) => host.id === selected.ssh_host_id)
    : undefined

  return (
    <Modal
      open={open}
      centered
      width={960}
      title={(
        <span className={styles['modal-title']}>
          <MonitorPlay size={16} aria-hidden="true" />
          <span>{t('remoteDesktop.launcherTitle')}</span>
          <small aria-hidden="true">{profiles.length}</small>
        </span>
      )}
      footer={null}
      destroyOnHidden
      closable={!busy}
      mask={{ closable: !busy }}
      keyboard={!busy}
      className={`${styles.modal} termous-modal`}
      rootClassName={`${confirmDialogStyles['modal-root']} ${styles['modal-root']}`}
      onCancel={busy ? undefined : () => requestIntent({ type: 'close' })}
    >
      <section className={styles.launcher}>
        <div className={`${styles.body} ${showOnboarding ? styles['is-empty'] : ''} ${editorOnly ? styles['is-editor-only'] : ''}`}>
          {showOnboarding ? (
            <main className={styles.onboarding}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={(
                  <div className={styles['onboarding-copy']}>
                    <h2>{t('remoteDesktop.emptyProfilesTitle')}</h2>
                    <p>{t(hosts.length === 0
                      ? 'remoteDesktop.emptyProfilesNoHostsDescription'
                      : 'remoteDesktop.emptyProfilesDescription')}</p>
                  </div>
                )}
              >
                <ConnectionActionButton
                  icon={<Plus size={16} />}
                  disabled={busy || hosts.length === 0}
                  onClick={() => requestIntent({ type: 'new' })}
                >
                  {t('remoteDesktop.newProfile')}
                </ConnectionActionButton>
              </Empty>
            </main>
          ) : (
            <>
              {!editorOnly ? (
                <RemoteDesktopProfileCatalog
                  profiles={visibleProfiles}
                  hosts={hosts}
                  query={query}
                  selectedId={editing && editingProfileId === null ? '' : selected?.id ?? ''}
                  disabled={busy}
                  onQueryChange={setQuery}
                  onSelect={(profileId) => requestIntent({ type: 'select', profileId })}
                  onConnect={(profileId) => requestIntent({ type: 'connect', profileId })}
                  onCreate={() => requestIntent({ type: 'new' })}
                />
              ) : null}
              {editing ? (
                <RemoteDesktopProfileEditor
                  key={editingProfileId ?? 'create'}
                  mode={editingProfileId ? 'edit' : 'create'}
                  profileName={editingProfile?.name}
                  draft={draft}
                  errors={errors}
                  submitted={submitted}
                  hosts={hosts}
                  disabled={busy}
                  saving={pendingAction === 'save'}
                  savingAndConnecting={pendingAction === 'save_connect'}
                  deleting={pendingAction === 'delete'}
                  onChange={setDraft}
                  onCancel={() => requestIntent({ type: 'cancel_edit' })}
                  onSave={() => void save(false)}
                  onSaveAndConnect={() => void save(true)}
                  onDelete={editingProfileId ? () => deleteProfile(editingProfileId) : undefined}
                />
              ) : selected ? (
                <RemoteDesktopProfileOverview
                  profile={selected}
                  host={selectedHost}
                  disabled={busy}
                  connecting={pendingAction === 'connect' || pendingAction === 'save_connect'}
                  deleting={pendingAction === 'delete'}
                  onEdit={startEdit}
                  onDelete={() => deleteProfile(selected.id)}
                  onConnect={() => void connectProfile(selected.id)}
                />
              ) : (
                <main className={styles['selection-empty']}>
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={(
                      <div className={styles['selection-empty-copy']}>
                        <h2>{t('remoteDesktop.noProfiles')}</h2>
                        <p>{t('remoteDesktop.noProfilesHint')}</p>
                      </div>
                    )}
                  />
                </main>
              )}
            </>
          )}
        </div>
      </section>
    </Modal>
  )
}

function publicError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }
  const message = String(error)
  return message && message !== '[object Object]' ? message : fallback
}
