import { App as AntdApp, Button, Empty, Input, Modal, Tooltip, Tree, type MenuProps } from 'antd'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LockKeyhole,
  RefreshCw,
  Search,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type Key,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { ContextActionMenu } from '../../components/ui/ContextActionMenu'
import { EmptyState } from '../../components/ui/EmptyState'
import type {
  LocalPathMapping,
  LocalPathMappingInput,
  LocalPathMappingReorderItem,
  LocalTreeEntry,
} from '../../types/domain'

interface LocalPathMappingsPanelProps {
  api: TermousApi
  mappings: LocalPathMapping[]
  collapsed: boolean
  resizing?: boolean
  remoteDragMime: string
  remoteDragPaths: string[]
  tabs: ReactNode
  onToggleCollapsed: () => void
  onResizePointerDown?: (event: PointerEvent<HTMLDivElement>) => void
  onCreateMapping: (input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onReorderMappings: (items: LocalPathMappingReorderItem[]) => Promise<LocalPathMapping[]>
  onDownloadToLocalDir: (remotePaths: string[], localDir: string) => Promise<void>
  refreshRequests: LocalPathRefreshRequest[]
}

export interface LocalPathRefreshRequest {
  id: string
  targetPath: string
}

type MappingDraft = LocalPathMappingInput

const emptyChildrenByPath: Record<string, LocalTreeEntry[]> = {}

interface LocalTreeNode {
  key: string
  title: ReactNode
  isLeaf?: boolean
  children?: LocalTreeNode[]
}

export function LocalPathMappingsPanel({
  api,
  mappings,
  collapsed,
  resizing = false,
  remoteDragMime,
  remoteDragPaths,
  tabs,
  onToggleCollapsed,
  onResizePointerDown,
  onCreateMapping,
  onReorderMappings,
  onDownloadToLocalDir,
  refreshRequests,
}: LocalPathMappingsPanelProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [query, setQuery] = useState('')
  const [selectedMappingId, setSelectedMappingId] = useState('')
  const [detailMappingId, setDetailMappingId] = useState('')
  const [draft, setDraft] = useState<MappingDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [childrenByMapping, setChildrenByMapping] = useState<Record<string, Record<string, LocalTreeEntry[]>>>({})
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([])
  const [loadingPath, setLoadingPath] = useState('')
  const [dropTargetPath, setDropTargetPath] = useState('')
  const processedRefreshRequestIdsRef = useRef(new Set<string>())

  const visibleMappings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return mappings
    }
    return mappings.filter((mapping) => `${mapping.name} ${mapping.path}`.toLowerCase().includes(normalizedQuery))
  }, [mappings, query])
  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === selectedMappingId) ?? null,
    [mappings, selectedMappingId],
  )
  const detailMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === detailMappingId) ?? null,
    [mappings, detailMappingId],
  )
  const detailChildrenByPath = useMemo(
    () => detailMapping ? childrenByMapping[detailMapping.id] ?? emptyChildrenByPath : emptyChildrenByPath,
    [childrenByMapping, detailMapping],
  )
  const selectedIndex = selectedMapping ? mappings.findIndex((mapping) => mapping.id === selectedMapping.id) : -1
  const contentCollapsed = collapsed

  const notifyError = useCallback((error: unknown) => {
    notification.error({
      message: t('files.localMappingsActionFailed'),
      description: error instanceof Error ? error.message : t('app.error'),
      placement: 'topRight',
      duration: 3.2,
      className: 'termous-notification',
    })
  }, [notification, t])

  const loadChildren = useCallback(async (mapping: LocalPathMapping, path: string) => {
    setLoadingPath(path)
    try {
      const entries = await api.localPathMappingChildren(mapping.id, path)
      setChildrenByMapping((current) => ({
        ...current,
        [mapping.id]: {
          ...(current[mapping.id] ?? {}),
          [path]: entries,
        },
      }))
    } catch (error) {
      notifyError(error)
    } finally {
      setLoadingPath('')
    }
  }, [api, notifyError])

  const openLocalDirectory = useCallback(async (localPath: string) => {
    if (!localPath || !window.termous?.files?.openDirectory) {
      notification.error({
        message: t('files.openLocalDirectoryFailed'),
        placement: 'topRight',
        duration: 2.8,
        className: 'termous-notification',
      })
      return
    }
    const result = await window.termous.files.openDirectory(localPath)
    if (!result.ok) {
      notification.error({
        message: t('files.openLocalDirectoryFailed'),
        description: result.error,
        placement: 'topRight',
        duration: 3,
        className: 'termous-notification',
      })
    }
  }, [notification, t])

  useEffect(() => {
    if (!selectedMappingId || mappings.some((mapping) => mapping.id === selectedMappingId)) {
      return
    }
    setSelectedMappingId('')
  }, [mappings, selectedMappingId])

  useEffect(() => {
    if (!detailMappingId || mappings.some((mapping) => mapping.id === detailMappingId)) {
      return
    }
    setDetailMappingId('')
  }, [detailMappingId, mappings])

  useEffect(() => {
    if (!detailMapping || !detailMapping.available || detailChildrenByPath[detailMapping.path]) {
      return
    }
    void loadChildren(detailMapping, detailMapping.path)
  }, [detailChildrenByPath, detailMapping, loadChildren])

  useEffect(() => {
    if (detailMapping) {
      setExpandedKeys((current) => current.includes(detailMapping.path) ? current : [detailMapping.path, ...current])
    }
  }, [detailMapping])

  useEffect(() => {
    const activeRequestIds = new Set(refreshRequests.map((request) => request.id))
    processedRefreshRequestIdsRef.current.forEach((requestId) => {
      if (!activeRequestIds.has(requestId)) {
        processedRefreshRequestIdsRef.current.delete(requestId)
      }
    })
  }, [refreshRequests])

  useEffect(() => {
    if (!detailMapping || !detailMapping.available || refreshRequests.length === 0) {
      return
    }

    const refreshPaths = new Map<string, string>()
    const loadedPaths = Object.keys(detailChildrenByPath)
    refreshRequests.forEach((request) => {
      if (processedRefreshRequestIdsRef.current.has(request.id) || !isLocalPathWithin(request.targetPath, detailMapping.path)) {
        return
      }
      processedRefreshRequestIdsRef.current.add(request.id)
      const refreshPath = localTreeLoadedPath(request.targetPath, loadedPaths) ?? request.targetPath
      refreshPaths.set(normalizeLocalPathForCompare(refreshPath), refreshPath)
    })

    refreshPaths.forEach((path) => {
      void loadChildren(detailMapping, path)
    })
  }, [detailChildrenByPath, detailMapping, loadChildren, refreshRequests])

  const chooseDirectory = async () => {
    const paths = await window.termous?.files?.pickDirectory()
    const path = paths?.[0]
    if (!path) {
      return
    }
    setDraft((current) => ({
      name: current?.name?.trim() || localPathDisplayName(path),
      path,
    }))
  }

  const openCreate = () => {
    setDraft({ name: '', path: '' })
  }

  const openDetail = (mapping: LocalPathMapping) => {
    setSelectedMappingId(mapping.id)
    setDetailMappingId(mapping.id)
    setExpandedKeys((current) => current.includes(mapping.path) ? current : [mapping.path, ...current])
  }

  const saveDraft = async () => {
    if (!draft) {
      return
    }
    const input = {
      name: draft.name.trim(),
      path: draft.path.trim(),
    }
    if (!input.path) {
      notification.warning({ message: t('files.localPathRequired'), placement: 'topRight', duration: 2.4 })
      return
    }
    if (!input.name) {
      input.name = localPathDisplayName(input.path)
    }
    setSaving(true)
    try {
      const saved = await onCreateMapping(input)
      setSelectedMappingId(saved.id)
      setDraft(null)
    } catch (error) {
      notifyError(error)
    } finally {
      setSaving(false)
    }
  }

  const moveMapping = async (direction: -1 | 1) => {
    if (!selectedMapping || selectedIndex < 0) {
      return
    }
    const targetIndex = selectedIndex + direction
    if (targetIndex < 0 || targetIndex >= mappings.length) {
      return
    }
    const next = [...mappings]
    const [item] = next.splice(selectedIndex, 1)
    next.splice(targetIndex, 0, item)
    try {
      await onReorderMappings(next.map((mapping, index) => ({ id: mapping.id, sort_order: index })))
    } catch (error) {
      notifyError(error)
    }
  }

  const remotePathsFromDrag = useCallback((event: DragEvent<HTMLElement>) => {
    if (remoteDragPaths.length > 0) {
      return remoteDragPaths
    }
    try {
      const payload = event.dataTransfer.getData(remoteDragMime)
      const parsed = payload ? JSON.parse(payload) : []
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch {
      return []
    }
  }, [remoteDragMime, remoteDragPaths])

  const handleLocalDrop = useCallback(async (targetPath: string, event: DragEvent<HTMLElement>) => {
    const paths = remotePathsFromDrag(event)
    if (paths.length === 0) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    setDropTargetPath('')
    try {
      await onDownloadToLocalDir(paths, targetPath)
    } catch (error) {
      notifyError(error)
    }
  }, [notifyError, onDownloadToLocalDir, remotePathsFromDrag])

  const prepareLocalDrop = useCallback((targetPath: string, event: DragEvent<HTMLElement>) => {
    const hasRemoteDrag = remoteDragPaths.length > 0 || Array.from(event.dataTransfer.types).includes(remoteDragMime)
    if (!hasRemoteDrag) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setDropTargetPath(targetPath)
  }, [remoteDragMime, remoteDragPaths])

  const toggleTreeDirectory = useCallback((path: string) => {
    if (!detailMapping) {
      return
    }
    setExpandedKeys((current) => {
      if (current.includes(path)) {
        return current.filter((key) => key !== path)
      }
      return [...current, path]
    })
    if (!detailChildrenByPath[path]) {
      void loadChildren(detailMapping, path)
    }
  }, [detailChildrenByPath, detailMapping, loadChildren])

  const refreshCurrentTree = useCallback(() => {
    if (!detailMapping) {
      return
    }
    setChildrenByMapping((current) => {
      const next = { ...current }
      delete next[detailMapping.id]
      return next
    })
    setExpandedKeys([detailMapping.path])
    void loadChildren(detailMapping, detailMapping.path)
  }, [detailMapping, loadChildren])

  const treeData = useMemo(() => {
    if (!detailMapping) {
      return []
    }
    const buildNode = (entry: LocalTreeEntry): LocalTreeNode => ({
      key: entry.path,
      title: (
        <LocalTreeTitle
          name={entry.name}
          path={entry.path}
          kind={entry.kind}
          expanded={expandedKeys.includes(entry.path)}
          expandable={entry.kind === 'directory' && entry.has_children}
          active={entry.kind === 'directory' && dropTargetPath === entry.path}
          onToggle={() => toggleTreeDirectory(entry.path)}
          onDragOver={(event) => prepareLocalDrop(localTreeDropTargetPath(entry.path, entry.kind), event)}
          onDragLeave={() => {
            const targetPath = localTreeDropTargetPath(entry.path, entry.kind)
            setDropTargetPath((current) => current === targetPath ? '' : current)
          }}
          onDrop={(event) => void handleLocalDrop(localTreeDropTargetPath(entry.path, entry.kind), event)}
          onOpenDirectory={openLocalDirectory}
        />
      ),
      isLeaf: entry.kind !== 'directory' || !entry.has_children,
      children: entry.kind === 'directory' ? (detailChildrenByPath[entry.path] ?? []).map(buildNode) : undefined,
    })
    return [{
      key: detailMapping.path,
      title: (
        <LocalTreeTitle
          name={detailMapping.name}
          path={detailMapping.path}
          kind="directory"
          root
          expanded={expandedKeys.includes(detailMapping.path)}
          expandable
          active={dropTargetPath === detailMapping.path}
          onToggle={() => toggleTreeDirectory(detailMapping.path)}
          onDragOver={(event) => prepareLocalDrop(detailMapping.path, event)}
          onDragLeave={() => setDropTargetPath((current) => current === detailMapping.path ? '' : current)}
          onDrop={(event) => void handleLocalDrop(detailMapping.path, event)}
          onOpenDirectory={openLocalDirectory}
        />
      ),
      isLeaf: false,
      children: (detailChildrenByPath[detailMapping.path] ?? []).map(buildNode),
    }]
  }, [detailChildrenByPath, detailMapping, dropTargetPath, expandedKeys, handleLocalDrop, openLocalDirectory, prepareLocalDrop, toggleTreeDirectory])

  return (
    <aside
      className={`context-panel host-context-panel files-host-context-panel files-local-path-panel ${
        collapsed ? 'is-collapsed is-content-collapsed' : ''
      } ${resizing ? 'is-resizing' : ''}`.trim()}
    >
      {onResizePointerDown ? <div className="host-context-resize-edge" aria-hidden="true" onPointerDown={onResizePointerDown} /> : null}
      <Tooltip title={collapsed ? t('app.expand') : t('app.collapse')} destroyOnHidden mouseLeaveDelay={0}>
        <Button
          type="text"
          className="panel-side-toggle panel-side-toggle-left"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t('app.expand') : t('app.collapse')}
          icon={collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        />
      </Tooltip>
      {!contentCollapsed ? (
        <>
          <div className="host-context-content-before">{tabs}</div>
          {detailMapping ? (
            <div className="local-path-detail">
              <div className="local-path-detail-nav">
                <Button
                  type="text"
                  className="local-path-back-button"
                  icon={<ArrowLeft size={15} aria-hidden="true" />}
                  onClick={() => {
                    setDetailMappingId('')
                    setDropTargetPath('')
                  }}
                >
                  {t('files.backToLocalMappings')}
                </Button>
              </div>
              <ContextActionMenu
                items={openLocalDirectoryMenuItems(t('files.openLocalDirectory'))}
                onClick={openLocalDirectoryMenuClick(detailMapping.path, openLocalDirectory)}
              >
                <section
                  className={`local-path-detail-summary ${dropTargetPath === detailMapping.path ? 'is-drop-target' : ''} ${
                    detailMapping.available ? '' : 'is-unavailable'
                  }`}
                  onDragOver={(event) => prepareLocalDrop(detailMapping.path, event)}
                  onDragLeave={() => setDropTargetPath((current) => current === detailMapping.path ? '' : current)}
                  onDrop={(event) => void handleLocalDrop(detailMapping.path, event)}
                >
                  <span className="local-path-detail-icon">
                    <HardDrive size={17} aria-hidden="true" />
                  </span>
                  <span className="local-path-detail-copy">
                    <strong>{detailMapping.name}</strong>
                    <Tooltip title={detailMapping.path} placement="topLeft" mouseEnterDelay={0.35} classNames={{ root: 'file-name-tooltip' }}>
                      <small>{detailMapping.path}</small>
                    </Tooltip>
                  </span>
                  <span className="local-path-readonly-badge">
                    <LockKeyhole size={12} aria-hidden="true" />
                    {t('files.localMappingReadonly')}
                  </span>
                </section>
              </ContextActionMenu>
              {detailMapping.available ? (
                <div className="local-path-tree-card">
                  <div className="local-path-tree-head">
                    <span>
                      <FolderOpen size={15} aria-hidden="true" />
                      {t('files.localTree')}
                    </span>
                    <Button
                      type="text"
                      size="small"
                      className="local-path-tree-refresh"
                      icon={<RefreshCw size={14} aria-hidden="true" />}
                      loading={loadingPath === detailMapping.path}
                      onClick={refreshCurrentTree}
                      aria-label={t('app.reload')}
                    />
                  </div>
                  <Tree
                    className="local-path-tree"
                    treeData={treeData}
                    expandedKeys={expandedKeys}
                    selectable={false}
                    blockNode
                    switcherIcon={null}
                    loadData={(node) => {
                      const path = String(node.key)
                      return detailChildrenByPath[path] ? Promise.resolve() : loadChildren(detailMapping, path)
                    }}
                    onExpand={(keys) => setExpandedKeys(keys)}
                  />
                  {loadingPath ? <span className="local-path-loading">{t('files.localTreeLoading')}</span> : null}
                </div>
              ) : (
                <EmptyState title={t('files.localUnavailable')} description={t('files.localTreeUnavailable')} />
              )}
            </div>
          ) : (
            <>
              <Input
                id="local-path-mapping-search"
                name="local-path-mapping-search"
                className="host-search-input host-context-search termous-search-input"
                value={query}
                allowClear
                variant="borderless"
                onChange={(event) => setQuery(event.target.value)}
                prefix={<Search size={15} aria-hidden="true" />}
                placeholder={t('files.localMappingsSearch')}
              />
              <div className="local-path-actions">
                <Button className="secondary-button" icon={<FolderPlus size={15} aria-hidden="true" />} onClick={openCreate}>
                  {t('files.addLocalMapping')}
                </Button>
                <Button className="secondary-button" disabled={!selectedMapping || selectedIndex <= 0} icon={<ArrowUp size={15} aria-hidden="true" />} onClick={() => void moveMapping(-1)} />
                <Button className="secondary-button" disabled={!selectedMapping || selectedIndex < 0 || selectedIndex >= mappings.length - 1} icon={<ArrowDown size={15} aria-hidden="true" />} onClick={() => void moveMapping(1)} />
              </div>
              {mappings.length === 0 ? (
                <EmptyState title={t('files.noLocalMappings')} description={t('files.noLocalMappingsHint')} />
              ) : (
                <div className="local-path-layout">
                  <div className="local-path-list">
                    {visibleMappings.length === 0 ? (
                      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('files.noLocalMappingResults')} />
                    ) : (
                      visibleMappings.map((mapping) => (
                        <MappingRow
                          key={mapping.id}
                          mapping={mapping}
                          active={mapping.id === selectedMapping?.id}
                          dropTarget={dropTargetPath === mapping.path}
                          onSelect={() => setSelectedMappingId(mapping.id)}
                          onOpenDetail={() => openDetail(mapping)}
                          onDragOver={(event) => prepareLocalDrop(mapping.path, event)}
                          onDragLeave={() => setDropTargetPath((current) => current === mapping.path ? '' : current)}
                          onDrop={(event) => void handleLocalDrop(mapping.path, event)}
                          onOpenDirectory={openLocalDirectory}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : null}
      <Modal
        open={Boolean(draft)}
        title={t('files.addLocalMapping')}
        className="termous-modal files-local-path-modal"
        okText={t('app.create')}
        cancelText={t('app.cancel')}
        confirmLoading={saving}
        onCancel={() => setDraft(null)}
        onOk={() => void saveDraft()}
        centered
      >
        <div className="files-local-path-form">
          <label>
            <span>{t('files.localMappingName')}</span>
            <Input value={draft?.name ?? ''} onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} />
          </label>
          <label>
            <span>{t('files.localMappingPath')}</span>
            <Input
              value={draft?.path ?? ''}
              onChange={(event) => setDraft((current) => current ? { ...current, path: event.target.value } : current)}
              addonAfter={(
                <Button type="text" size="small" onClick={() => void chooseDirectory()}>
                  {t('files.chooseLocalDirectory')}
                </Button>
              )}
            />
          </label>
        </div>
      </Modal>
    </aside>
  )
}

function MappingRow({
  mapping,
  active,
  dropTarget,
  onSelect,
  onOpenDetail,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpenDirectory,
}: {
  mapping: LocalPathMapping
  active: boolean
  dropTarget: boolean
  onSelect: () => void
  onOpenDetail: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onOpenDirectory: (path: string) => void
}) {
  const { t } = useTranslation()
  return (
    <ContextActionMenu
      items={openLocalDirectoryMenuItems(t('files.openLocalDirectory'))}
      onClick={openLocalDirectoryMenuClick(mapping.path, onOpenDirectory)}
    >
      <article
        className={`local-path-row ${active ? 'is-active' : ''} ${dropTarget ? 'is-drop-target' : ''} ${mapping.available ? '' : 'is-unavailable'}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDoubleClick={onOpenDetail}
      >
        <button type="button" className="local-path-row-main" onClick={onSelect}>
          <span className="local-path-row-icon">
            <HardDrive size={15} aria-hidden="true" />
          </span>
          <span className="local-path-row-copy">
            <strong>{mapping.name}</strong>
            <small>{mapping.path}</small>
          </span>
        </button>
        <div className="local-path-row-footer">
          <Button
            className="local-path-open-button"
            size="small"
            type="text"
            icon={<FolderOpen size={14} aria-hidden="true" />}
            onClick={onOpenDetail}
          >
            {t('files.viewLocalTree')}
          </Button>
        </div>
      </article>
    </ContextActionMenu>
  )
}

function LocalTreeTitle({
  name,
  path,
  kind,
  root = false,
  expanded,
  expandable,
  active,
  onToggle,
  onDragOver,
  onDragLeave,
  onDrop,
  onOpenDirectory,
}: {
  name: string
  path: string
  kind: string
  root?: boolean
  expanded: boolean
  expandable: boolean
  active: boolean
  onToggle: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
  onOpenDirectory: (path: string) => void
}) {
  const { t } = useTranslation()
  const isDirectory = kind === 'directory'
  const icon = isDirectory
    ? expanded ? <FolderOpen size={14} aria-hidden="true" /> : <Folder size={14} aria-hidden="true" />
    : <File size={14} aria-hidden="true" />

  const toggle = () => {
    if (expandable) {
      onToggle()
    }
  }

  const titleNode = (
    <span
      className={`local-path-tree-title ${root ? 'is-root' : ''} ${isDirectory ? 'is-directory' : 'is-file'} ${
        expanded ? 'is-expanded' : ''
      } ${active ? 'is-drop-target' : ''}`}
      role={expandable ? 'button' : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
      onClick={toggle}
      onKeyDown={(event) => {
        if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) {
          return
        }
        event.preventDefault()
        onToggle()
      }}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <span className="local-path-tree-icon" data-empty={!expandable ? 'true' : undefined}>{icon}</span>
      <Tooltip title={path} placement="topLeft" mouseEnterDelay={0.35} classNames={{ root: 'file-name-tooltip' }}>
        <span className="local-path-tree-copy">{name}</span>
      </Tooltip>
      {active ? <span className="local-path-drop-badge"><Download size={12} aria-hidden="true" /></span> : null}
    </span>
  )

  if (!isDirectory) {
    return titleNode
  }

  return (
    <ContextActionMenu
      items={openLocalDirectoryMenuItems(t('files.openLocalDirectory'))}
      onClick={openLocalDirectoryMenuClick(path, onOpenDirectory)}
    >
      {titleNode}
    </ContextActionMenu>
  )
}

function openLocalDirectoryMenuItems(label: string): MenuProps['items'] {
  return [
    {
      key: 'open-local-directory',
      label: (
        <span className="context-action-menu-item">
          <span className="context-action-menu-icon">
            <FolderOpen size={14} aria-hidden="true" />
          </span>
          <span>{label}</span>
        </span>
      ),
    },
  ]
}

function openLocalDirectoryMenuClick(localPath: string, onOpenDirectory: (path: string) => void): MenuProps['onClick'] {
  return ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (key === 'open-local-directory') {
      onOpenDirectory(localPath)
    }
  }
}

function localPathDisplayName(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || trimmed || path
}

function localTreeDropTargetPath(path: string, kind: string) {
  return kind === 'directory' ? path : localParentPath(path)
}

function localParentPath(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (separatorIndex < 0) {
    return trimmed || path
  }
  const parent = trimmed.slice(0, separatorIndex + 1)
  if (/^[a-zA-Z]:[\\/]$/.test(parent) || parent === '/' || parent === '\\') {
    return parent
  }
  return trimmed.slice(0, separatorIndex)
}

function localTreeLoadedPath(targetPath: string, loadedPaths: string[]) {
  const normalizedTarget = normalizeLocalPathForCompare(targetPath)
  return loadedPaths.find((path) => normalizeLocalPathForCompare(path) === normalizedTarget)
}

function isLocalPathWithin(path: string, rootPath: string) {
  const normalizedPath = normalizeLocalPathForCompare(path)
  const normalizedRoot = normalizeLocalPathForCompare(rootPath)
  if (normalizedRoot === '/') {
    return normalizedPath.startsWith('/')
  }
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`)
}

function normalizeLocalPathForCompare(path: string) {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return normalized || '/'
}
