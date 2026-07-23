import { App as AntdApp, Button, Dropdown, Empty, Input, Modal, Tooltip, Tree, type MenuProps } from 'antd'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  embedded?: boolean
  collapsed?: boolean
  resizing?: boolean
  tabs?: ReactNode
  onToggleCollapsed?: () => void
  onResizePointerDown?: (event: PointerEvent<HTMLDivElement>) => void
  onCreateMapping: (input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onUpdateMapping: (id: string, input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onDeleteMapping: (id: string) => Promise<void>
  onReorderMappings: (items: LocalPathMappingReorderItem[]) => Promise<LocalPathMapping[]>
  refreshRequests: LocalPathRefreshRequest[]
}

export interface LocalPathRefreshRequest {
  id: string
  targetPath: string
}

type MappingDraft = LocalPathMappingInput & { id?: string }

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
  embedded = false,
  collapsed = false,
  resizing = false,
  tabs,
  onToggleCollapsed,
  onResizePointerDown,
  onCreateMapping,
  onUpdateMapping,
  onDeleteMapping,
  onReorderMappings,
  refreshRequests,
}: LocalPathMappingsPanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = AntdApp.useApp()
  const [query, setQuery] = useState('')
  const [selectedMappingId, setSelectedMappingId] = useState('')
  const [detailMappingId, setDetailMappingId] = useState('')
  const [draft, setDraft] = useState<MappingDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [childrenByMapping, setChildrenByMapping] = useState<Record<string, Record<string, LocalTreeEntry[]>>>({})
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([])
  const [loadingPath, setLoadingPath] = useState('')
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
  // 嵌入模式的展开与尺寸由外层容器负责，组件始终展示主体内容。
  const contentCollapsed = embedded ? false : collapsed

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
    // 下载完成后仍通过刷新请求更新已经加载过的本地目录。
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
      id: current?.id,
      name: current?.name?.trim() || localPathDisplayName(path),
      path,
    }))
  }

  const openCreate = () => {
    setDraft({ name: '', path: '' })
  }

  const openEdit = (mapping: LocalPathMapping) => {
    setSelectedMappingId(mapping.id)
    setDraft({
      id: mapping.id,
      name: mapping.name,
      path: mapping.path,
    })
  }

  const confirmDelete = (mapping: LocalPathMapping) => {
    modal.confirm({
      title: t('files.deleteLocalMappingTitle'),
      content: t('files.deleteLocalMappingHint', { name: mapping.name }),
      okText: t('app.delete'),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: true },
      className: 'confirm-modal',
      rootClassName: 'termous-modal-root',
      centered: true,
      onOk: async () => {
        try {
          await onDeleteMapping(mapping.id)
          setSelectedMappingId((current) => current === mapping.id ? '' : current)
          setDetailMappingId((current) => current === mapping.id ? '' : current)
          setChildrenByMapping((current) => {
            const next = { ...current }
            delete next[mapping.id]
            return next
          })
        } catch (error) {
          notifyError(error)
          throw error
        }
      },
    })
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
      const saved = draft.id
        ? await onUpdateMapping(draft.id, input)
        : await onCreateMapping(input)
      setSelectedMappingId(saved.id)
      setChildrenByMapping((current) => {
        const next = { ...current }
        delete next[saved.id]
        return next
      })
      if (detailMappingId === saved.id) {
        setExpandedKeys([saved.path])
      }
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
          onToggle={() => toggleTreeDirectory(entry.path)}
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
          onToggle={() => toggleTreeDirectory(detailMapping.path)}
          onOpenDirectory={openLocalDirectory}
        />
      ),
      isLeaf: false,
      children: (detailChildrenByPath[detailMapping.path] ?? []).map(buildNode),
    }]
  }, [detailChildrenByPath, detailMapping, expandedKeys, openLocalDirectory, toggleTreeDirectory])

  return (
    <aside
      className={`context-panel host-context-panel files-host-context-panel files-local-path-panel ${
        !embedded && collapsed ? 'is-collapsed is-content-collapsed' : ''
      } ${!embedded && resizing ? 'is-resizing' : ''} ${embedded ? 'is-embedded' : ''}`.trim()}
    >
      {!embedded && onResizePointerDown ? (
        <div className="host-context-resize-edge" aria-hidden="true" onPointerDown={onResizePointerDown} />
      ) : null}
      {!embedded && onToggleCollapsed ? (
        <Tooltip title={collapsed ? t('app.expand') : t('app.collapse')} destroyOnHidden mouseLeaveDelay={0}>
          <Button
            type="text"
            className="panel-side-toggle panel-side-toggle-left"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? t('app.expand') : t('app.collapse')}
            icon={collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
          />
        </Tooltip>
      ) : null}
      {!contentCollapsed ? (
        <>
          {!embedded && tabs ? <div className="host-context-content-before">{tabs}</div> : null}
          {detailMapping ? (
            <div className="local-path-detail">
              <div className="local-path-detail-nav">
                <Button
                  type="text"
                  className="local-path-back-button"
                  icon={<ArrowLeft size={15} aria-hidden="true" />}
                  onClick={() => {
                    setDetailMappingId('')
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
                  className={`local-path-detail-summary ${detailMapping.available ? '' : 'is-unavailable'}`}
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
                <Button
                  className="secondary-button"
                  aria-label={t('app.moveUp')}
                  disabled={!selectedMapping || selectedIndex <= 0}
                  icon={<ArrowUp size={15} aria-hidden="true" />}
                  onClick={() => void moveMapping(-1)}
                />
                <Button
                  className="secondary-button"
                  aria-label={t('app.moveDown')}
                  disabled={!selectedMapping || selectedIndex < 0 || selectedIndex >= mappings.length - 1}
                  icon={<ArrowDown size={15} aria-hidden="true" />}
                  onClick={() => void moveMapping(1)}
                />
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
                          onSelect={() => setSelectedMappingId(mapping.id)}
                          onOpenDetail={() => openDetail(mapping)}
                          onOpenDirectory={openLocalDirectory}
                          onEdit={() => openEdit(mapping)}
                          onDelete={() => confirmDelete(mapping)}
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
        title={draft?.id ? t('files.editLocalMapping') : t('files.addLocalMapping')}
        className="termous-modal files-local-path-modal"
        okText={draft?.id ? t('app.update') : t('app.create')}
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
  onSelect,
  onOpenDetail,
  onOpenDirectory,
  onEdit,
  onDelete,
}: {
  mapping: LocalPathMapping
  active: boolean
  onSelect: () => void
  onOpenDetail: () => void
  onOpenDirectory: (path: string) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const menuItems = localMappingMenuItems(t('files.openLocalDirectory'), t('app.edit'), t('app.delete'))
  const onMenuClick = localMappingMenuClick(mapping.path, onOpenDirectory, onEdit, onDelete)
  return (
    <ContextActionMenu
      items={menuItems}
      onClick={onMenuClick}
    >
      <article
        className={`local-path-row ${active ? 'is-active' : ''} ${mapping.available ? '' : 'is-unavailable'}`}
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
          <Tooltip title={t('files.localMappingActions')} destroyOnHidden mouseLeaveDelay={0}>
            <Dropdown
              trigger={['click']}
              classNames={{ root: 'context-action-menu' }}
              menu={{ items: menuItems, onClick: onMenuClick }}
            >
              <Button
                className="local-path-more-button"
                size="small"
                type="text"
                icon={<MoreHorizontal size={15} aria-hidden="true" />}
                aria-label={t('files.localMappingActions')}
                onClick={(event) => event.stopPropagation()}
              />
            </Dropdown>
          </Tooltip>
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
  onToggle,
  onOpenDirectory,
}: {
  name: string
  path: string
  kind: string
  root?: boolean
  expanded: boolean
  expandable: boolean
  onToggle: () => void
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
      }`}
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
    >
      <span className="local-path-tree-icon" data-empty={!expandable ? 'true' : undefined}>{icon}</span>
      <Tooltip title={path} placement="topLeft" mouseEnterDelay={0.35} classNames={{ root: 'file-name-tooltip' }}>
        <span className="local-path-tree-copy">{name}</span>
      </Tooltip>
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

function localMappingMenuItems(openLabel: string, editLabel: string, deleteLabel: string): MenuProps['items'] {
  return [
    {
      key: 'open-local-directory',
      icon: <FolderOpen size={14} aria-hidden="true" />,
      label: openLabel,
    },
    {
      key: 'edit-local-mapping',
      icon: <Pencil size={14} aria-hidden="true" />,
      label: editLabel,
    },
    { type: 'divider' },
    {
      key: 'delete-local-mapping',
      danger: true,
      icon: <Trash2 size={14} aria-hidden="true" />,
      label: deleteLabel,
    },
  ]
}

function localMappingMenuClick(
  localPath: string,
  onOpenDirectory: (path: string) => void,
  onEdit: () => void,
  onDelete: () => void,
): MenuProps['onClick'] {
  return ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (key === 'open-local-directory') {
      onOpenDirectory(localPath)
    } else if (key === 'edit-local-mapping') {
      onEdit()
    } else if (key === 'delete-local-mapping') {
      onDelete()
    }
  }
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
