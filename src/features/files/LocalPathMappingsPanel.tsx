import { App as AntdApp, Button, Empty, Input, Modal, Popconfirm, Tooltip, Tree } from 'antd'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type DragEvent,
  type Key,
  type PointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
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
  onUpdateMapping: (id: string, input: LocalPathMappingInput) => Promise<LocalPathMapping>
  onDeleteMapping: (id: string) => Promise<void>
  onReorderMappings: (items: LocalPathMappingReorderItem[]) => Promise<LocalPathMapping[]>
  onDownloadToLocalDir: (remotePaths: string[], localDir: string) => Promise<void>
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
  collapsed,
  resizing = false,
  remoteDragMime,
  remoteDragPaths,
  tabs,
  onToggleCollapsed,
  onResizePointerDown,
  onCreateMapping,
  onUpdateMapping,
  onDeleteMapping,
  onReorderMappings,
  onDownloadToLocalDir,
}: LocalPathMappingsPanelProps) {
  const { t } = useTranslation()
  const { notification } = AntdApp.useApp()
  const [query, setQuery] = useState('')
  const [selectedMappingId, setSelectedMappingId] = useState('')
  const [draft, setDraft] = useState<MappingDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const [childrenByMapping, setChildrenByMapping] = useState<Record<string, Record<string, LocalTreeEntry[]>>>({})
  const [expandedKeys, setExpandedKeys] = useState<Key[]>([])
  const [loadingPath, setLoadingPath] = useState('')
  const [dropTargetPath, setDropTargetPath] = useState('')

  const visibleMappings = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return mappings
    }
    return mappings.filter((mapping) => `${mapping.name} ${mapping.path}`.toLowerCase().includes(normalizedQuery))
  }, [mappings, query])
  const selectedMapping = useMemo(
    () => mappings.find((mapping) => mapping.id === selectedMappingId) ?? mappings[0] ?? null,
    [mappings, selectedMappingId],
  )
  const selectedChildrenByPath = useMemo(
    () => selectedMapping ? childrenByMapping[selectedMapping.id] ?? emptyChildrenByPath : emptyChildrenByPath,
    [childrenByMapping, selectedMapping],
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

  useEffect(() => {
    if (!selectedMapping || mappings.some((mapping) => mapping.id === selectedMappingId)) {
      return
    }
    setSelectedMappingId(selectedMapping.id)
  }, [mappings, selectedMapping, selectedMappingId])

  useEffect(() => {
    if (!selectedMapping || !selectedMapping.available || selectedChildrenByPath[selectedMapping.path]) {
      return
    }
    void loadChildren(selectedMapping, selectedMapping.path)
  }, [loadChildren, selectedChildrenByPath, selectedMapping])

  useEffect(() => {
    if (selectedMapping) {
      setExpandedKeys((current) => current.includes(selectedMapping.path) ? current : [selectedMapping.path, ...current])
    }
  }, [selectedMapping])

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
    setDraft({ id: mapping.id, name: mapping.name, path: mapping.path })
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
      const saved = draft.id ? await onUpdateMapping(draft.id, input) : await onCreateMapping(input)
      setSelectedMappingId(saved.id)
      setDraft(null)
    } catch (error) {
      notifyError(error)
    } finally {
      setSaving(false)
    }
  }

  const deleteMapping = async (mapping: LocalPathMapping) => {
    try {
      await onDeleteMapping(mapping.id)
      setChildrenByMapping((current) => {
        const next = { ...current }
        delete next[mapping.id]
        return next
      })
    } catch (error) {
      notifyError(error)
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

  const treeData = useMemo(() => {
    if (!selectedMapping) {
      return []
    }
    const buildNode = (entry: LocalTreeEntry): LocalTreeNode => ({
      key: entry.path,
      title: (
        <LocalTreeTitle
          name={entry.name}
          path={entry.path}
          kind={entry.kind}
          active={dropTargetPath === entry.path}
          onDragOver={(event) => prepareLocalDrop(entry.path, event)}
          onDragLeave={() => setDropTargetPath((current) => current === entry.path ? '' : current)}
          onDrop={(event) => void handleLocalDrop(entry.path, event)}
        />
      ),
      isLeaf: entry.kind !== 'directory' || !entry.has_children,
      children: entry.kind === 'directory' ? (selectedChildrenByPath[entry.path] ?? []).map(buildNode) : undefined,
    })
    return [{
      key: selectedMapping.path,
      title: (
        <LocalTreeTitle
          name={selectedMapping.name}
          path={selectedMapping.path}
          kind="directory"
          root
          active={dropTargetPath === selectedMapping.path}
          onDragOver={(event) => prepareLocalDrop(selectedMapping.path, event)}
          onDragLeave={() => setDropTargetPath((current) => current === selectedMapping.path ? '' : current)}
          onDrop={(event) => void handleLocalDrop(selectedMapping.path, event)}
        />
      ),
      isLeaf: false,
      children: (selectedChildrenByPath[selectedMapping.path] ?? []).map(buildNode),
    }]
  }, [dropTargetPath, handleLocalDrop, prepareLocalDrop, selectedChildrenByPath, selectedMapping])

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
      <div className="panel-heading">
        <div className="panel-title-copy">
          <h2>{contentCollapsed ? t('files.localMappingsShort') : t('files.localMappings')}</h2>
          {!contentCollapsed ? <span>{t('files.localMappingsHint')}</span> : null}
        </div>
      </div>
      {!contentCollapsed ? (
        <>
          <div className="host-context-content-before">{tabs}</div>
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
                      onEdit={() => openEdit(mapping)}
                      onDelete={() => void deleteMapping(mapping)}
                      onDragOver={(event) => prepareLocalDrop(mapping.path, event)}
                      onDragLeave={() => setDropTargetPath((current) => current === mapping.path ? '' : current)}
                      onDrop={(event) => void handleLocalDrop(mapping.path, event)}
                    />
                  ))
                )}
              </div>
              {selectedMapping ? (
                <div className="local-path-tree-card">
                  <div className="local-path-tree-head">
                    <span>
                      <FolderOpen size={15} aria-hidden="true" />
                      {t('files.localTree')}
                    </span>
                    <Tooltip title={selectedMapping.path}>
                      <code>{selectedMapping.path}</code>
                    </Tooltip>
                  </div>
                  <Tree
                    className="local-path-tree"
                    treeData={treeData}
                    expandedKeys={expandedKeys}
                    selectable={false}
                    blockNode
                    loadData={(node) => {
                      const path = String(node.key)
                      return !selectedMapping.available || selectedChildrenByPath[path] ? Promise.resolve() : loadChildren(selectedMapping, path)
                    }}
                    onExpand={(keys) => setExpandedKeys(keys)}
                  />
                  {loadingPath ? <span className="local-path-loading">{t('files.localTreeLoading')}</span> : null}
                </div>
              ) : null}
            </div>
          )}
        </>
      ) : null}
      <Modal
        open={Boolean(draft)}
        title={draft?.id ? t('files.editLocalMapping') : t('files.addLocalMapping')}
        className="termous-modal files-local-path-modal"
        okText={draft?.id ? t('app.save') : t('app.create')}
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
  onEdit,
  onDelete,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  mapping: LocalPathMapping
  active: boolean
  dropTarget: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}) {
  const { t } = useTranslation()
  return (
    <article
      className={`local-path-row ${active ? 'is-active' : ''} ${dropTarget ? 'is-drop-target' : ''} ${mapping.available ? '' : 'is-unavailable'}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <button type="button" className="local-path-row-main" onClick={onSelect}>
        <span className="local-path-row-icon">
          <HardDrive size={15} aria-hidden="true" />
        </span>
        <span className="local-path-row-copy">
          <strong>{mapping.name}</strong>
          <small>{mapping.path}</small>
        </span>
        {!mapping.available ? <em>{t('files.localUnavailable')}</em> : null}
      </button>
      <div className="local-path-row-actions">
        <Button size="small" type="text" icon={<Pencil size={14} aria-hidden="true" />} onClick={onEdit} />
        <Popconfirm title={t('files.deleteLocalMappingTitle')} okText={t('app.delete')} cancelText={t('app.cancel')} onConfirm={onDelete}>
          <Button size="small" type="text" danger icon={<Trash2 size={14} aria-hidden="true" />} />
        </Popconfirm>
      </div>
    </article>
  )
}

function LocalTreeTitle({
  name,
  path,
  kind,
  root = false,
  active,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  name: string
  path: string
  kind: string
  root?: boolean
  active: boolean
  onDragOver: (event: DragEvent<HTMLElement>) => void
  onDragLeave: () => void
  onDrop: (event: DragEvent<HTMLElement>) => void
}) {
  const icon = kind === 'directory' ? <Folder size={14} aria-hidden="true" /> : <File size={14} aria-hidden="true" />
  return (
    <Tooltip title={path} placement="topLeft" mouseEnterDelay={0.35} overlayClassName="file-name-tooltip">
      <span
        className={`local-path-tree-title ${root ? 'is-root' : ''} ${active ? 'is-drop-target' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <span className="local-path-tree-icon">{icon}</span>
        <span className="local-path-tree-copy">{name}</span>
        {active ? <span className="local-path-drop-badge"><Download size={12} aria-hidden="true" /></span> : null}
      </span>
    </Tooltip>
  )
}

function localPathDisplayName(path: string) {
  const trimmed = path.trim().replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || trimmed || path
}
