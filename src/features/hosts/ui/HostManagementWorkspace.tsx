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
import type { HostAccessWorkspaceGateway, HostProvisionGateway } from '#features/host-access'
import type { AgentLaunchRequest } from '#entities/agent'
import {
  type HostGroup,
  type HostIcon,
  type HostIconReorderItem,
} from '#entities/host'
import type { HostAsset, HostProvisionInput } from '#entities/host-asset'
import { HostCatalog } from './HostCatalog'
import { HostAccessWorkspace } from './HostAccessWorkspace'
import { HostCreateEditor } from './HostCreateEditor'
import { HostIconManagerModal } from './HostIconManagerModal'
import { ProxyManagerModal } from './ProxyManagerModal'
import type { HostManagementData } from '../model/types.ts'
import { buildHostDirectoryItems } from '../model/hostDirectory.ts'
import type { HostDetailView } from '../model/useHostAccessWorkspaceController.ts'
import type { HostEditorSection } from './HostEditorShell.tsx'
import styles from './HostManagement.module.scss'

export interface HostManagementWorkspaceProps {
  data: HostManagementData
  selectedHostId: string
  entryIntent?: HostManagementEntryIntent | null
  onEntryIntentHandled?: (key: number) => void
  accessIntent?: HostAccessIntent | null
  onAccessIntentHandled?: (key: number) => void
  actionBusy: boolean
  accessGateway: HostAccessWorkspaceGateway & HostProvisionGateway
  onSelectHost: (hostId: string) => void
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
  onRenameHostIcon: (id: string, displayName: string) => Promise<HostIcon>
  onReorderHostIcons: (items: HostIconReorderItem[]) => Promise<HostIcon[]>
  onDeleteHostIcon: (id: string) => Promise<void>
  getHostIconUrl: (iconId: string) => string
  onDirtyChange?: (dirty: boolean) => void
  onSavingChange?: (saving: boolean) => void
  onLaunchAgent?: (intent: AgentLaunchRequest) => void
}

export interface HostAccessIntent {
  key: number
  hostId: string
}

export type HostManagementEntryTarget =
  | { mode: 'catalog' }
  | { mode: 'create' }
  | { mode: 'edit'; hostId: string }

export type HostManagementEntryIntent = HostManagementEntryTarget & { key: number }

type HostIntent =
  | { type: 'select'; hostId: string; external?: boolean }
  | { type: 'create' }
  | { type: 'back' }

export function HostManagementWorkspace({
  data,
  selectedHostId,
  entryIntent = null,
  onEntryIntentHandled,
  accessIntent = null,
  onAccessIntentHandled,
  actionBusy,
  accessGateway,
  onSelectHost,
  onDelete,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onReorderGroups,
  onCreateProxy,
  onUpdateProxy,
  onDeleteProxy,
  onUploadHostIcon,
  onRenameHostIcon,
  onReorderHostIcons,
  onDeleteHostIcon,
  getHostIconUrl,
  onDirtyChange,
  onSavingChange,
  onLaunchAgent,
}: HostManagementWorkspaceProps) {
  const { t } = useTranslation()
  const initialEntryIntentRef = useRef(entryIntent)
  const initialEntryIntent = initialEntryIntentRef.current
  const initialEntryMode = initialEntryIntent?.mode
  const initialAssetId = initialEntryIntent?.mode === 'edit'
    ? initialEntryIntent.hostId
    : (initialEntryIntent ? '' : selectedHostId)
  const initialAsset = data.hostAssets.find((host) => host.id === initialAssetId)
  const [editingId, setEditingId] = useState<string | null>(initialAsset?.id ?? null)
  const [editingAssetSnapshot, setEditingAssetSnapshot] = useState(initialAsset)
  const [createdAsset, setCreatedAsset] = useState<HostAsset>()
  const [initialView, setInitialView] = useState<HostDetailView>('asset')
  const [initialConnectionSetupConsidered, setInitialConnectionSetupConsidered] = useState(false)
  const [activeView, setActiveView] = useState<ManagementWorkspaceView>(
    initialEntryMode === 'create' || initialAsset ? 'editor' : 'catalog',
  )
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [proxyManagerOpen, setProxyManagerOpen] = useState(false)
  const [iconManagerOpen, setIconManagerOpen] = useState(false)
  const [pendingIntent, setPendingIntent] = useState<HostIntent | null>(null)
  const [saveInFlight, setSaveInFlight] = useState(false)
  const saveInFlightRef = useRef(false)
  const mountedRef = useRef(false)
  const onSavingChangeRef = useRef(onSavingChange)
  onSavingChangeRef.current = onSavingChange
  const [accessDirty, setAccessDirty] = useState(false)
  const [accessProtectedIconId, setAccessProtectedIconId] = useState('')
  const [accessWorkspaceRevision, setAccessWorkspaceRevision] = useState(0)
  const [createWorkspaceRevision, setCreateWorkspaceRevision] = useState(0)
  const lastEntryIntentRef = useRef(initialEntryIntentRef.current?.key ?? 0)
  const acknowledgedEntryIntentRef = useRef(0)
  const ignoredExternalSelectionRef = useRef(
    initialEntryMode === 'catalog' || initialEntryMode === 'create' ? selectedHostId : '',
  )
  const dirty = accessDirty
  const busy = actionBusy || saveInFlight
  // 创建响应先用于编辑器，避免工作区快照尚未同步时退回新建页。
  const hostAssets = useMemo(() => createdAsset && !data.hostAssets.some((host) => host.id === createdAsset.id)
    ? [...data.hostAssets, createdAsset] : data.hostAssets, [createdAsset, data.hostAssets])
  const directoryItems = useMemo(
    () => buildHostDirectoryItems(hostAssets, data.sshAccessProfiles),
    [hostAssets, data.sshAccessProfiles],
  )
  const listedEditingAsset = useMemo(
    () => hostAssets.find((host) => host.id === editingId),
    [hostAssets, editingId],
  )
  // 已打开的资产从全局目录消失时保留编辑器实例，避免尚未处理的草稿被替换成空白新建。
  const editingAsset = listedEditingAsset
    ?? (editingAssetSnapshot?.id === editingId ? editingAssetSnapshot : undefined)
  const groupItemCounts = useMemo(() => hostAssets.reduce<Record<string, number>>((counts, host) => {
    if (host.group_id) counts[host.group_id] = (counts[host.group_id] ?? 0) + 1
    return counts
  }, {}), [hostAssets])

  useEffect(() => {
    if (createdAsset && data.hostAssets.some((host) => host.id === createdAsset.id)) setCreatedAsset(undefined)
  }, [createdAsset, data.hostAssets])

  useEffect(() => {
    if (listedEditingAsset) setEditingAssetSnapshot(listedEditingAsset)
  }, [listedEditingAsset])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      onSavingChangeRef.current?.(false)
    }
  }, [])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => () => {
    onDirtyChange?.(false)
  }, [onDirtyChange])

  const loadHost = useCallback((hostId: string, updateParent = true) => {
    const asset = hostAssets.find((item) => item.id === hostId)
    if (!asset) {
      return
    }
    setEditingId(asset.id)
    setEditingAssetSnapshot(asset)
    setInitialView('asset')
    setInitialConnectionSetupConsidered(false)
    setActiveView('editor')
    setAccessDirty(false)
    setAccessProtectedIconId('')
    ignoredExternalSelectionRef.current = ''
    if (updateParent && selectedHostId !== asset.id) {
      onSelectHost(asset.id)
    }
  }, [hostAssets, onSelectHost, selectedHostId])

  useEffect(() => {
    if (!editingId || !editingAssetSnapshot || listedEditingAsset || dirty || busy) return
    const remaining = hostAssets[0]
    if (remaining) {
      loadHost(remaining.id)
      return
    }
    setActiveView('catalog')
    if (selectedHostId === editingId) onSelectHost('')
  }, [busy, dirty, editingAssetSnapshot, editingId, hostAssets, listedEditingAsset, loadHost, onSelectHost, selectedHostId])

  const startCreate = useCallback(() => {
    ignoredExternalSelectionRef.current = selectedHostId
    setEditingId(null)
    setInitialView('asset')
    setInitialConnectionSetupConsidered(false)
    setActiveView('editor')
    setCreateWorkspaceRevision((current) => current + 1)
    setAccessDirty(false)
    setAccessProtectedIconId('')
  }, [selectedHostId])

  const applyIntent = useCallback((intent: HostIntent) => {
    if (intent.type === 'select') {
      loadHost(intent.hostId, !intent.external)
      return
    }
    if (intent.type === 'create') {
      startCreate()
      return
    }
    setActiveView('catalog')
    setInitialView('asset')
    setInitialConnectionSetupConsidered(false)
    if (accessDirty) {
      setAccessWorkspaceRevision((current) => current + 1)
      setCreateWorkspaceRevision((current) => current + 1)
      setAccessDirty(false)
      setAccessProtectedIconId('')
    }
  }, [accessDirty, loadHost, startCreate])

  const requestIntent = useCallback((intent: HostIntent) => {
    if (saveInFlightRef.current) return
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
    if (
      entryIntent?.mode === 'edit'
      && entryIntent.hostId === selectedHostId
    ) {
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
  }, [editingId, entryIntent, requestIntent, saveInFlight, selectedHostId])

  useEffect(() => {
    if (!entryIntent || entryIntent.key === acknowledgedEntryIntentRef.current) {
      return
    }
    if (entryIntent.key !== lastEntryIntentRef.current) {
      if (saveInFlight) {
        return
      }
      lastEntryIntentRef.current = entryIntent.key
      requestIntent(entryIntent.mode === 'edit'
        ? { type: 'select', hostId: entryIntent.hostId, external: true }
        : { type: entryIntent.mode === 'create' ? 'create' : 'back' })
    }
    acknowledgedEntryIntentRef.current = entryIntent.key
    onEntryIntentHandled?.(entryIntent.key)
  }, [entryIntent, onEntryIntentHandled, requestIntent, saveInFlight])

  const createHost = async (input: HostProvisionInput, section: HostEditorSection) => {
    if (saveInFlightRef.current) return
    saveInFlightRef.current = true
    onSavingChangeRef.current?.(true)
    setSaveInFlight(true)
    try {
      const { host: saved } = await accessGateway.provisionHost(input)
      if (!mountedRef.current) return
      setCreatedAsset(saved)
      setEditingAssetSnapshot(saved)
      setEditingId(saved.id)
      setInitialView(section === 'connections' ? 'access' : 'asset')
      setInitialConnectionSetupConsidered(true)
      setAccessDirty(false)
      setAccessProtectedIconId('')
      onSelectHost(saved.id)
    } finally {
      saveInFlightRef.current = false
      if (mountedRef.current) {
        setSaveInFlight(false)
        onSavingChangeRef.current?.(false)
      }
    }
  }

  const removeCurrentHost = async () => {
    if (!editingId) {
      return false
    }
    const currentIndex = hostAssets.findIndex((host) => host.id === editingId)
    const removed = await onDelete(editingId)
    if (!removed) {
      return false
    }
    const remaining = hostAssets.filter((host) => host.id !== editingId)
    if (createdAsset?.id === editingId) setCreatedAsset(undefined)
    const next = remaining[Math.min(currentIndex, remaining.length - 1)]
    if (next) {
      loadHost(next.id)
    } else {
      setEditingId(null)
      setInitialView('asset')
      setInitialConnectionSetupConsidered(false)
      setActiveView('catalog')
      setAccessDirty(false)
      setAccessProtectedIconId('')
      onSelectHost('')
    }
    return true
  }

  const cancelPendingIntent = () => {
    if (pendingIntent?.type === 'select' && pendingIntent.external) {
      ignoredExternalSelectionRef.current = pendingIntent.hostId
      onSelectHost(editingId ?? '')
      if (accessIntent?.hostId === pendingIntent.hostId) {
        onAccessIntentHandled?.(accessIntent.key)
      }
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
        catalog={<HostCatalog items={directoryItems} groups={data.groups} selectedHostId={editingId} actionBusy={busy} getHostIconUrl={getHostIconUrl} onSelect={(hostId) => requestIntent({ type: 'select', hostId })} onCreate={() => requestIntent({ type: 'create' })} onManageGroups={() => setGroupManagerOpen(true)} onManageProxies={() => setProxyManagerOpen(true)} onManageIcons={() => setIconManagerOpen(true)} />}
        editor={editingAsset ? (
          <HostAccessWorkspace
            key={`${editingAsset.id}:${accessWorkspaceRevision}`}
            host={editingAsset}
            data={data}
            gateway={accessGateway}
            initialView={initialView}
            initialConnectionSetupConsidered={initialConnectionSetupConsidered}
            openAccessIntentKey={
              accessIntent?.hostId === editingAsset.id ? accessIntent.key : 0
            }
            onAccessIntentHandled={onAccessIntentHandled}
            actionBusy={busy}
            getHostIconUrl={getHostIconUrl}
            onBack={() => requestIntent({ type: 'back' })}
            onDeleteHost={removeCurrentHost}
            onCreateGroup={onCreateGroup}
            onManageProxies={() => setProxyManagerOpen(true)}
            onManageIcons={() => setIconManagerOpen(true)}
            onDirtyChange={setAccessDirty}
            onProtectedIconIdChange={setAccessProtectedIconId}
            onLaunchAgent={onLaunchAgent}
          />
        ) : (
          <HostCreateEditor
            key={`new:${createWorkspaceRevision}`} data={data} busy={busy}
            getHostIconUrl={getHostIconUrl} onBack={() => requestIntent({ type: 'back' })}
            onCreate={createHost} onDirtyChange={setAccessDirty}
            onProtectedIconIdChange={setAccessProtectedIconId}
            onCreateGroup={onCreateGroup} onManageIcons={() => setIconManagerOpen(true)}
            onManageProxies={() => setProxyManagerOpen(true)}
          />
        )}
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
        onDelete={onDeleteProxy}
      />
      <HostIconManagerModal
        open={iconManagerOpen}
        hostIcons={data.hostIcons}
        hosts={hostAssets}
        protectedIconIds={accessProtectedIconId ? [accessProtectedIconId] : []}
        actionBusy={actionBusy}
        getIconUrl={getHostIconUrl}
        onClose={() => setIconManagerOpen(false)}
        onUpload={onUploadHostIcon}
        onRename={onRenameHostIcon}
        onReorder={onReorderHostIcons}
        onDelete={onDeleteHostIcon}
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
