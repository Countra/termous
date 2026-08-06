import { App as AntdApp } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ConfirmDialog,
  GroupManagerModal,
  ManagementWorkspace,
  type ManagementWorkspaceView,
} from '#shared/ui'
import type { GroupReorderItem } from '#shared/model'
import type {
  ConnectionProxy,
  ConnectionProxyInput,
} from '#entities/connection-proxy'
import {
  MAX_HOST_ICON_BYTES,
  createBlankHostInput,
  hostInputsEqual,
  hostToInput,
  normalizeHostInput,
  validateHostInput,
  type Host,
  type HostGroup,
  type HostIcon,
  type HostInput,
} from '#entities/host'
import { HostCatalog } from './HostCatalog'
import { HostEditor } from './HostEditor'
import { ProxyManagerModal } from './ProxyManagerModal'
import type { HostManagementData } from '../model/types.ts'
import styles from './HostManagement.module.scss'

export interface HostManagementWorkspaceProps {
  data: HostManagementData
  selectedHostId: string
  createIntentKey?: number
  actionBusy: boolean
  onSelectHost: (hostId: string) => void
  onSave: (id: string | null, input: HostInput) => Promise<Host | undefined>
  onDelete: (id: string) => Promise<boolean | undefined>
  onCreateGroup: (name: string) => Promise<HostGroup>
  onRenameGroup: (id: string, name: string) => Promise<HostGroup | undefined>
  onDeleteGroup: (id: string) => Promise<void>
  onReorderGroups: (items: GroupReorderItem[]) => Promise<HostGroup[] | undefined>
  onCreateProxy: (input: ConnectionProxyInput) => Promise<ConnectionProxy | undefined>
  onUpdateProxy: (
    id: string,
    input: ConnectionProxyInput,
  ) => Promise<ConnectionProxy | undefined>
  onDeleteProxy: (id: string) => Promise<boolean | undefined>
  onUploadHostIcon: (file: File) => Promise<HostIcon>
  onDeleteHostIcon: (id: string) => Promise<void>
  getHostIconUrl: (iconId: string) => string
}

type HostIntent =
  | { type: 'select'; hostId: string; external?: boolean }
  | { type: 'create' }
  | { type: 'back' }

export function HostManagementWorkspace({
  data,
  selectedHostId,
  createIntentKey = 0,
  actionBusy,
  onSelectHost,
  onSave,
  onDelete,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onReorderGroups,
  onCreateProxy,
  onUpdateProxy,
  onDeleteProxy,
  onUploadHostIcon,
  onDeleteHostIcon,
  getHostIconUrl,
}: HostManagementWorkspaceProps) {
  const { t } = useTranslation()
  const { message } = AntdApp.useApp()
  const initialHost = data.hosts.find((host) => host.id === selectedHostId)
  const initialInput = initialHost ? normalizeHostInput(hostToInput(initialHost)) : createBlankHostInput()
  const [editingId, setEditingId] = useState<string | null>(initialHost?.id ?? null)
  const [draft, setDraft] = useState<HostInput>(initialInput)
  const [baseline, setBaseline] = useState<HostInput>(initialInput)
  const [activeView, setActiveView] = useState<ManagementWorkspaceView>(initialHost ? 'editor' : 'catalog')
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [proxyManagerOpen, setProxyManagerOpen] = useState(false)
  const [pendingIntent, setPendingIntent] = useState<HostIntent | null>(null)
  const [uploadingIcon, setUploadingIcon] = useState(false)
  const [saveInFlight, setSaveInFlight] = useState(false)
  const pendingIconIdRef = useRef('')
  const pendingCleanupIconIdsRef = useRef<Set<string>>(new Set())
  const mountedRef = useRef(true)
  const deleteHostIconRef = useRef(onDeleteHostIcon)
  const lastCreateIntentRef = useRef(0)
  const ignoredExternalSelectionRef = useRef('')
  const dirty = useMemo(() => !hostInputsEqual(draft, baseline), [baseline, draft])
  const editingHost = useMemo(() => data.hosts.find((host) => host.id === editingId), [data.hosts, editingId])
  const groupItemCounts = useMemo(() => data.hosts.reduce<Record<string, number>>((counts, host) => {
    if (host.group_id) counts[host.group_id] = (counts[host.group_id] ?? 0) + 1
    return counts
  }, {}), [data.hosts])
  const validCredentialIds = useMemo(() => new Set(data.credentials
    .filter((credential) => credential.type === (draft.auth_method === 'password' ? 'password' : 'private_key'))
    .map((credential) => credential.id)), [data.credentials, draft.auth_method])
  const errors = useMemo(() => {
    const next = validateHostInput(draft, {
      address: t('hosts.validation.addressRequired'),
      port: t('hosts.validation.portRange'),
      username: t('hosts.validation.usernameRequired'),
      credentialId: t('hosts.validation.credentialRequired'),
    })
    if (draft.credential_id && !validCredentialIds.has(draft.credential_id)) {
      next.credentialId = t('hosts.validation.credentialMismatch')
    }
    if (draft.proxy_id && !data.proxies.some((proxy) => proxy.id === draft.proxy_id)) {
      next.proxyId = t('hosts.validation.proxyMissing')
    }
    return next
  }, [data.proxies, draft, t, validCredentialIds])

  useEffect(() => {
    deleteHostIconRef.current = onDeleteHostIcon
  }, [onDeleteHostIcon])

  useEffect(() => {
    mountedRef.current = true
    const pendingCleanupIconIds = pendingCleanupIconIdsRef.current
    return () => {
      mountedRef.current = false
      const iconIds = new Set(pendingCleanupIconIds)
      if (pendingIconIdRef.current) {
        iconIds.add(pendingIconIdRef.current)
      }
      pendingIconIdRef.current = ''
      for (const iconId of iconIds) {
        void deleteHostIconRef.current(iconId).catch(() => undefined)
      }
    }
  }, [])

  const releasePendingIcon = useCallback(() => {
    const iconId = pendingIconIdRef.current
    if (!iconId) {
      return
    }
    pendingIconIdRef.current = ''
    void deleteHostIconRef.current(iconId).catch(() => {
      pendingCleanupIconIdsRef.current.add(iconId)
    })
  }, [])

  const loadHost = useCallback((hostId: string, updateParent = true) => {
    const host = data.hosts.find((item) => item.id === hostId)
    if (!host) {
      return
    }
    releasePendingIcon()
    const input = normalizeHostInput(hostToInput(host))
    setEditingId(host.id)
    setDraft(input)
    setBaseline(input)
    setActiveView('editor')
    ignoredExternalSelectionRef.current = ''
    if (updateParent && selectedHostId !== host.id) {
      onSelectHost(host.id)
    }
  }, [data.hosts, onSelectHost, releasePendingIcon, selectedHostId])

  const startCreate = useCallback(() => {
    releasePendingIcon()
    ignoredExternalSelectionRef.current = selectedHostId
    const input = createBlankHostInput()
    setEditingId(null)
    setDraft(input)
    setBaseline(input)
    setActiveView('editor')
  }, [releasePendingIcon, selectedHostId])

  const applyIntent = useCallback((intent: HostIntent) => {
    if (intent.type === 'select') {
      loadHost(intent.hostId, !intent.external)
      return
    }
    if (intent.type === 'create') {
      startCreate()
      return
    }
    releasePendingIcon()
    setDraft(baseline)
    setActiveView('catalog')
  }, [baseline, loadHost, releasePendingIcon, startCreate])

  const requestIntent = useCallback((intent: HostIntent) => {
    if (intent.type === 'select' && intent.hostId === editingId) {
      setActiveView('editor')
      return
    }
    if (dirty) {
      setPendingIntent(intent)
      return
    }
    applyIntent(intent)
  }, [applyIntent, dirty, editingId])

  useEffect(() => {
    if (saveInFlight) {
      return
    }
    if (selectedHostId && selectedHostId === editingId) {
      ignoredExternalSelectionRef.current = ''
      return
    }
    if (!selectedHostId || ignoredExternalSelectionRef.current === selectedHostId) {
      return
    }
    requestIntent({ type: 'select', hostId: selectedHostId, external: true })
  }, [editingId, requestIntent, saveInFlight, selectedHostId])

  useEffect(() => {
    if (createIntentKey <= 0 || createIntentKey === lastCreateIntentRef.current) {
      return
    }
    lastCreateIntentRef.current = createIntentKey
    requestIntent({ type: 'create' })
  }, [createIntentKey, requestIntent])

  useEffect(() => {
    if (!editingHost || dirty) {
      return
    }
    const next = normalizeHostInput(hostToInput(editingHost))
    if (!hostInputsEqual(next, baseline)) {
      setDraft(next)
      setBaseline(next)
    }
  }, [baseline, dirty, editingHost])

  const save = async () => {
    setSaveInFlight(true)
    try {
      const saved = await onSave(editingId, normalizeHostInput(draft))
      if (!saved) {
        return
      }
      pendingIconIdRef.current = ''
      const next = normalizeHostInput(hostToInput(saved))
      setEditingId(saved.id)
      setDraft(next)
      setBaseline(next)
      onSelectHost(saved.id)
    } finally {
      setSaveInFlight(false)
    }
  }

  const removeCurrentHost = async () => {
    if (!editingId) {
      return
    }
    const currentIndex = data.hosts.findIndex((host) => host.id === editingId)
    const removed = await onDelete(editingId)
    if (!removed) {
      return
    }
    releasePendingIcon()
    const remaining = data.hosts.filter((host) => host.id !== editingId)
    const next = remaining[Math.min(currentIndex, remaining.length - 1)]
    if (next) {
      loadHost(next.id)
    } else {
      const empty = createBlankHostInput()
      setEditingId(null)
      setDraft(empty)
      setBaseline(empty)
      setActiveView('catalog')
      onSelectHost('')
    }
  }

  const uploadIcon = async (file: File) => {
    const validationMessage = validateHostIconFile(file, t)
    if (validationMessage) {
      void message.warning(validationMessage)
      return
    }
    setUploadingIcon(true)
    try {
      const uploaded = await onUploadHostIcon(file)
      if (!mountedRef.current) {
        await onDeleteHostIcon(uploaded.id).catch(() => undefined)
        return
      }
      const previous = pendingIconIdRef.current
      pendingIconIdRef.current = uploaded.id
      setDraft((current) => ({ ...current, icon_id: uploaded.id }))
      if (previous && previous !== uploaded.id) {
        void onDeleteHostIcon(previous).catch(() => {
          pendingCleanupIconIdsRef.current.add(previous)
        })
      }
    } catch {
      return
    } finally {
      if (mountedRef.current) {
        setUploadingIcon(false)
      }
    }
  }

  const removeIcon = () => {
    const iconId = draft.icon_id
    setDraft((current) => ({ ...current, icon_id: '' }))
    if (iconId && iconId === pendingIconIdRef.current) {
      pendingIconIdRef.current = ''
      void onDeleteHostIcon(iconId).catch(() => {
        pendingCleanupIconIdsRef.current.add(iconId)
      })
    }
  }

  const cancelPendingIntent = () => {
    if (pendingIntent?.type === 'select' && pendingIntent.external) {
      ignoredExternalSelectionRef.current = pendingIntent.hostId
      onSelectHost(editingId ?? '')
    }
    setPendingIntent(null)
  }

  return (
    <>
      <ManagementWorkspace
        className={`hosts-management-workspace ${styles['workspace-root']}`}
        activeView={activeView}
        catalogLabel={t('hosts.list')}
        editorLabel={t('hosts.editor')}
        catalog={<HostCatalog hosts={data.hosts} groups={data.groups} selectedHostId={editingId} actionBusy={actionBusy} getHostIconUrl={getHostIconUrl} onSelect={(hostId) => requestIntent({ type: 'select', hostId })} onCreate={() => requestIntent({ type: 'create' })} onManageGroups={() => setGroupManagerOpen(true)} onManageProxies={() => setProxyManagerOpen(true)} />}
        editor={<HostEditor key={editingId ?? 'new'} data={data} editingHost={editingHost} draft={draft} dirty={dirty} errors={errors} actionBusy={actionBusy} uploadingIcon={uploadingIcon} getHostIconUrl={getHostIconUrl} onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))} onBack={() => requestIntent({ type: 'back' })} onSave={() => void save()} onDelete={() => void removeCurrentHost()} onDiscard={() => { releasePendingIcon(); setDraft(baseline) }} onCreateGroup={onCreateGroup} onManageProxies={() => setProxyManagerOpen(true)} onUploadIcon={uploadIcon} onRemoveIcon={removeIcon} />}
      />
      <GroupManagerModal
        open={groupManagerOpen}
        groups={data.groups}
        actionBusy={actionBusy}
        title={t('hosts.manageGroups')}
        addLabel={t('hosts.addGroup')}
        namePlaceholder={t('hosts.groupNamePlaceholder')}
        emptyLabel={t('hosts.noGroups')}
        deleteTitle={t('hosts.deleteGroupTitle')}
        deleteDescription={t('hosts.deleteGroupHint')}
        saveLabel={t('app.save')}
        cancelLabel={t('app.cancel')}
        editLabel={t('app.edit')}
        deleteLabel={t('app.delete')}
        reorderLabel={t('app.reorder')}
        moveUpLabel={t('app.moveUp')}
        moveDownLabel={t('app.moveDown')}
        itemCounts={groupItemCounts}
        itemCountLabel={(count) => t('hosts.groupItemCount', { count })}
        onClose={() => setGroupManagerOpen(false)}
        onCreate={onCreateGroup}
        onRename={onRenameGroup}
        onDelete={onDeleteGroup}
        onReorder={onReorderGroups}
      />
      <ProxyManagerModal
        open={proxyManagerOpen}
        proxies={data.proxies}
        actionBusy={actionBusy}
        onClose={() => setProxyManagerOpen(false)}
        onCreate={onCreateProxy}
        onUpdate={onUpdateProxy}
        onDelete={async (id) => {
          const deleted = await onDeleteProxy(id)
          if (deleted && draft.proxy_id === id) {
            setDraft((current) => ({ ...current, proxy_id: '' }))
          }
          return deleted
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingIntent)}
        title={t('hosts.unsavedTitle')}
        description={t('hosts.unsavedDescription')}
        confirmLabel={t('hosts.discardAndContinue')}
        cancelLabel={t('app.cancel')}
        danger
        onCancel={cancelPendingIntent}
        onConfirm={() => {
          const intent = pendingIntent
          setPendingIntent(null)
          if (intent) {
            applyIntent(intent)
          }
        }}
      />
    </>
  )
}

function validateHostIconFile(file: File, t: (key: string) => string) {
  if (file.size <= 0) {
    return t('hosts.icon.emptyFile')
  }
  if (file.size > MAX_HOST_ICON_BYTES) {
    return t('hosts.icon.tooLarge')
  }
  const name = file.name.toLocaleLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.svg', '.ico'].some((extension) => name.endsWith(extension))) {
    return t('hosts.icon.invalidType')
  }
  return ''
}
