import { App as AntdApp, Button, Dropdown, Input, Table, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  ArrowLeft,
  Clipboard,
  Copy,
  Download,
  File,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { EmptyState } from '../../components/ui/EmptyState'
import type { AppData, Host, LocalGrantSource, RemoteFileEntry } from '../../types/domain'
import { fileSortValue, formatBytes, formatDate, joinPath, normalizeRemotePath, parentPath } from './fileUtils'
import { TransferQueuePanel } from './TransferQueuePanel'
import { useTransferQueue } from './useTransferQueue'

interface FilesPageProps {
  api: TermousApi
  data: AppData
  selectedHostId: string
  onSelectHost: (hostId: string) => void
}

interface RemoteClipboard {
  mode: 'copy' | 'cut'
  hostId: string
  paths: string[]
}

export function FilesPage({ api, data, selectedHostId, onSelectHost }: FilesPageProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const [currentPath, setCurrentPath] = useState('/')
  const [pathInput, setPathInput] = useState('/')
  const [entries, setEntries] = useState<RemoteFileEntry[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>([])
  const [activeEntry, setActiveEntry] = useState<RemoteFileEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hostSearch, setHostSearch] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [remoteClipboard, setRemoteClipboard] = useState<RemoteClipboard | null>(null)
  const { transfers, connected, upsertTransfer } = useTransferQueue(api)
  const selectedHost = data.hosts.find((host) => host.id === selectedHostId) ?? data.hosts[0]
  const selectedHostIdStable = selectedHost?.id ?? ''

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.includes(entry.path)),
    [entries, selectedPaths],
  )

  const visibleHosts = useMemo(() => {
    const query = hostSearch.trim().toLowerCase()
    if (!query) {
      return data.hosts
    }
    return data.hosts.filter((host) =>
      [host.name, host.address, host.username, ...(host.tags ?? [])].join(' ').toLowerCase().includes(query),
    )
  }, [data.hosts, hostSearch])

  const loadDirectory = useCallback(
    async (nextPath: string) => {
      if (!selectedHostIdStable) {
        setEntries([])
        return
      }
      const normalized = normalizeRemotePath(nextPath)
      setLoading(true)
      setError(null)
      try {
        const listing = await api.listFiles(selectedHostIdStable, normalized)
        setCurrentPath(listing.path)
        setPathInput(listing.path)
        setEntries([...listing.entries].sort((left, right) => fileSortValue(left).localeCompare(fileSortValue(right))))
        setSelectedPaths([])
        setActiveEntry(null)
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : t('app.error'))
      } finally {
        setLoading(false)
      }
    },
    [api, selectedHostIdStable, t],
  )

  useEffect(() => {
    if (selectedHostIdStable) {
      void loadDirectory('/')
    }
  }, [loadDirectory, selectedHostIdStable])

  const notifyError = (actionError: unknown) => {
    notification.error({
      title: t('app.error'),
      description: actionError instanceof Error ? actionError.message : t('app.error'),
      duration: 5,
      role: 'alert',
      className: 'termous-notification',
    })
  }

  const runFileAction = async (action: () => Promise<void>, success?: string) => {
    try {
      await action()
      if (success) {
        notification.success({ title: success, duration: 3, role: 'status', className: 'termous-notification' })
      }
    } catch (actionError) {
      notifyError(actionError)
    }
  }

  const uploadLocalPaths = async (source: LocalGrantSource, paths: string[]) => {
    if (!selectedHostIdStable || paths.length === 0) {
      return
    }
    await runFileAction(async () => {
      const grant = await api.createLocalFileGrant(source, paths)
      const task = await api.createUploadTransfer(selectedHostIdStable, grant.id, currentPath, 'rename')
      upsertTransfer(task)
    }, t('files.transferCreated'))
  }

  const downloadPaths = async (paths: string[]) => {
    if (!selectedHostIdStable || paths.length === 0) {
      return
    }
    const localDirs = await window.termous?.files?.pickDirectory()
    const localDir = localDirs?.[0]
    if (!localDir) {
      return
    }
    await runFileAction(async () => {
      const task = await api.createDownloadTransfer(selectedHostIdStable, paths, localDir, 'rename')
      upsertTransfer(task)
    }, t('files.transferCreated'))
  }

  const downloadSelected = () => downloadPaths(selectedPaths)

  const pasteRemoteClipboard = async () => {
    if (!remoteClipboard || remoteClipboard.hostId !== selectedHostIdStable) {
      return false
    }
    await runFileAction(async () => {
      if (remoteClipboard.mode === 'cut') {
        await api.moveFiles(selectedHostIdStable, remoteClipboard.paths, currentPath, 'rename')
        setRemoteClipboard(null)
      } else {
        await api.copyFiles(selectedHostIdStable, remoteClipboard.paths, currentPath, 'rename')
      }
      await loadDirectory(currentPath)
    }, t('files.operationDone'))
    return true
  }

  const pasteFromClipboard = async () => {
    if (await pasteRemoteClipboard()) {
      return
    }
    const paths = await window.termous?.files?.readClipboardFilePaths()
    if (paths?.length) {
      await uploadLocalPaths('clipboard', paths)
    }
  }

  const openCreateDirectory = () => {
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
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        const target = joinPath(currentPath, cleanName)
        await api.mkdirFile(selectedHostIdStable, target)
        await loadDirectory(currentPath)
      },
    })
  }

  const openRename = (entry = selectedEntries[0]) => {
    if (!entry) {
      return
    }
    let name = entry.name
    modal.confirm({
      title: t('files.rename'),
      icon: null,
      content: <Input autoFocus defaultValue={entry.name} onChange={(event) => { name = event.target.value }} />,
      okText: t('app.update'),
      cancelText: t('app.cancel'),
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        const cleanName = name.trim()
        if (!cleanName) {
          throw new Error(t('files.nameRequired'))
        }
        await api.renameFile(selectedHostIdStable, entry.path, joinPath(parentPath(entry.path), cleanName))
        await loadDirectory(currentPath)
      },
    })
  }

  const confirmDelete = (paths = selectedPaths) => {
    if (!selectedHostIdStable || paths.length === 0) {
      return
    }
    modal.confirm({
      title: t('files.deleteTitle'),
      content: t('files.deleteDescription', { count: paths.length }),
      okText: t('app.delete'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      onOk: async () => {
        await api.deleteFiles(selectedHostIdStable, paths, true)
        await loadDirectory(currentPath)
      },
    })
  }

  const pickFiles = async () => {
    const paths = await window.termous?.files?.pickFiles()
    await uploadLocalPaths('picker', paths ?? [])
  }

  const pickFolder = async () => {
    const paths = await window.termous?.files?.pickDirectory()
    await uploadLocalPaths('picker', paths ?? [])
  }

  const copySelected = (mode: 'copy' | 'cut') => {
    if (selectedPaths.length === 0 || !selectedHostIdStable) {
      return
    }
    setRemoteClipboard({ mode, hostId: selectedHostIdStable, paths: selectedPaths })
    notification.success({ title: mode === 'cut' ? t('files.cutReady') : t('files.copyReady'), duration: 2 })
  }

  const enterEntry = (entry: RemoteFileEntry) => {
    setActiveEntry(entry)
    if (entry.kind === 'directory') {
      void loadDirectory(entry.path)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return
    }
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 'c') {
      event.preventDefault()
      copySelected('copy')
    } else if (mod && event.key.toLowerCase() === 'x') {
      event.preventDefault()
      copySelected('cut')
    } else if (mod && event.key.toLowerCase() === 'v') {
      event.preventDefault()
      void pasteFromClipboard()
    } else if (event.key === 'Delete') {
      event.preventDefault()
      confirmDelete()
    } else if (event.key === 'F2') {
      event.preventDefault()
      openRename()
    } else if (event.key === 'Backspace') {
      event.preventDefault()
      void loadDirectory(parentPath(currentPath))
    }
  }

  const onDrop = async (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDragActive(false)
    const paths = await window.termous?.files?.pathsFromFileList(event.dataTransfer.files)
    await uploadLocalPaths('drop', paths ?? [])
  }

  const actionDisabled = !selectedHostIdStable || loading
  const rowMenu = (): MenuProps['items'] => [
    { key: 'download', icon: <Download size={14} />, label: t('files.download') },
    { key: 'copy', icon: <Copy size={14} />, label: t('files.copy') },
    { key: 'cut', icon: <Scissors size={14} />, label: t('files.cut') },
    { key: 'rename', icon: <Pencil size={14} />, label: t('files.rename') },
    { type: 'divider' },
    { key: 'delete', danger: true, icon: <Trash2 size={14} />, label: t('app.delete') },
  ]

  const columns = [
    {
      title: t('files.name'),
      dataIndex: 'name',
      width: 220,
      sorter: (left: RemoteFileEntry, right: RemoteFileEntry) => fileSortValue(left).localeCompare(fileSortValue(right)),
      render: (_: unknown, entry: RemoteFileEntry) => (
        <span className="file-name-cell">
          <span className={`file-kind-icon is-${entry.kind}`}>
            {entry.kind === 'directory' ? <Folder size={16} /> : <File size={16} />}
          </span>
          <span>
            <strong>{entry.name}</strong>
            {entry.target ? <small>{entry.target}</small> : null}
          </span>
        </span>
      ),
    },
    { title: t('files.size'), dataIndex: 'size', width: 96, render: (value: number, entry: RemoteFileEntry) => entry.kind === 'directory' ? '-' : formatBytes(value) },
    { title: t('files.modified'), dataIndex: 'modified_at', width: 154, render: (value: string) => formatDate(value) },
    { title: t('files.permissions'), dataIndex: 'permissions', width: 92, render: (value: string) => value || '-' },
    {
      title: '',
      width: 44,
      render: (_: unknown, entry: RemoteFileEntry) => (
        <Dropdown
          menu={{
            items: rowMenu(),
            onClick: ({ key }) => {
              setSelectedPaths([entry.path])
              if (key === 'download') void downloadPaths([entry.path])
              if (key === 'copy') setRemoteClipboard({ mode: 'copy', hostId: selectedHostIdStable, paths: [entry.path] })
              if (key === 'cut') setRemoteClipboard({ mode: 'cut', hostId: selectedHostIdStable, paths: [entry.path] })
              if (key === 'rename') openRename(entry)
              if (key === 'delete') confirmDelete([entry.path])
            },
          }}
          trigger={['click', 'contextMenu']}
          overlayClassName="files-row-menu"
        >
          <Button
            type="text"
            className="files-icon-button"
            aria-label={t('files.actions')}
            icon={<MoreHorizontal size={16} />}
          />
        </Dropdown>
      ),
    },
  ]

  return (
    <section
      className={`files-page ${dragActive ? 'is-dragging' : ''}`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragOver={(event) => {
        event.preventDefault()
        setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={(event) => void onDrop(event)}
    >
      <aside className="files-host-panel list-panel">
        <div className="page-title-row compact-title">
          <div>
            <h1>{t('files.title')}</h1>
            <p>{t('files.subtitle')}</p>
          </div>
        </div>
        <Input
          id="files-host-search"
          name="files-host-search"
          className="host-search-input"
          value={hostSearch}
          allowClear
          onChange={(event) => setHostSearch(event.target.value)}
          prefix={<Search size={15} aria-hidden="true" />}
          placeholder={t('files.hostSearch')}
        />
        <div className="files-host-list">
          {visibleHosts.map((host) => (
            <button
              type="button"
              key={host.id}
              className={`files-host-row ${host.id === selectedHostIdStable ? 'is-active' : ''}`}
              onClick={() => {
                onSelectHost(host.id)
                setCurrentPath('/')
                setPathInput('/')
              }}
            >
              <span className="row-icon">
                <Folder size={15} aria-hidden="true" />
              </span>
              <span className="row-copy">
                <strong>{host.name}</strong>
                <small>{host.username}@{host.address}:{host.port}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <main className="files-main-panel">
        <div className="files-main-toolbar">
          <div className="files-path-stack">
            <PathTrail path={currentPath} onNavigate={(path) => void loadDirectory(path)} />
            <Input.Search
              id="files-path-input"
              name="files-path-input"
              value={pathInput}
              onChange={(event) => setPathInput(event.target.value)}
              onSearch={(value) => void loadDirectory(value)}
              enterButton={t('files.go')}
              className="files-path-input"
            />
          </div>
          <div className="files-toolbar-actions">
            <Tooltip title={t('files.parent')}>
              <Button
                className="secondary-button"
                aria-label={t('files.parent')}
                disabled={actionDisabled || currentPath === '/'}
                icon={<ArrowLeft size={15} />}
                onClick={() => void loadDirectory(parentPath(currentPath))}
              />
            </Tooltip>
            <Tooltip title={t('app.reload')}>
              <Button
                className="secondary-button"
                aria-label={t('app.reload')}
                disabled={actionDisabled}
                icon={<RefreshCw className={loading ? 'is-spinning' : ''} size={15} />}
                onClick={() => void loadDirectory(currentPath)}
              />
            </Tooltip>
            <Button className="secondary-button" disabled={actionDisabled} icon={<FolderPlus size={15} />} onClick={openCreateDirectory}>
              {t('files.newFolder')}
            </Button>
            <Button className="secondary-button" disabled={actionDisabled} icon={<Upload size={15} />} onClick={() => void pickFiles()}>
              {t('files.uploadFiles')}
            </Button>
            <Button className="secondary-button" disabled={actionDisabled} icon={<Folder size={15} />} onClick={() => void pickFolder()}>
              {t('files.uploadFolder')}
            </Button>
            <Button className="primary-button" disabled={selectedPaths.length === 0} icon={<Download size={15} />} onClick={() => void downloadSelected()}>
              {t('files.download')}
            </Button>
            <Button className="secondary-button" disabled={selectedPaths.length === 0} icon={<Copy size={15} />} onClick={() => copySelected('copy')}>
              {t('files.copy')}
            </Button>
            <Button className="secondary-button" disabled={selectedPaths.length === 0} icon={<Scissors size={15} />} onClick={() => copySelected('cut')}>
              {t('files.cut')}
            </Button>
            <Button className="secondary-button" disabled={!selectedHostIdStable} icon={<Clipboard size={15} />} onClick={() => void pasteFromClipboard()}>
              {t('files.paste')}
            </Button>
            <Button className="secondary-button" disabled={selectedPaths.length !== 1} icon={<Pencil size={15} />} onClick={() => openRename()}>
              {t('files.rename')}
            </Button>
            <Button className="danger-button" disabled={selectedPaths.length === 0} icon={<Trash2 size={15} />} onClick={() => confirmDelete()}>
              {t('app.delete')}
            </Button>
          </div>
        </div>

        {error ? <div className="files-error">{error}</div> : null}
        <div className="files-table-shell">
          {selectedHostIdStable ? (
            <Table
              rowKey="path"
              columns={columns}
              dataSource={entries}
              loading={loading}
              pagination={false}
              size="middle"
              className="files-table"
              rowSelection={{
                selectedRowKeys: selectedPaths,
                onChange: (keys) => setSelectedPaths(keys.map(String)),
              }}
              onRow={(entry) => ({
                onClick: () => setActiveEntry(entry),
                onDoubleClick: () => enterEntry(entry),
              })}
              locale={{ emptyText: <EmptyState title={t('files.emptyDirectory')} description={t('files.emptyDirectoryHint')} /> }}
            />
          ) : (
            <EmptyState title={t('files.noHost')} description={t('files.noHostHint')} />
          )}
        </div>
        {dragActive ? <div className="files-drop-mask">{t('files.dropUpload')}</div> : null}
      </main>

      <aside className="files-right-rail">
        <TransferQueuePanel
          transfers={transfers}
          connected={connected}
          onCancel={(id) => api.deleteTransfer(id)}
          onRetry={async (id) => {
            const task = await api.retryTransfer(id)
            upsertTransfer(task)
          }}
        />
        <FileDetailPanel host={selectedHost} entry={activeEntry ?? selectedEntries[0] ?? null} />
      </aside>
    </section>
  )
}

function PathTrail({ path, onNavigate }: { path: string; onNavigate: (path: string) => void }) {
  const parts = normalizeRemotePath(path).split('/').filter(Boolean)
  const crumbs = [{ label: '/', path: '/' }]
  parts.forEach((part, index) => {
    crumbs.push({ label: part, path: `/${parts.slice(0, index + 1).join('/')}` })
  })
  return (
    <div className="files-breadcrumb" aria-label="Path">
      {crumbs.map((crumb, index) => (
        <button type="button" key={crumb.path} onClick={() => onNavigate(crumb.path)}>
          <span>{crumb.label}</span>
          {index < crumbs.length - 1 ? <i>/</i> : null}
        </button>
      ))}
    </div>
  )
}

function FileDetailPanel({ host, entry }: { host?: Host; entry: RemoteFileEntry | null }) {
  const { t } = useTranslation()
  return (
    <aside className="files-detail-panel details-panel">
      <div className="panel-heading">
        <div>
          <h2>{t('files.details')}</h2>
          <span>{host ? host.name : t('files.noHost')}</span>
        </div>
      </div>
      {entry ? (
        <dl className="files-detail-list">
          <div>
            <dt>{t('files.name')}</dt>
            <dd>{entry.name}</dd>
          </div>
          <div>
            <dt>{t('files.path')}</dt>
            <dd>{entry.path}</dd>
          </div>
          <div>
            <dt>{t('files.kind')}</dt>
            <dd>{t(`files.kindName.${entry.kind}`)}</dd>
          </div>
          <div>
            <dt>{t('files.size')}</dt>
            <dd>{entry.kind === 'directory' ? '-' : formatBytes(entry.size)}</dd>
          </div>
          <div>
            <dt>{t('files.modified')}</dt>
            <dd>{formatDate(entry.modified_at)}</dd>
          </div>
          <div>
            <dt>{t('files.permissions')}</dt>
            <dd>{entry.permissions || '-'}</dd>
          </div>
        </dl>
      ) : (
        <div className="files-quiet-empty">
          <strong>{t('files.noSelection')}</strong>
          <span>{t('files.noSelectionHint')}</span>
        </div>
      )}
    </aside>
  )
}
