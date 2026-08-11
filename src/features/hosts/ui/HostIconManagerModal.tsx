import {
  Alert,
  Button,
  Empty,
  Image as AntImage,
  Input,
  Modal,
  Popconfirm,
  Tooltip,
} from 'antd'
import {
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  HOST_ICON_ACCEPT,
  MAX_HOST_ICON_BYTES,
  type Host,
  type HostIcon,
  type HostIconReorderItem,
} from '#entities/host'
import { formatBytes } from '#shared/format'
import { termousPopconfirmProps, uiStyles } from '#shared/ui'
import styles from './HostIconManagerModal.module.scss'

export interface HostIconManagerModalProps {
  open: boolean
  hostIcons: HostIcon[]
  hosts: Array<Pick<Host, 'icon_id'>>
  protectedIconIds?: readonly string[]
  actionBusy: boolean
  getIconUrl: (iconId: string) => string
  onClose: () => void
  onUpload: (file: File) => Promise<HostIcon>
  onRename: (id: string, displayName: string) => Promise<HostIcon>
  onReorder: (items: HostIconReorderItem[]) => Promise<HostIcon[]>
  onDelete: (id: string) => Promise<void>
}

type DropTarget = {
  id: string
  edge: 'before' | 'after'
}

type Operation = 'upload' | 'reorder' | `rename:${string}` | `delete:${string}`

type ErrorState = {
  key: string
  count?: number
}

const MAX_DISPLAY_NAME_LENGTH = 64
const SUPPORTED_ICON_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.svg', '.ico']

export function HostIconManagerModal({
  open,
  hostIcons,
  hosts,
  protectedIconIds = [],
  actionBusy,
  getIconUrl,
  onClose,
  onUpload,
  onRename,
  onReorder,
  onDelete,
}: HostIconManagerModalProps) {
  const { t } = useTranslation()
  const [orderedIcons, setOrderedIcons] = useState(() => sortHostIcons(hostIcons))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [operation, setOperation] = useState<Operation | null>(null)
  const [error, setError] = useState<ErrorState | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const operationInFlightRef = useRef(false)
  const reorderBusy = operation === 'reorder'
  const busy = actionBusy || operation !== null
  const normalizedEditingName = editingName.trim()
  const protectedIds = new Set(protectedIconIds.map((id) => id.trim()).filter(Boolean))
  const hostCounts = useMemo(() => {
    const counts = new Map<string, number>()
    hosts.forEach((host) => {
      const iconId = host.icon_id?.trim()
      if (iconId) counts.set(iconId, (counts.get(iconId) ?? 0) + 1)
    })
    return counts
  }, [hosts])

  useEffect(() => {
    if (!open) {
      setEditingId(null)
      setEditingName('')
      setOperation(null)
      setError(null)
      setDraggingId(null)
      setDropTarget(null)
      operationInFlightRef.current = false
      return
    }
    if (!reorderBusy) setOrderedIcons(sortHostIcons(hostIcons))
  }, [hostIcons, open, reorderBusy])

  useEffect(() => {
    if (editingId && !orderedIcons.some((icon) => icon.id === editingId)) {
      setEditingId(null)
      setEditingName('')
    }
  }, [editingId, orderedIcons])

  const upload = async (files: File[]) => {
    if (files.length === 0 || busy || operationInFlightRef.current) return
    const validFiles: File[] = []
    const validationErrors: string[] = []
    files.forEach((file) => {
      const validationError = validateHostIconFile(file)
      if (validationError) validationErrors.push(validationError)
      else validFiles.push(file)
    })
    if (validFiles.length === 0) {
      setError(files.length === 1
        ? { key: validationErrors[0] ?? 'hosts.iconLibrary.uploadFailed' }
        : { key: 'hosts.iconLibrary.batchUploadFailed', count: validationErrors.length })
      return
    }
    operationInFlightRef.current = true
    setOperation('upload')
    setError(null)
    let uploadedCount = 0
    let failedCount = validationErrors.length
    try {
      for (const file of validFiles) {
        try {
          const uploaded = await onUpload(file)
          setOrderedIcons((current) => upsertHostIcon(current, uploaded))
          uploadedCount += 1
        } catch {
          failedCount += 1
        }
      }
      if (failedCount > 0) {
        setError(files.length === 1
          ? { key: 'hosts.iconLibrary.uploadFailed' }
          : {
              key: uploadedCount > 0
                ? 'hosts.iconLibrary.batchUploadPartialFailed'
                : 'hosts.iconLibrary.batchUploadFailed',
              count: failedCount,
            })
      }
    } finally {
      operationInFlightRef.current = false
      setOperation(null)
    }
  }

  const rename = async () => {
    if (
      !editingId
      || !normalizedEditingName
      || unicodeLength(normalizedEditingName) > MAX_DISPLAY_NAME_LENGTH
      || busy
      || operationInFlightRef.current
    ) return
    operationInFlightRef.current = true
    setOperation(`rename:${editingId}`)
    setError(null)
    try {
      const renamed = await onRename(editingId, normalizedEditingName)
      setOrderedIcons((current) => upsertHostIcon(current, renamed))
      setEditingId(null)
      setEditingName('')
    } catch {
      setError({ key: 'hosts.iconLibrary.renameFailed' })
    } finally {
      operationInFlightRef.current = false
      setOperation(null)
    }
  }

  const persistOrder = async (nextIcons: HostIcon[]) => {
    if (busy || operationInFlightRef.current || sameIconOrder(orderedIcons, nextIcons)) return
    operationInFlightRef.current = true
    const previousIcons = orderedIcons
    const normalizedIcons = nextIcons.map((icon, index) => ({ ...icon, sort_order: index }))
    setOrderedIcons(normalizedIcons)
    setOperation('reorder')
    setError(null)
    try {
      const savedIcons = await onReorder(normalizedIcons.map((icon) => ({
        id: icon.id,
        sort_order: icon.sort_order,
      })))
      setOrderedIcons(sortHostIcons(savedIcons))
    } catch {
      setOrderedIcons(previousIcons)
      setError({ key: 'hosts.iconLibrary.reorderFailed' })
    } finally {
      operationInFlightRef.current = false
      setOperation(null)
    }
  }

  const remove = async (iconId: string) => {
    if (isProtected(iconId, hostCounts, protectedIds) || busy || operationInFlightRef.current) return
    operationInFlightRef.current = true
    setOperation(`delete:${iconId}`)
    setError(null)
    try {
      await onDelete(iconId)
      setOrderedIcons((current) => current.filter((icon) => icon.id !== iconId))
      if (editingId === iconId) {
        setEditingId(null)
        setEditingName('')
      }
    } catch {
      setError({ key: 'hosts.iconLibrary.deleteFailed' })
    } finally {
      operationInFlightRef.current = false
      setOperation(null)
    }
  }

  const moveIcon = (iconId: string, offset: -1 | 1) => {
    const index = orderedIcons.findIndex((icon) => icon.id === iconId)
    const targetIndex = index + offset
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedIcons.length) return
    const nextIcons = [...orderedIcons]
    const [icon] = nextIcons.splice(index, 1)
    nextIcons.splice(targetIndex, 0, icon)
    void persistOrder(nextIcons)
  }

  const startDrag = (event: DragEvent<HTMLElement>, iconId: string) => {
    if (busy || editingId) {
      event.preventDefault()
      return
    }
    setDraggingId(iconId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', iconId)
    const row = event.currentTarget.closest('[data-host-icon-manager-row]')
    if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 24, 24)
  }

  const updateDropTarget = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    const sourceId = draggingId || event.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId || busy) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const edge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    setDropTarget((current) => (
      current?.id === targetId && current.edge === edge ? current : { id: targetId, edge }
    ))
  }

  const finishDrop = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault()
    const sourceId = draggingId || event.dataTransfer.getData('text/plain')
    const bounds = event.currentTarget.getBoundingClientRect()
    const target: DropTarget = {
      id: targetId,
      edge: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after',
    }
    setDraggingId(null)
    setDropTarget(null)
    if (!sourceId || sourceId === targetId) return
    void persistOrder(placeIcon(orderedIcons, sourceId, target))
  }

  const handleOrderKey = (event: KeyboardEvent<HTMLElement>, iconId: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    moveIcon(iconId, event.key === 'ArrowUp' ? -1 : 1)
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length > 0) void upload(files)
  }

  return (
    <Modal
      centered
      width={720}
      open={open}
      footer={null}
      closable={!busy}
      keyboard={!busy}
      mask={{ closable: !busy }}
      title={(
        <span className={styles['host-icon-manager-title']}>
          <span className={styles['host-icon-manager-title-icon']}>
            <ImageIcon size={17} aria-hidden="true" />
          </span>
          <span>{t('hosts.iconLibrary.manage')}</span>
          <small>{orderedIcons.length}</small>
        </span>
      )}
      rootClassName={styles['host-icon-manager-modal']}
      onCancel={() => {
        if (!busy) onClose()
      }}
    >
      <section className={styles['host-icon-manager-toolbar']}>
        <div>
          <strong>{t('hosts.iconLibrary.title')}</strong>
          <small>{t('hosts.icon.formats')}</small>
        </div>
        <input
          ref={fileInputRef}
          className={styles['host-icon-manager-file-input']}
          type="file"
          multiple
          accept={HOST_ICON_ACCEPT}
          aria-label={t('hosts.iconLibrary.add')}
          tabIndex={-1}
          onChange={handleFileChange}
        />
        <Button
          type="primary"
          icon={<ImagePlus size={15} />}
          aria-label={t('hosts.iconLibrary.add')}
          loading={operation === 'upload'}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {t('hosts.iconLibrary.add')}
        </Button>
      </section>

      {error ? (
        <Alert
          className={styles['host-icon-manager-alert']}
          type="error"
          showIcon
          closable
          message={t(error.key, error.count === undefined ? undefined : { count: error.count })}
          onClose={() => setError(null)}
        />
      ) : null}

      <div className={styles['host-icon-manager-list-shell']}>
        {orderedIcons.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('hosts.iconLibrary.empty')} />
        ) : (
          <div
            className={styles['host-icon-manager-list']}
            role="list"
            aria-label={t('hosts.iconLibrary.list')}
          >
            {orderedIcons.map((icon, index) => {
              const editing = editingId === icon.id
              const hostCount = hostCounts.get(icon.id) ?? 0
              const draftProtected = protectedIds.has(icon.id)
              const deleteProtected = hostCount > 0 || draftProtected
              const deleteReason = hostCount > 0
                ? t('hosts.iconLibrary.inUse', { count: hostCount })
                : draftProtected
                  ? t('hosts.iconLibrary.draftInUse')
                  : t('app.delete')
              const dropEdge = dropTarget?.id === icon.id ? dropTarget.edge : null
              return (
                <div
                  key={icon.id}
                  role="listitem"
                  className={[
                    styles['host-icon-manager-row'],
                    editing ? styles['is-editing'] : '',
                    draggingId === icon.id ? styles['is-dragging'] : '',
                    dropEdge ? styles[`is-drop-${dropEdge}`] : '',
                  ].filter(Boolean).join(' ')}
                  data-host-icon-manager-row="true"
                  data-icon-id={icon.id}
                  data-protected={deleteProtected ? 'true' : 'false'}
                  onDragOver={(event) => updateDropTarget(event, icon.id)}
                  onDrop={(event) => finishDrop(event, icon.id)}
                >
                  <Tooltip title={t('app.reorder')} rootClassName={uiStyles.tooltip}>
                    <Button
                      type="text"
                      className={styles['host-icon-manager-drag-handle']}
                      aria-label={t('app.reorder')}
                      disabled={busy || Boolean(editingId)}
                      draggable={!busy && !editingId}
                      icon={<GripVertical size={16} />}
                      onDragStart={(event) => startDrag(event, icon.id)}
                      onDragEnd={() => {
                        setDraggingId(null)
                        setDropTarget(null)
                      }}
                      onKeyDown={(event) => handleOrderKey(event, icon.id)}
                    />
                  </Tooltip>

                  <AntImage
                    src={getIconUrl(icon.id)}
                    alt={icon.display_name}
                    loading="lazy"
                    classNames={{
                      root: styles['host-icon-manager-preview'],
                      image: styles['host-icon-manager-preview-image'],
                    }}
                    preview={{ mask: t('hosts.iconLibrary.preview') }}
                  />

                  <span className={styles['host-icon-manager-copy']}>
                    {editing ? (
                      <Input
                        autoFocus
                        id={`host-icon-manager-edit-${icon.id}`}
                        name={`host-icon-manager-edit-${icon.id}`}
                        value={editingName}
                        disabled={busy}
                        aria-label={t('hosts.iconLibrary.name')}
                        onChange={(event) => setEditingName(limitUnicode(event.target.value, MAX_DISPLAY_NAME_LENGTH))}
                        onPressEnter={() => void rename()}
                      />
                    ) : (
                      <Tooltip title={icon.display_name} rootClassName={uiStyles.tooltip}>
                        <strong>{icon.display_name}</strong>
                      </Tooltip>
                    )}
                    <Tooltip title={icon.file_name} rootClassName={uiStyles.tooltip}>
                      <small>{icon.file_name}</small>
                    </Tooltip>
                  </span>

                  <span className={styles['host-icon-manager-meta']}>
                    <small>{formatBytes(icon.size_bytes)}</small>
                    <small>{t('hosts.iconLibrary.hostCount', { count: hostCount })}</small>
                  </span>

                  <div className={styles['host-icon-manager-actions']}>
                    {editing ? (
                      <span className={styles['host-icon-manager-edit-actions']}>
                        <Tooltip title={t('app.save')} rootClassName={uiStyles.tooltip}>
                          <Button
                            type="text"
                            aria-label={t('app.save')}
                            loading={operation === `rename:${icon.id}`}
                            disabled={!normalizedEditingName || busy}
                            icon={<Check size={15} />}
                            onClick={() => void rename()}
                          />
                        </Tooltip>
                        <Tooltip title={t('app.cancel')} rootClassName={uiStyles.tooltip}>
                          <Button
                            type="text"
                            aria-label={t('app.cancel')}
                            disabled={busy}
                            icon={<X size={15} />}
                            onClick={() => {
                              setEditingId(null)
                              setEditingName('')
                            }}
                          />
                        </Tooltip>
                      </span>
                    ) : (
                      <>
                        <span className={styles['host-icon-manager-order-actions']}>
                          <Tooltip title={t('app.moveUp')} rootClassName={uiStyles.tooltip}>
                            <Button
                              type="text"
                              aria-label={t('app.moveUp')}
                              disabled={busy || index === 0}
                              icon={<ChevronUp size={15} />}
                              onClick={() => moveIcon(icon.id, -1)}
                            />
                          </Tooltip>
                          <Tooltip title={t('app.moveDown')} rootClassName={uiStyles.tooltip}>
                            <Button
                              type="text"
                              aria-label={t('app.moveDown')}
                              disabled={busy || index === orderedIcons.length - 1}
                              icon={<ChevronDown size={15} />}
                              onClick={() => moveIcon(icon.id, 1)}
                            />
                          </Tooltip>
                        </span>
                        <Tooltip title={t('app.edit')} rootClassName={uiStyles.tooltip}>
                          <Button
                            type="text"
                            aria-label={t('app.edit')}
                            disabled={busy}
                            icon={<Pencil size={15} />}
                            onClick={() => {
                              setEditingId(icon.id)
                              setEditingName(icon.display_name)
                              setError(null)
                            }}
                          />
                        </Tooltip>
                        <Tooltip title={deleteReason} rootClassName={uiStyles.tooltip}>
                          <span>
                            <Popconfirm
                              {...termousPopconfirmProps}
                              title={t('hosts.iconLibrary.deleteTitle')}
                              description={t('hosts.iconLibrary.deleteDescription')}
                              okText={t('app.delete')}
                              cancelText={t('app.cancel')}
                              okButtonProps={{ danger: true }}
                              disabled={deleteProtected || busy}
                              onConfirm={() => void remove(icon.id)}
                            >
                              <Button
                                type="text"
                                danger
                                aria-label={deleteReason}
                                loading={operation === `delete:${icon.id}`}
                                disabled={deleteProtected || busy}
                                icon={<Trash2 size={15} />}
                              />
                            </Popconfirm>
                          </span>
                        </Tooltip>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}

function validateHostIconFile(file: File) {
  if (file.size <= 0) return 'hosts.icon.emptyFile'
  if (file.size > MAX_HOST_ICON_BYTES) return 'hosts.icon.tooLarge'
  const fileName = file.name.toLocaleLowerCase()
  if (!SUPPORTED_ICON_EXTENSIONS.some((extension) => fileName.endsWith(extension))) {
    return 'hosts.icon.invalidType'
  }
  return ''
}

function unicodeLength(value: string) {
  return Array.from(value).length
}

function limitUnicode(value: string, maximum: number) {
  return Array.from(value).slice(0, maximum).join('')
}

function sortHostIcons(icons: HostIcon[]) {
  return [...icons].sort((left, right) => (
    left.sort_order - right.sort_order
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id)
  ))
}

function upsertHostIcon(icons: HostIcon[], icon: HostIcon) {
  const existing = icons.some((item) => item.id === icon.id)
  return sortHostIcons(existing
    ? icons.map((item) => (item.id === icon.id ? icon : item))
    : [...icons, icon])
}

function sameIconOrder(left: HostIcon[], right: HostIcon[]) {
  return left.length === right.length && left.every((icon, index) => icon.id === right[index]?.id)
}

function placeIcon(icons: HostIcon[], sourceId: string, target: DropTarget) {
  const sourceIndex = icons.findIndex((icon) => icon.id === sourceId)
  if (sourceIndex < 0 || sourceId === target.id) return icons
  const nextIcons = [...icons]
  const [source] = nextIcons.splice(sourceIndex, 1)
  const targetIndex = nextIcons.findIndex((icon) => icon.id === target.id)
  if (targetIndex < 0) return icons
  nextIcons.splice(target.edge === 'before' ? targetIndex : targetIndex + 1, 0, source)
  return nextIcons
}

function isProtected(
  iconId: string,
  hostCounts: Map<string, number>,
  protectedIds: Set<string>,
) {
  return (hostCounts.get(iconId) ?? 0) > 0 || protectedIds.has(iconId)
}
