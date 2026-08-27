import { Alert, Button } from 'antd'
import {
  FileKey2,
  Layers3,
  MonitorPlay,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { HostAsset } from '#entities/host-asset'
import { projectFileAccessProfile } from '#entities/file-access-profile'
import {
  AccessProfileCatalog,
  AccessProfileEditorShell,
  countRemoteDesktopProfileRuntimeUsage,
  countSSHProfileRuntimeUsage,
  mergeSSHProfileRuntimeUsage,
  type HostAccessWorkspaceGateway,
  useSSHProfileReachability,
} from '#features/host-access'
import { SFTPProfileEditor } from '#features/manage-file-access'
import { VNCProfileEditor } from '#features/manage-remote-desktop'
import { SSHProfileEditor } from '#features/manage-ssh-access'
import {
  ConfirmDialog,
  WorkspaceDetectionLoading,
  WorkspaceEmptyState,
} from '#shared/ui'
import type { HostManagementData } from '../model/types.ts'
import { useHostAccessWorkspaceController } from '../model/useHostAccessWorkspaceController.ts'
import { HostAssetForm } from './HostAssetForm.tsx'
import { HostEditorShell } from './HostEditorShell.tsx'
import styles from './HostAccessWorkspace.module.scss'

interface HostAccessWorkspaceProps {
  host: HostAsset
  data: HostManagementData
  gateway: HostAccessWorkspaceGateway
  openAccessIntentKey?: number
  onAccessIntentHandled?: (key: number) => void
  actionBusy: boolean
  getHostIconUrl: (iconId: string) => string
  onBack: () => void
  onDeleteHost: () => Promise<boolean>
  onCreateGroup: (name: string) => Promise<{ id: string; name: string }>
  onManageProxies: () => void
  onManageIcons: () => void
  onDirtyChange: (dirty: boolean) => void
  onProtectedIconIdChange: (iconId: string) => void
}

export function HostAccessWorkspace({
  host,
  data,
  gateway,
  openAccessIntentKey = 0,
  onAccessIntentHandled,
  actionBusy,
  getHostIconUrl,
  onBack,
  onDeleteHost,
  onCreateGroup,
  onManageProxies,
  onManageIcons,
  onDirtyChange,
  onProtectedIconIdChange,
}: HostAccessWorkspaceProps) {
  const { t } = useTranslation()
  const [deleteHostConfirmOpen, setDeleteHostConfirmOpen] = useState(false)
  const handledAccessIntentKeyRef = useRef(0)
  const controller = useHostAccessWorkspaceController({
    hostId: host.id,
    fallbackHost: host,
    gateway,
    t,
    openAccessIntentKey,
    onDirtyChange,
    onProtectedIconIdChange,
  })
  const profileReachability = useSSHProfileReachability(
    gateway,
    controller.view === 'access' && controller.editor === null,
  )

  useEffect(() => {
    if (
      openAccessIntentKey <= 0
      || handledAccessIntentKeyRef.current === openAccessIntentKey
    ) {
      return
    }
    handledAccessIntentKeyRef.current = openAccessIntentKey
    onAccessIntentHandled?.(openAccessIntentKey)
  }, [onAccessIntentHandled, openAccessIntentKey])

  const busy = actionBusy || controller.operationBusy
  const catalog = controller.catalog
  const overviewError = controller.mutationError || controller.error?.message
  const sshProxyError = controller.sshDraft.proxy_id
    && !data.proxies.some((proxy) => proxy.id === controller.sshDraft.proxy_id)
    ? t('hosts.validation.proxyMissing')
    : undefined

  if (controller.editor && catalog) {
    const editor = controller.editor
    if (editor.kind === 'ssh') {
      const profile = editor.mode === 'edit'
        ? catalog.ssh.find((item) => item.id === editor.profileId)
        : undefined
      return (
        <>
          <AccessProfileEditorShell
            mode={editor.mode}
            title={controller.sshDraft.name.trim() || t(editor.mode === 'create' ? 'hosts.access.ssh.add' : 'hosts.access.ssh.edit')}
            icon={<FileKey2 size={17} />}
            dirty={controller.profileDirty}
            busy={busy}
            saveDisabled={controller.profileSaveDisabled || Boolean(sshProxyError)}
            error={controller.mutationError}
            canDelete={editor.mode === 'edit'}
            deleteDisabled={Boolean(profile?.is_default && catalog.ssh.length > 1)}
            deleteDisabledReason={t('hosts.access.switchDefaultBeforeDelete')}
            onBack={controller.requestCloseEditor}
            onDiscard={controller.discardProfile}
            onSave={() => void controller.saveProfile()}
            onDelete={profile ? () => void controller.requestDeleteSSH(profile.id) : undefined}
          >
            <SSHProfileEditor
              draft={controller.sshDraft}
              errors={controller.sshErrors}
              nameError={controller.profileValidationVisible ? profileNameError(controller.sshDraft.name, t) : undefined}
              submitted={controller.profileValidationVisible}
              disabled={busy}
              editingProfileId={profile?.id}
              credentials={data.credentials}
              proxies={data.proxies}
              jumpProfiles={controller.sshProfiles}
              errorMessages={sshProxyError ? { proxy: sshProxyError } : undefined}
              onManageProxies={onManageProxies}
              onChange={controller.setSSHDraft}
            />
          </AccessProfileEditorShell>
          {renderDialogs(controller, data, t)}
        </>
      )
    }
    if (editor.kind === 'file') {
      const profile = catalog.files.find((item) => item.id === editor.profileId)
      const projection = profile ? projectFileAccessProfile(profile) : undefined
      const sshProfile = profile
        ? catalog.ssh.find((item) => item.id === projection?.routeDependency.profileId)
        : undefined
      return (
        <>
          <AccessProfileEditorShell
            mode="edit"
            title={controller.fileDraft.name.trim() || t('hosts.access.file.edit')}
            subtitle={t('hosts.access.file.subtitle')}
            icon={<Layers3 size={17} />}
            dirty={controller.profileDirty}
            busy={busy}
            saveDisabled={controller.profileSaveDisabled}
            error={controller.mutationError}
            onBack={controller.requestCloseEditor}
            onDiscard={controller.discardProfile}
            onSave={() => void controller.saveProfile()}
          >
            <SFTPProfileEditor
              draft={controller.fileDraft}
              sshProfile={sshProfile}
              error={controller.profileValidationVisible && controller.fileErrors.name
                ? profileNameError(controller.fileDraft.name, t)
                : undefined}
              disabled={busy}
              onChange={controller.setFileDraft}
            />
          </AccessProfileEditorShell>
          {renderDialogs(controller, data, t)}
        </>
      )
    }

    const profile = editor.mode === 'edit'
      ? catalog.remote_desktops.find((item) => item.id === editor.profileId)
      : undefined
    return (
      <>
        <AccessProfileEditorShell
          mode={editor.mode}
          title={controller.vncDraft.name.trim() || t(editor.mode === 'create' ? 'hosts.access.desktop.add' : 'hosts.access.desktop.edit')}
          icon={<MonitorPlay size={17} />}
          dirty={controller.profileDirty}
          busy={busy}
          saveDisabled={controller.profileSaveDisabled}
          error={controller.mutationError}
          canDelete={editor.mode === 'edit'}
          deleteDisabled={Boolean(profile?.is_default && catalog.remote_desktops.length > 1)}
          deleteDisabledReason={t('hosts.access.switchDefaultBeforeDelete')}
          onBack={controller.requestCloseEditor}
          onDiscard={controller.discardProfile}
          onSave={() => void controller.saveProfile()}
          onDelete={profile ? () => controller.setDeleteTarget({ kind: 'remote_desktop', profileId: profile.id }) : undefined}
        >
          <VNCProfileEditor
            draft={controller.vncDraft}
            errors={controller.vncErrors}
            submitted={controller.profileValidationVisible}
            disabled={busy}
            sshProfiles={catalog.ssh}
            hasSavedTargetAuth={controller.vncHasSavedTargetAuth}
            targetAuthDraft={controller.vncTargetAuthDraft}
            targetAuthError={controller.profileValidationVisible
              ? controller.vncTargetAuthError
              : undefined}
            onChange={controller.setVNCDraft}
            onTargetAuthChange={controller.setVNCTargetAuthDraft}
          />
        </AccessProfileEditorShell>
        {renderDialogs(controller, data, t)}
      </>
    )
  }

  return (
    <>
      <HostEditorShell
        mode="edit"
        title={controller.assetDraft.name.trim() || catalog?.host.name || host.name}
        iconId={controller.assetDraft.icon_id}
        getHostIconUrl={getHostIconUrl}
        activeSection={controller.view === 'asset' ? 'asset' : 'connections'}
        dirty={controller.assetDirty}
        busy={busy}
        onBack={onBack}
        onSectionChange={(section) => controller.requestView(
          section === 'asset' ? 'asset' : 'access',
        )}
        actions={controller.view === 'asset' && catalog ? {
          leading: (
            <Button
              danger
              icon={<Trash2 size={14} />}
              disabled={busy}
              onClick={() => setDeleteHostConfirmOpen(true)}
            >
              {t('app.delete')}
            </Button>
          ),
          saveLabel: t('app.save'),
          saveIcon: <Save size={14} />,
          saveDisabled: !controller.assetDirty
            || Object.values(controller.assetErrors).some(Boolean),
          onDiscard: controller.discardAsset,
          onSave: () => void controller.saveAsset(),
        } : undefined}
      >
        {overviewError ? (
          <Alert
            className={styles.alert}
            type="error"
            showIcon
            title={overviewError}
            action={controller.error ? (
              <Button
                type="text"
                size="small"
                icon={<RefreshCw size={13} />}
                loading={controller.refreshing}
                disabled={busy}
                onClick={() => void controller.reload()}
              >
                {t('app.retry')}
              </Button>
            ) : undefined}
          />
        ) : null}
        {renderOverviewBody({
          controller,
          catalog,
          data,
          busy,
          profileReachability,
          getHostIconUrl,
          onCreateGroup,
          onManageIcons,
          t,
        })}
      </HostEditorShell>
      <ConfirmDialog
        open={deleteHostConfirmOpen}
        title={t('hosts.access.deleteHostTitle')}
        description={t('hosts.access.deleteHostDescription', { name: catalog?.host.name ?? host.name })}
        confirmLabel={t('app.delete')}
        danger
        confirmLoading={actionBusy}
        onCancel={() => setDeleteHostConfirmOpen(false)}
        onConfirm={() => {
          void onDeleteHost().then((deleted) => {
            if (deleted) setDeleteHostConfirmOpen(false)
          })
        }}
      />
      {renderDialogs(controller, data, t)}
    </>
  )
}

function renderOverviewBody({
  controller,
  catalog,
  data,
  busy,
  profileReachability,
  getHostIconUrl,
  onCreateGroup,
  onManageIcons,
  t,
}: {
  controller: ReturnType<typeof useHostAccessWorkspaceController>
  catalog: ReturnType<typeof useHostAccessWorkspaceController>['catalog']
  data: HostManagementData
  busy: boolean
  profileReachability: ReturnType<typeof useSSHProfileReachability>
  getHostIconUrl: (iconId: string) => string
  onCreateGroup: (name: string) => Promise<{ id: string; name: string }>
  onManageIcons: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}) {
  if (controller.loading && !catalog) {
    return <WorkspaceDetectionLoading icon={<Layers3 size={16} />} label={t('hosts.access.loading')} />
  }
  if (!catalog) {
    return (
      <WorkspaceEmptyState
        tone="danger"
        icon={<Layers3 size={20} />}
        title={t('hosts.access.loadFailed')}
        description={controller.error?.message}
        action={(
          <Button icon={<RefreshCw size={14} />} onClick={() => void controller.reload()}>
            {t('app.retry')}
          </Button>
        )}
      />
    )
  }
  if (controller.view === 'asset') {
    return (
      <HostAssetForm
        data={data}
        draft={controller.assetDraft}
        nameError={controller.assetValidationVisible && controller.assetErrors.name
          ? profileNameError(controller.assetDraft.name, t)
          : undefined}
        disabled={busy}
        getHostIconUrl={getHostIconUrl}
        onChange={controller.setAssetDraft}
        onCreateGroup={onCreateGroup}
        onManageIcons={onManageIcons}
      />
    )
  }
  return (
    <AccessProfileCatalog
      catalog={catalog}
      busy={busy}
      sshReachability={profileReachability.states}
      sshReachabilityRefreshing={catalog.ssh.some((profile) => (
        profileReachability.pendingProfileIds.has(profile.id)
      ))}
      sshReachabilityError={profileReachability.error?.message}
      onRefreshSSHReachability={() => void profileReachability.refreshMany(
        catalog.ssh.map((profile) => profile.id),
      )}
      onCreateSSH={() => controller.requestEditor({ kind: 'ssh', mode: 'create' })}
      onEditSSH={(profile) => controller.requestEditor({ kind: 'ssh', mode: 'edit', profileId: profile.id })}
      onDeleteSSH={(profile) => void controller.requestDeleteSSH(profile.id)}
      onSetDefaultSSH={(profile) => void controller.setDefaultProfile('ssh', profile.id)}
      onEditFile={(profile) => controller.requestEditor({ kind: 'file', mode: 'edit', profileId: profile.id })}
      onSetDefaultFile={(profile) => void controller.setDefaultProfile('file', profile.id)}
      onCreateRemoteDesktop={() => controller.requestEditor({ kind: 'remote_desktop', mode: 'create' })}
      onEditRemoteDesktop={(profile) => controller.requestEditor({ kind: 'remote_desktop', mode: 'edit', profileId: profile.id })}
      onDeleteRemoteDesktop={(profile) => controller.setDeleteTarget({ kind: 'remote_desktop', profileId: profile.id })}
      onSetDefaultRemoteDesktop={(profile) => void controller.setDefaultProfile('remote_desktop', profile.id)}
    />
  )
}

function renderDialogs(
  controller: ReturnType<typeof useHostAccessWorkspaceController>,
  data: HostManagementData,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  const deleteTarget = controller.deleteTarget
  const runtimeUsage = deleteTarget?.kind === 'ssh'
    ? mergeSSHProfileRuntimeUsage(
      deleteTarget.references,
      countSSHProfileRuntimeUsage(
        deleteTarget.profileId,
        data.sessions,
        data.fileSessions,
        data.forwards,
        data.remoteDesktopSessions,
      ),
    )
    : null
  const remoteDesktopRuntimeUsage = deleteTarget?.kind === 'remote_desktop'
    ? countRemoteDesktopProfileRuntimeUsage(deleteTarget.profileId, data.remoteDesktopSessions)
    : 0
  const blocking = deleteTarget?.kind === 'ssh'
    ? deleteTarget.references.blocking_total > 0 || (runtimeUsage?.total ?? 0) > 0
    : remoteDesktopRuntimeUsage > 0
  const deleteDescription = deleteTarget?.kind === 'ssh'
    ? t(blocking ? 'hosts.access.ssh.deleteBlocked' : 'hosts.access.ssh.deleteDescription', {
      files: deleteTarget.references.companion_files,
      forwards: deleteTarget.references.forward_profiles,
      desktops: deleteTarget.references.remote_desktop_routes,
      jumps: deleteTarget.references.jump_profile_consumers,
      terminals: runtimeUsage?.terminalSessions ?? 0,
      fileSessions: runtimeUsage?.fileSessions ?? 0,
      backgroundForwards: runtimeUsage?.backgroundForwards ?? 0,
      remoteDesktopSessions: runtimeUsage?.remoteDesktopSessions ?? 0,
    })
    : t(blocking ? 'hosts.access.desktop.deleteBlocked' : 'hosts.access.desktop.deleteDescription', {
      sessions: remoteDesktopRuntimeUsage,
    })
  const blockingTitle = deleteTarget?.kind === 'remote_desktop'
    ? 'hosts.access.desktop.deleteBlockedTitle'
    : 'hosts.access.ssh.deleteBlockedTitle'
  return (
    <>
      <ConfirmDialog
        open={Boolean(controller.pendingNavigation)}
        title={t('hosts.unsavedTitle')}
        description={t('hosts.access.unsavedDescription')}
        confirmLabel={t('hosts.discardAndContinue')}
        danger
        onCancel={controller.cancelPendingNavigation}
        onConfirm={controller.confirmPendingNavigation}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t(blocking ? blockingTitle : 'hosts.access.deleteProfileTitle')}
        description={controller.mutationError || deleteDescription}
        confirmLabel={t(blocking ? 'app.confirm' : 'app.delete')}
        danger={!blocking}
        showCancelButton={!blocking}
        confirmLoading={controller.operationBusy}
        onCancel={() => controller.setDeleteTarget(null)}
        onConfirm={() => {
          if (blocking) {
            controller.setDeleteTarget(null)
            return
          }
          void controller.confirmDeleteProfile()
        }}
      />
    </>
  )
}

function profileNameError(
  name: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (!name.trim()) return t('hosts.access.errors.required')
  if (Array.from(name.trim()).length > 80) return t('hosts.access.errors.tooLong')
  return undefined
}
