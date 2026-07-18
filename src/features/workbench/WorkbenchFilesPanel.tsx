import { App as AntdApp, Breadcrumb, Button, Dropdown, Input, Progress, Switch, Tooltip, type MenuProps } from 'antd'
import {
  ChevronLeft,
  CircleAlert,
  Clipboard,
  FolderInput,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Upload,
} from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { useTransferRuntime } from '../../app/useTransferRuntime'
import { buildRemoteFileActionMenu } from '../../components/files/RemoteFileActionMenu'
import {
  runRemoteFileAction,
  type RemoteFileActionHandlers,
} from '../../components/files/remoteFileActions'
import { RemotePermissionModal } from '../../components/files/RemotePermissionModal'
import type {
  AppData,
  LocalGrantSource,
  RemoteFileEntry,
  Session,
  ThemeMode,
} from '../../types/domain'
import { joinPath, normalizeRemotePath, parentPath } from '../files/fileUtils'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'
import { WorkbenchFileList } from './WorkbenchFileList'
import { WorkbenchTransferBar } from './WorkbenchTransferBar'
import { useWorkbenchSessionFiles } from './useWorkbenchSessionFiles'

const RemoteTextEditorModal = lazy(() => import('../files/RemoteTextEditorModal').then((module) => ({ default: module.RemoteTextEditorModal })))
const RemoteImageViewerModal = lazy(() => import('../files/RemoteImageViewerModal').then((module) => ({ default: module.RemoteImageViewerModal })))
const imagePattern = /\.(?:png|jpe?g|gif|webp|bmp|svg)$/i

interface WorkbenchFilesPanelProps {
  api: TermousApi
  data: AppData
  session: Session | null
  enabled: boolean
  theme: ThemeMode
  onOpenFull: (session: Session) => Promise<void>
}

interface RemoteClipboard {
  mode: 'copy' | 'cut'
  hostId: string
  paths: string[]
}

interface TrackedUploadRefresh {
  fileSessionId: string
  targetPath: string
}

export function WorkbenchFilesPanel(props: WorkbenchFilesPanelProps) {
  return <WorkbenchFilesPanelContent {...props} />
}

function WorkbenchFilesPanelContent({
  api,
  data,
  session,
  enabled,
  theme,
  onOpenFull,
}: WorkbenchFilesPanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const runtime = useTransferRuntime()
  const files = useWorkbenchSessionFiles({ api, data, activeSession: session, enabled })
  const [pathInput, setPathInput] = useState('/')
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const [permissionEntry, setPermissionEntry] = useState<RemoteFileEntry | null>(null)
  const [permissionSaving, setPermissionSaving] = useState(false)
  const [textEditorPath, setTextEditorPath] = useState<string | null>(null)
  const [imageViewerPath, setImageViewerPath] = useState<string | null>(null)
  const [dropDownloadActive, setDropDownloadActive] = useState(false)
  const uploadRefreshTasksRef = useRef(new Map<string, TrackedUploadRefresh>())
  const completedUploadPathsRef = useRef(new Map<string, Set<string>>())
  const currentPath = normalizeRemotePath(files.viewState?.path || '/')
  const fileSessionId = files.fileSession?.id
  const loadDirectory = files.loadDirectory
  const syncStatus = files.viewState?.syncStatus ?? ''
  const syncMessage = syncStatusMessage(syncStatus, t)
  const syncWarning = syncStatus === 'failed'
    || syncStatus === 'unsupported'
    || syncStatus === 'not_ready'
    || syncStatus === 'invalid_path'

  useEffect(() => {
    setPathInput(files.viewState?.path || '/')
  }, [files.viewState?.path])

  useEffect(() => {
    if (uploadRefreshTasksRef.current.size === 0 && completedUploadPathsRef.current.size === 0) {
      return
    }
    const byId = new Map(runtime.transfers.map((task) => [task.id, task]))
    for (const [taskId, tracked] of uploadRefreshTasksRef.current) {
      const task = byId.get(taskId)
      if (!task) {
        uploadRefreshTasksRef.current.delete(taskId)
        continue
      }
      if (task.status === 'queued' || task.status === 'running') {
        continue
      }
      uploadRefreshTasksRef.current.delete(taskId)
      if (task.status === 'completed') {
        const paths = completedUploadPathsRef.current.get(tracked.fileSessionId) ?? new Set<string>()
        paths.add(tracked.targetPath)
        completedUploadPathsRef.current.set(tracked.fileSessionId, paths)
      }
    }
    if (!fileSessionId) {
      return
    }
    const hasPendingCurrentSession = [...uploadRefreshTasksRef.current.values()]
      .some((tracked) => tracked.fileSessionId === fileSessionId)
    if (hasPendingCurrentSession) {
      return
    }
    const completedPaths = completedUploadPathsRef.current.get(fileSessionId)
    completedUploadPathsRef.current.delete(fileSessionId)
    if (completedPaths?.has(currentPath)) {
      void loadDirectory(currentPath)
    }
  }, [currentPath, fileSessionId, loadDirectory, runtime.transfers])

  const notifyFailure = () => notification.error({
    title: t('files.operationFailed'),
    duration: 4,
    role: 'alert',
    className: 'termous-notification',
  })

  const runAction = async (action: () => Promise<void>, success?: string) => {
    try {
      await action()
      if (success) {
        notification.success({ title: success, duration: 2, className: 'termous-notification' })
      }
    } catch {
      notifyFailure()
    }
  }

  const uploadPaths = async (source: LocalGrantSource, paths: string[], targetPath?: string) => {
    if (!files.fileSession?.id || paths.length === 0) {
      return
    }
    const remoteDir = normalizeRemotePath(targetPath || files.viewState?.path || '/')
    await runAction(async () => {
      const grant = await api.createLocalFileGrant(source, paths)
      const task = await api.createFileSessionUploadTransfer(files.fileSession!.id, grant.id, remoteDir, 'rename')
      uploadRefreshTasksRef.current.set(task.id, {
        fileSessionId: files.fileSession!.id,
        targetPath: remoteDir,
      })
      runtime.upsertTransfer(task)
    }, t('files.transferCreated'))
  }

  const downloadPaths = async (paths: string[]) => {
    if (!files.fileSession?.id || paths.length === 0) {
      return
    }
    const directories = await window.termous?.files?.pickDirectory()
    if (!directories?.[0]) {
      return
    }
    await runAction(async () => {
      const task = await api.createFileSessionDownloadTransfer(files.fileSession!.id, paths, directories[0], 'rename')
      runtime.upsertTransfer(task)
    }, t('files.transferCreated'))
  }

  const uploadDrop = async (targetPath: string, event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    const cached = await window.termous?.files?.consumeDroppedFilePaths?.(event.dataTransfer.files.length)
    const paths = cached?.length
      ? cached
      : await window.termous?.files?.pathsFromFileList(event.dataTransfer.files)
    if (!paths?.length) {
      notification.warning({ title: t('files.dropPathUnavailable'), duration: 3 })
      return
    }
    await uploadPaths('drop', paths, targetPath || files.viewState?.path)
  }

  const openEntry = (entry: RemoteFileEntry) => {
    files.setSelectedPaths([entry.path])
    if (entry.kind === 'directory') {
      void files.navigateDirectory(entry.path)
      return
    }
    if (entry.kind !== 'file') {
      return
    }
    if (imagePattern.test(entry.name)) {
      setImageViewerPath(entry.path)
      setTextEditorPath(null)
    } else {
      setTextEditorPath(entry.path)
      setImageViewerPath(null)
    }
  }

  const createDirectory = () => {
    let name = ''
    modal.confirm({
      title: t('files.newFolder'),
      icon: null,
      content: <Input autoFocus placeholder={t('files.folderName')} onChange={(event) => { name = event.target.value }} />,
      okText: t('app.create'),
      cancelText: t('app.cancel'),
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        if (!name.trim() || !files.fileSession?.id) {
          throw new Error(t('files.nameRequired'))
        }
        await api.mkdirFileSessionFile(files.fileSession.id, joinPath(files.viewState?.path || '/', name.trim()))
        await files.loadDirectory(files.viewState?.path || '/')
      },
    })
  }

  const renameEntry = (entry: RemoteFileEntry) => {
    let name = entry.name
    modal.confirm({
      title: t('files.rename'),
      icon: null,
      content: <Input autoFocus defaultValue={entry.name} onChange={(event) => { name = event.target.value }} />,
      okText: t('app.save'),
      cancelText: t('app.cancel'),
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        if (!files.fileSession?.id || !name.trim()) {
          throw new Error(t('files.nameRequired'))
        }
        await api.renameFileSessionFile(files.fileSession.id, entry.path, joinPath(parentPath(entry.path), name.trim()))
        await files.loadDirectory(files.viewState?.path || '/')
      },
    })
  }

  const deleteEntry = (entry: RemoteFileEntry) => modal.confirm({
    title: t('files.deleteTitle'),
    content: t('files.deleteDescription', { count: 1 }),
    okText: t('app.delete'),
    cancelText: t('app.cancel'),
    okButtonProps: { danger: true },
    className: 'confirm-modal',
    rootClassName: 'termous-modal-root',
    onOk: async () => {
      if (files.fileSession?.id) {
        await api.deleteFileSessionFiles(files.fileSession.id, [entry.path], true)
        await files.loadDirectory(files.viewState?.path || '/')
      }
    },
  })

  const menuFor = (entry: RemoteFileEntry): MenuProps => ({
    items: buildRemoteFileActionMenu(entry, t),
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation()
      files.setSelectedPaths([entry.path])
      const handlers: RemoteFileActionHandlers = {
        openFile: openEntry,
        download: (target) => void downloadPaths([target.path]),
        copy: (target) => {
          if (files.fileSession) {
            setRemoteClipboard({ mode: 'copy', hostId: files.fileSession.host_id, paths: [target.path] })
          }
        },
        cut: (target) => {
          if (files.fileSession) {
            setRemoteClipboard({ mode: 'cut', hostId: files.fileSession.host_id, paths: [target.path] })
          }
        },
        permissions: setPermissionEntry,
        rename: renameEntry,
        delete: deleteEntry,
      }
      runRemoteFileAction(entry, String(key), handlers)
    },
  })

  const paste = async () => {
    if (!files.fileSession?.id) {
      return
    }
    const targetPath = files.viewState?.path || '/'
    if (remoteClipboard?.hostId === files.fileSession.host_id) {
      await runAction(async () => {
        if (remoteClipboard.mode === 'cut') {
          await api.moveFileSessionFiles(files.fileSession!.id, remoteClipboard.paths, targetPath, 'rename')
          setRemoteClipboard(null)
        } else {
          await api.copyFileSessionFiles(files.fileSession!.id, remoteClipboard.paths, targetPath, 'rename')
        }
        await files.loadDirectory(targetPath)
      }, t('files.operationDone'))
      return
    }
    const localPaths = await window.termous?.files?.readClipboardFilePaths()
    await uploadPaths('clipboard', localPaths ?? [])
  }

  if (!session || session.kind !== 'ssh') {
    return <WorkbenchEmptyState icon={<FolderOpen size={20} />} title={t('workbench.files.emptyTitle')} description={t('workbench.files.emptyHint')} />
  }

  if (session.status !== 'connected') {
    return <WorkbenchEmptyState icon={<FolderOpen size={20} />} title={t('workbench.files.disconnectedTitle')} description={t('workbench.files.disconnectedHint')} />
  }

  if (!files.fileSession || files.fileSession.status !== 'connected') {
    const progress = Math.max(4, Math.min(100, files.fileSession?.progress ?? 8))
    return (
      <div className="workbench-file-connect">
        <FolderOpen size={21} />
        <strong>{files.viewState?.error ? t('workbench.files.connectFailed') : t('workbench.files.connecting')}</strong>
        <span>{files.fileSession?.status_message || t('workbench.files.preparing')}</span>
        <Progress percent={progress} showInfo={false} size="small" />
        {files.viewState?.error || files.fileSession?.status === 'failed' || files.fileSession?.status === 'disconnected' ? (
        <Button icon={<RefreshCw size={14} />} onClick={() => void runAction(files.reconnect)}>{t('app.retry')}</Button>
        ) : null}
      </div>
    )
  }

  return (
    <section className="workbench-files-panel">
      <div className="workbench-files-toolbar">
        <div className="workbench-files-location">
          <Tooltip title={t('files.parent')}>
            <Button
              type="text"
              className="workbench-files-back"
              icon={<ChevronLeft size={16} />}
              disabled={currentPath === '/'}
              onClick={() => void files.navigateDirectory(parentPath(currentPath))}
            />
          </Tooltip>
          <Breadcrumb
            className="workbench-files-breadcrumb"
            separator="/"
            items={buildBreadcrumbItems(currentPath, files.navigateDirectory)}
          />
        </div>
        <Input.Search
          value={pathInput}
          enterButton={t('files.go')}
          onChange={(event) => setPathInput(event.target.value)}
          onSearch={(value) => void files.navigateDirectory(value)}
        />
        <div className="workbench-files-toolbar-row">
          <Tooltip title={t('app.reload')}>
            <Button type="text" icon={<RefreshCw size={15} />} onClick={() => void files.loadDirectory(files.viewState?.path || '/')} />
          </Tooltip>
          <Tooltip title={t('files.newFolder')}>
            <Button type="text" icon={<FolderPlus size={15} />} onClick={createDirectory} />
          </Tooltip>
          <Tooltip title={t('files.uploadFiles')}>
            <Button type="text" icon={<Upload size={15} />} onClick={async () => uploadPaths('picker', await window.termous?.files?.pickFiles() ?? [])} />
          </Tooltip>
          <Tooltip title={t('files.paste')}>
            <Button type="text" icon={<Clipboard size={15} />} onClick={() => void paste()} />
          </Tooltip>
          <div className="workbench-files-follow">
            <span>{t('workbench.files.followTerminal')}</span>
            <Switch size="small" checked={Boolean(files.viewState?.followTerminal)} onChange={files.setFollowTerminal} />
          </div>
          <Dropdown
            menu={{
              items: [
                { key: 'upload-folder', icon: <FolderInput size={14} />, label: t('files.uploadFolder') },
                { key: 'open-full', icon: <FolderOpen size={14} />, label: t('workbench.manageFiles') },
              ],
              onClick: async ({ key }) => {
                if (key === 'upload-folder') {
                  await uploadPaths('picker', await window.termous?.files?.pickDirectory() ?? [])
                } else {
                  await runAction(() => onOpenFull(session))
                }
              },
            }}
            classNames={{ root: 'files-row-menu' }}
          >
            <Button type="text" icon={<MoreHorizontal size={15} />} />
          </Dropdown>
        </div>
        {files.viewState?.followTerminal && syncMessage ? (
          <div className={`workbench-file-sync ${syncWarning ? 'is-warning' : ''}`}>
            {syncWarning
              ? <CircleAlert size={13} />
              : <LoaderCircle className="is-spinning" size={13} />}
            <span>{syncMessage}</span>
          </div>
        ) : null}
      </div>
      <WorkbenchFileList
        entries={files.entries}
        selectedPaths={files.viewState?.selectedPaths ?? []}
        loading={Boolean(files.viewState?.loading)}
        listRef={files.listRef}
        menuFor={menuFor}
        onSelect={(entry) => files.setSelectedPaths([entry.path])}
        onOpen={openEntry}
        onScroll={files.recordScroll}
        onUploadDrop={(target, event) => void uploadDrop(target, event)}
      />
      {files.viewState?.error ? (
        <button className="workbench-file-inline-error" type="button" onClick={() => void files.loadDirectory(files.viewState?.path || '/')}>
          {t('workbench.files.readFailed')}
        </button>
      ) : null}
      <WorkbenchTransferBar
        api={api}
        fileSessionId={files.fileSession.id}
        downloadDropActive={dropDownloadActive}
        onActionError={notifyFailure}
        onDownloadDragEnter={(event) => {
          if (event.dataTransfer.types.includes('application/x-termous-remote-download')) {
            event.preventDefault()
            setDropDownloadActive(true)
          }
        }}
        onDownloadDragLeave={(event) => {
          const nextTarget = event.relatedTarget
          if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
            setDropDownloadActive(false)
          }
        }}
        onDownloadDragOver={(event) => {
          if (event.dataTransfer.types.includes('application/x-termous-remote-download')) {
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }
        }}
        onDownloadDrop={(event) => {
          event.preventDefault()
          setDropDownloadActive(false)
          try {
            const payload = JSON.parse(event.dataTransfer.getData('application/x-termous-remote-download')) as { paths?: string[] }
            void downloadPaths(payload.paths ?? [])
          } catch {
            notifyFailure()
          }
        }}
      />
      <RemotePermissionModal
        entry={permissionEntry}
        open={Boolean(permissionEntry)}
        saving={permissionSaving}
        onCancel={() => setPermissionEntry(null)}
        onSubmit={async (entry, mode) => {
          setPermissionSaving(true)
          try {
            await runAction(async () => {
              await api.chmodFileSessionFile(files.fileSession!.id, entry.path, mode)
              await files.loadDirectory(files.viewState?.path || '/')
              setPermissionEntry(null)
            }, t('files.permissionsUpdated'))
          } finally {
            setPermissionSaving(false)
          }
        }}
      />
      {textEditorPath ? (
        <Suspense fallback={null}>
          <RemoteTextEditorModal
            api={api}
            open
            fileSessionId={files.fileSession.id}
            path={textEditorPath}
            theme={theme}
            terminalSettings={data.settings.terminal}
            onClose={() => setTextEditorPath(null)}
            onSaved={() => void files.loadDirectory(files.viewState?.path || '/')}
          />
        </Suspense>
      ) : null}
      {imageViewerPath ? (
        <Suspense fallback={null}>
          <RemoteImageViewerModal
            api={api}
            open
            fileSessionId={files.fileSession.id}
            path={imageViewerPath}
            theme={theme}
            onClose={() => setImageViewerPath(null)}
          />
        </Suspense>
      ) : null}
    </section>
  )
}

function buildBreadcrumbItems(
  path: string,
  navigateDirectory: (targetPath: string) => Promise<boolean>,
) {
  const segments = normalizeRemotePath(path).split('/').filter(Boolean)
  const paths = ['/']
  for (let index = 0; index < segments.length; index += 1) {
    paths.push(`/${segments.slice(0, index + 1).join('/')}`)
  }
  return paths.map((targetPath, index) => ({
    key: targetPath,
    title: (
      <button
        type="button"
        className="workbench-files-crumb"
        onClick={() => void navigateDirectory(targetPath)}
      >
        {index === 0 ? '/' : segments[index - 1]}
      </button>
    ),
  }))
}

function syncStatusMessage(
  status: string,
  t: ReturnType<typeof useTranslation>['t'],
) {
  switch (status) {
    case 'queued':
    case 'publishing':
    case 'applying':
      return t('workbench.files.syncing')
    case 'waiting-idle':
      return t('workbench.files.waitingTerminalIdle')
    case 'failed':
      return t('workbench.files.syncFailed')
    case 'unsupported':
      return t('workbench.files.followUnsupported')
    case 'not_ready':
      return t('workbench.files.followNotReady')
    case 'invalid_path':
      return t('workbench.files.invalidPath')
    default:
      return ''
  }
}
