import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FileAccessProfileMetadataInput } from '#entities/file-access-profile'
import {
  fileAccessProfileMetadataInputsEqual,
  fileAccessProfileToMetadataInput,
  normalizeFileAccessProfileMetadataInput,
  validateFileAccessProfileMetadataInput,
} from '#entities/file-access-profile'
import type { Host } from '#entities/host'
import {
  hostAssetInputsEqual,
  hostAssetToInput,
  normalizeHostAssetInput,
  validateHostAssetInput,
  type HostAssetInput,
} from '#entities/host-asset'
import {
  createSSHAccessProfileDraft,
  normalizeSSHAccessProfileDraft,
  sshAccessProfileDraftsEqual,
  sshAccessProfileToDraft,
  validateSSHAccessProfileDraft,
  type SSHAccessProfileDraft,
  type SSHAccessProfileReferences,
} from '#entities/ssh-access-profile'
import { TermousApiError } from '#shared/api'
import {
  type HostAccessManagementGateway,
  type HostAccessProfileEditorIntent,
  useHostAccessCatalog,
} from '#features/host-access'
import {
  createVNCAccessProfileDraft,
  normalizeVNCAccessProfileDraft,
  validateVNCAccessProfileDraft,
  vncAccessProfileDraftsEqual,
  vncAccessProfileToDraft,
  type VNCAccessProfileDraft,
} from '#features/manage-remote-desktop'

export type HostDetailView = 'asset' | 'access'

type PendingNavigation =
  | { type: 'view'; view: HostDetailView }
  | { type: 'editor'; intent: HostAccessProfileEditorIntent }
  | { type: 'close-editor' }

export type ProfileDeleteTarget =
  | { kind: 'ssh'; profileId: string; references: SSHAccessProfileReferences }
  | { kind: 'remote_desktop'; profileId: string }

interface ControllerOptions {
  hostId: string
  fallbackHost: Host
  gateway: HostAccessManagementGateway
  t: (key: string, options?: Record<string, unknown>) => string
  onDirtyChange?: (dirty: boolean) => void
  onProtectedIconIdChange?: (iconId: string) => void
}

export function useHostAccessWorkspaceController({
  hostId,
  fallbackHost,
  gateway,
  t,
  onDirtyChange,
  onProtectedIconIdChange,
}: ControllerOptions) {
  const catalogState = useHostAccessCatalog(hostId, gateway)
  const reloadCatalog = catalogState.reload
  const [view, setView] = useState<HostDetailView>('asset')
  const initialAssetDraft = useMemo(() => fallbackHostAssetInput(fallbackHost), [fallbackHost])
  const [assetDraft, setAssetDraft] = useState<HostAssetInput>(initialAssetDraft)
  const [assetBaseline, setAssetBaseline] = useState<HostAssetInput>(initialAssetDraft)
  const appliedAssetRevisionRef = useRef('')
  const [assetSubmitted, setAssetSubmitted] = useState(false)
  const [editor, setEditor] = useState<HostAccessProfileEditorIntent | null>(null)
  const [sshDraft, setSSHDraft] = useState<SSHAccessProfileDraft>(createSSHAccessProfileDraft)
  const [sshBaseline, setSSHBaseline] = useState<SSHAccessProfileDraft>(createSSHAccessProfileDraft)
  const [fileDraft, setFileDraft] = useState<FileAccessProfileMetadataInput>({ name: '' })
  const [fileBaseline, setFileBaseline] = useState<FileAccessProfileMetadataInput>({ name: '' })
  const [vncDraft, setVNCDraft] = useState<VNCAccessProfileDraft>(() => createVNCAccessProfileDraft())
  const [vncBaseline, setVNCBaseline] = useState<VNCAccessProfileDraft>(() => createVNCAccessProfileDraft())
  const [profileSubmitted, setProfileSubmitted] = useState(false)
  const [operationBusy, setOperationBusy] = useState(false)
  const operationBusyRef = useRef(false)
  const [mutationError, setMutationError] = useState('')
  const [pendingNavigation, setPendingNavigation] = useState<PendingNavigation | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ProfileDeleteTarget | null>(null)

  const assetDirty = useMemo(
    () => !hostAssetInputsEqual(assetDraft, assetBaseline),
    [assetBaseline, assetDraft],
  )
  const profileDirty = useMemo(() => {
    if (!editor) return false
    if (editor.kind === 'ssh') return !sshAccessProfileDraftsEqual(sshDraft, sshBaseline)
    if (editor.kind === 'file') return !fileAccessProfileMetadataInputsEqual(fileDraft, fileBaseline)
    return !vncAccessProfileDraftsEqual(vncDraft, vncBaseline)
  }, [editor, fileBaseline, fileDraft, sshBaseline, sshDraft, vncBaseline, vncDraft])
  const dirty = assetDirty || profileDirty
  const assetValidationVisible = assetSubmitted || assetDirty
  const profileValidationVisible = profileSubmitted || profileDirty
  const sshErrors = useMemo(
    () => validateSSHAccessProfileDraft(sshDraft, editor?.kind === 'ssh' && editor.mode === 'edit' ? editor.profileId : ''),
    [editor, sshDraft],
  )
  const fileErrors = useMemo(
    () => validateFileAccessProfileMetadataInput(fileDraft),
    [fileDraft],
  )
  const vncErrors = useMemo(() => validateVNCAccessProfileDraft(
    vncDraft,
    new Set(catalogState.catalog?.ssh.map((profile) => profile.id) ?? []),
  ), [catalogState.catalog?.ssh, vncDraft])
  const assetErrors = useMemo(() => validateHostAssetInput(assetDraft), [assetDraft])

  useEffect(() => {
    const host = catalogState.catalog?.host
    if (!host || assetDirty) return
    if (isStaleOrAppliedAssetRevision(host.updated_at, appliedAssetRevisionRef.current)) return
    const next = hostAssetToInput(host)
    appliedAssetRevisionRef.current = host.updated_at
    setAssetDraft(next)
    setAssetBaseline(next)
  }, [assetDirty, catalogState.catalog?.host])

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    onProtectedIconIdChange?.(assetDirty ? assetDraft.icon_id : '')
  }, [assetDirty, assetDraft.icon_id, onProtectedIconIdChange])

  const toPublicError = useCallback((error: unknown) => {
    if (error instanceof TermousApiError && error.status === 409) {
      return t('hosts.access.conflict')
    }
    return error instanceof Error ? error.message : t('app.error')
  }, [t])

  const applyEditor = useCallback((intent: HostAccessProfileEditorIntent) => {
    const catalog = catalogState.catalog
    if (!catalog) return
    setMutationError('')
    setProfileSubmitted(false)
    if (intent.kind === 'ssh') {
      const source = intent.mode === 'edit'
        ? catalog.ssh.find((profile) => profile.id === intent.profileId)
        : undefined
      if (intent.mode === 'edit' && !source) {
        setMutationError(t('hosts.access.errors.profileMissing'))
        return
      }
      const next = source ? sshAccessProfileToDraft(source) : createSSHAccessProfileDraft()
      setSSHDraft(next)
      setSSHBaseline(next)
    } else if (intent.kind === 'file') {
      const profile = catalog.files.find((item) => item.id === intent.profileId)
      if (!profile) return
      const next = fileAccessProfileToMetadataInput(profile)
      setFileDraft(next)
      setFileBaseline(next)
    } else {
      const defaultSSH = catalog.ssh.find((profile) => profile.is_default) ?? catalog.ssh[0]
      const source = intent.mode === 'edit'
        ? catalog.remote_desktops.find((profile) => profile.id === intent.profileId)
        : undefined
      if (intent.mode === 'edit' && !source) {
        setMutationError(t('hosts.access.errors.profileMissing'))
        return
      }
      const next = source
        ? vncAccessProfileToDraft(source)
        : createVNCAccessProfileDraft(defaultSSH?.id ?? '')
      setVNCDraft(next)
      setVNCBaseline(next)
    }
    setView('access')
    setEditor(intent)
  }, [catalogState.catalog, t])

  const discardProfile = useCallback(() => {
    if (editor?.kind === 'ssh') setSSHDraft(sshBaseline)
    else if (editor?.kind === 'file') setFileDraft(fileBaseline)
    else if (editor?.kind === 'remote_desktop') setVNCDraft(vncBaseline)
    setProfileSubmitted(false)
    setMutationError('')
  }, [editor, fileBaseline, sshBaseline, vncBaseline])

  const applyNavigation = useCallback((navigation: PendingNavigation) => {
    if (navigation.type === 'view') {
      if (navigation.view === 'asset') setEditor(null)
      setView(navigation.view)
    } else if (navigation.type === 'editor') {
      applyEditor(navigation.intent)
    } else {
      setEditor(null)
      setProfileSubmitted(false)
      setMutationError('')
    }
  }, [applyEditor])

  const requestNavigation = useCallback((navigation: PendingNavigation) => {
    const currentDirty = editor ? profileDirty : view === 'asset' ? assetDirty : false
    if (currentDirty) {
      setPendingNavigation(navigation)
      return
    }
    applyNavigation(navigation)
  }, [applyNavigation, assetDirty, editor, profileDirty, view])

  const confirmPendingNavigation = useCallback(() => {
    const navigation = pendingNavigation
    if (!navigation) return
    if (editor) discardProfile()
    else if (view === 'asset') {
      setAssetDraft(assetBaseline)
      setAssetSubmitted(false)
      setMutationError('')
    }
    setPendingNavigation(null)
    applyNavigation(navigation)
  }, [applyNavigation, assetBaseline, discardProfile, editor, pendingNavigation, view])

  const execute = useCallback(async (action: () => Promise<void>) => {
    if (operationBusyRef.current) return false
    operationBusyRef.current = true
    setOperationBusy(true)
    setMutationError('')
    try {
      await action()
      return true
    } catch (error) {
      if (error instanceof TermousApiError && error.status === 409) {
        await reloadCatalog()
      }
      setMutationError(toPublicError(error))
      return false
    } finally {
      operationBusyRef.current = false
      setOperationBusy(false)
    }
  }, [reloadCatalog, toPublicError])

  const saveAsset = useCallback(async () => {
    const catalog = catalogState.catalog
    if (!catalog) return
    setAssetSubmitted(true)
    if (Object.values(assetErrors).some(Boolean)) return
    await execute(async () => {
      const saved = await gateway.updateHostAsset(
        catalog.host.id,
        catalog.host.updated_at,
        normalizeHostAssetInput(assetDraft),
      )
      const next = hostAssetToInput(saved)
      appliedAssetRevisionRef.current = saved.updated_at
      setAssetDraft(next)
      setAssetBaseline(next)
      setAssetSubmitted(false)
      await catalogState.reload()
    })
  }, [assetDraft, assetErrors, catalogState, execute, gateway])

  const saveProfile = useCallback(async () => {
    const catalog = catalogState.catalog
    if (!catalog || !editor) return
    setProfileSubmitted(true)
    if (editor.kind === 'ssh') {
      const invalidName = !sshDraft.name.trim() || Array.from(sshDraft.name.trim()).length > 80
      if (invalidName || Object.values(sshErrors).some(Boolean)) return
      await execute(async () => {
        if (editor.mode === 'create') {
          await gateway.createSSHProfile(hostId, normalizeSSHAccessProfileDraft(sshDraft))
        } else {
          const source = catalog.ssh.find((profile) => profile.id === editor.profileId)
          if (!source) throw new Error(t('hosts.access.errors.profileMissing'))
          await gateway.updateSSHProfile(source.id, source.updated_at, normalizeSSHAccessProfileDraft(sshDraft))
        }
        setEditor(null)
        await catalogState.reload()
      })
      return
    }
    if (editor.kind === 'file') {
      if (Object.values(fileErrors).some(Boolean)) return
      await execute(async () => {
        const source = catalog.files.find((profile) => profile.id === editor.profileId)
        if (!source) throw new Error(t('hosts.access.errors.profileMissing'))
        await gateway.updateFileProfile(
          source.id,
          source.updated_at,
          normalizeFileAccessProfileMetadataInput(fileDraft),
        )
        setEditor(null)
        await catalogState.reload()
      })
      return
    }
    if (Object.values(vncErrors).some(Boolean)) return
    await execute(async () => {
      const input = normalizeVNCAccessProfileDraft(hostId, vncDraft)
      if (editor.mode === 'create') {
        await gateway.createRemoteDesktopProfile(input)
      } else {
        const source = catalog.remote_desktops.find((profile) => profile.id === editor.profileId)
        if (!source) throw new Error(t('hosts.access.errors.profileMissing'))
        await gateway.updateRemoteDesktopProfile(source.id, source.updated_at, input)
      }
      setEditor(null)
      await catalogState.reload()
    })
  }, [catalogState, editor, execute, fileDraft, fileErrors, gateway, hostId, sshDraft, sshErrors, t, vncDraft, vncErrors])

  const setDefaultProfile = useCallback(async (kind: 'ssh' | 'file' | 'remote_desktop', profileId: string) => {
    const catalog = catalogState.catalog
    if (!catalog) return
    await execute(async () => {
      if (kind === 'ssh') {
        const profile = catalog.ssh.find((item) => item.id === profileId)
        if (!profile) throw new Error(t('hosts.access.errors.profileMissing'))
        await gateway.setDefaultSSHProfile(profile.id, profile.updated_at)
      } else if (kind === 'file') {
        const profile = catalog.files.find((item) => item.id === profileId)
        if (!profile) throw new Error(t('hosts.access.errors.profileMissing'))
        await gateway.setDefaultFileProfile(profile.id, profile.updated_at)
      } else {
        const profile = catalog.remote_desktops.find((item) => item.id === profileId)
        if (!profile) throw new Error(t('hosts.access.errors.profileMissing'))
        await gateway.setDefaultRemoteDesktopProfile(profile.id, profile.updated_at)
      }
      await catalogState.reload()
    })
  }, [catalogState, execute, gateway, t])

  const requestDeleteSSH = useCallback(async (profileId: string) => {
    await execute(async () => {
      const references = await gateway.inspectSSHProfileReferences(profileId)
      setDeleteTarget({ kind: 'ssh', profileId, references })
    })
  }, [execute, gateway])

  const confirmDeleteProfile = useCallback(async () => {
    const target = deleteTarget
    const catalog = catalogState.catalog
    if (!target || !catalog) return
    if (target.kind === 'ssh' && target.references.blocking_total > 0) {
      setDeleteTarget(null)
      return
    }
    const deleted = await execute(async () => {
      if (target.kind === 'ssh') {
        const profile = catalog.ssh.find((item) => item.id === target.profileId)
        if (!profile) throw new Error(t('hosts.access.errors.profileMissing'))
        await gateway.deleteSSHProfile(profile.id, profile.updated_at)
      } else {
        const profile = catalog.remote_desktops.find((item) => item.id === target.profileId)
        if (!profile) throw new Error(t('hosts.access.errors.profileMissing'))
        await gateway.deleteRemoteDesktopProfile(profile.id, profile.updated_at)
      }
      if (editor && 'profileId' in editor && editor.profileId === target.profileId) setEditor(null)
      await catalogState.reload()
    })
    if (deleted) setDeleteTarget(null)
  }, [catalogState, deleteTarget, editor, execute, gateway, t])

  const profileSaveDisabled = useMemo(() => {
    if (!editor || !profileDirty) return true
    if (editor.kind === 'ssh') {
      return !sshDraft.name.trim()
        || Array.from(sshDraft.name.trim()).length > 80
        || Object.values(sshErrors).some(Boolean)
    }
    if (editor.kind === 'file') return Object.values(fileErrors).some(Boolean)
    return Object.values(vncErrors).some(Boolean)
  }, [editor, fileErrors, profileDirty, sshDraft.name, sshErrors, vncErrors])

  return {
    ...catalogState,
    view,
    assetDraft,
    assetDirty,
    assetValidationVisible,
    assetSubmitted,
    assetErrors,
    editor,
    sshDraft,
    sshErrors,
    fileDraft,
    fileErrors,
    vncDraft,
    vncErrors,
    profileDirty,
    profileValidationVisible,
    profileSubmitted,
    profileSaveDisabled,
    operationBusy,
    mutationError,
    pendingNavigation,
    deleteTarget,
    setAssetDraft,
    setSSHDraft,
    setFileDraft,
    setVNCDraft,
    setMutationError,
    setDeleteTarget: (target: ProfileDeleteTarget | null) => {
      if (target) setMutationError('')
      setDeleteTarget(target)
    },
    requestView: (next: HostDetailView) => requestNavigation({ type: 'view', view: next }),
    requestEditor: (intent: HostAccessProfileEditorIntent) => requestNavigation({ type: 'editor', intent }),
    requestCloseEditor: () => requestNavigation({ type: 'close-editor' }),
    cancelPendingNavigation: () => setPendingNavigation(null),
    confirmPendingNavigation,
    discardAsset: () => {
      setAssetDraft(assetBaseline)
      setAssetSubmitted(false)
      setMutationError('')
    },
    discardProfile,
    saveAsset,
    saveProfile,
    setDefaultProfile,
    requestDeleteSSH,
    confirmDeleteProfile,
  }
}

function fallbackHostAssetInput(host: Host): HostAssetInput {
  return {
    name: host.name,
    platform: host.platform,
    icon_id: host.icon_id ?? '',
    group_id: host.group_id,
    tags: [...host.tags],
    favorite: host.favorite,
    note: host.note ?? '',
  }
}

function isStaleOrAppliedAssetRevision(candidate: string, applied: string) {
  if (!applied) return false
  if (candidate === applied) return true
  const candidateTime = Date.parse(candidate)
  const appliedTime = Date.parse(applied)
  return Number.isFinite(candidateTime) && Number.isFinite(appliedTime) && candidateTime < appliedTime
}
