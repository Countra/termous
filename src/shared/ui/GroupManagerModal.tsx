import { Button, Empty, Input, Modal, Popconfirm, Tooltip } from 'antd'
import { Check, ChevronDown, ChevronUp, Folder, FolderCog, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import type { GroupReorderItem } from '#shared/model'
import styles from './GroupManagerModal.module.scss'

export interface GroupManagerItem {
  id: string
  name: string
  sort_order: number
}

interface GroupManagerModalProps<T extends GroupManagerItem> {
  open: boolean
  groups: T[]
  actionBusy: boolean
  title: string
  addLabel: string
  namePlaceholder: string
  emptyLabel: string
  deleteTitle: string
  deleteDescription: string
  saveLabel: string
  cancelLabel: string
  editLabel: string
  deleteLabel: string
  reorderLabel: string
  moveUpLabel: string
  moveDownLabel: string
  itemCounts: Record<string, number>
  itemCountLabel: (count: number) => string
  onClose: () => void
  onCreate: (name: string) => Promise<T | undefined>
  onRename: (id: string, name: string) => Promise<T | undefined>
  onDelete: (id: string) => Promise<void>
  onReorder: (items: GroupReorderItem[]) => Promise<T[] | undefined>
}

type DropTarget = {
  id: string
  edge: 'before' | 'after'
}

export function GroupManagerModal<T extends GroupManagerItem>({
  open,
  groups,
  actionBusy,
  title,
  addLabel,
  namePlaceholder,
  emptyLabel,
  deleteTitle,
  deleteDescription,
  saveLabel,
  cancelLabel,
  editLabel,
  deleteLabel,
  reorderLabel,
  moveUpLabel,
  moveDownLabel,
  itemCounts,
  itemCountLabel,
  onClose,
  onCreate,
  onRename,
  onDelete,
  onReorder,
}: GroupManagerModalProps<T>) {
  const [name, setName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [orderedGroups, setOrderedGroups] = useState<T[]>(groups)
  const [reorderBusy, setReorderBusy] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const operationInFlightRef = useRef(false)
  const normalizedName = normalizeGroupName(name)
  const normalizedEditingName = normalizeGroupName(editingName)
  const busy = actionBusy || reorderBusy

  useEffect(() => {
    if (!open) {
      setName('')
      setEditingId(null)
      setEditingName('')
      setDraggingId(null)
      setDropTarget(null)
      return
    }
    if (!reorderBusy) setOrderedGroups(groups)
  }, [groups, open, reorderBusy])

  const create = async () => {
    if (!normalizedName || busy || operationInFlightRef.current) return
    operationInFlightRef.current = true
    try {
      const group = await onCreate(normalizedName)
      if (group) setName('')
    } catch {
      return
    } finally {
      operationInFlightRef.current = false
    }
  }

  const rename = async () => {
    if (!editingId || !normalizedEditingName || busy || operationInFlightRef.current) return
    operationInFlightRef.current = true
    try {
      const group = await onRename(editingId, normalizedEditingName)
      if (group) {
        setEditingId(null)
        setEditingName('')
      }
    } catch {
      return
    } finally {
      operationInFlightRef.current = false
    }
  }

  const persistOrder = async (nextGroups: T[]) => {
    if (busy || operationInFlightRef.current || sameGroupOrder(orderedGroups, nextGroups)) return
    operationInFlightRef.current = true
    const previousGroups = orderedGroups
    const normalizedGroups = nextGroups.map((group, index) => ({ ...group, sort_order: index })) as T[]
    setOrderedGroups(normalizedGroups)
    setReorderBusy(true)
    try {
      const savedGroups = await onReorder(normalizedGroups.map((group) => ({
        id: group.id,
        sort_order: group.sort_order,
      })))
      setOrderedGroups(savedGroups ?? previousGroups)
    } catch {
      setOrderedGroups(previousGroups)
    } finally {
      setReorderBusy(false)
      operationInFlightRef.current = false
    }
  }

  const remove = async (groupId: string) => {
    if (busy || operationInFlightRef.current) return
    operationInFlightRef.current = true
    try {
      await onDelete(groupId)
    } finally {
      operationInFlightRef.current = false
    }
  }

  const moveGroup = (groupId: string, offset: -1 | 1) => {
    const index = orderedGroups.findIndex((group) => group.id === groupId)
    const targetIndex = index + offset
    if (index < 0 || targetIndex < 0 || targetIndex >= orderedGroups.length) return
    const nextGroups = [...orderedGroups]
    const [group] = nextGroups.splice(index, 1)
    nextGroups.splice(targetIndex, 0, group)
    void persistOrder(nextGroups)
  }

  const startDrag = (event: DragEvent<HTMLElement>, groupId: string) => {
    if (busy || editingId) {
      event.preventDefault()
      return
    }
    setDraggingId(groupId)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', groupId)
    const row = event.currentTarget.closest('[data-group-manager-row]')
    if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 24, 24)
  }

  const updateDropTarget = (event: DragEvent<HTMLDivElement>, targetId: string) => {
    const sourceId = draggingId || event.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetId || busy) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const edge = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
    setDropTarget((current) => current?.id === targetId && current.edge === edge ? current : { id: targetId, edge })
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
    void persistOrder(placeGroup(orderedGroups, sourceId, target))
  }

  const handleOrderKey = (event: KeyboardEvent<HTMLElement>, groupId: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    moveGroup(groupId, event.key === 'ArrowUp' ? -1 : 1)
  }

  return (
    <Modal
      centered
      width={540}
      open={open}
      footer={null}
      title={(
        <span className={`group-manager-title ${styles['group-manager-title']}`}>
          <span className={`group-manager-title-icon ${styles['group-manager-title-icon']}`}><FolderCog size={17} aria-hidden="true" /></span>
          <span>{title}</span>
          <small>{orderedGroups.length}</small>
        </span>
      )}
      rootClassName={`group-manager-modal ${styles['group-manager-modal']}`}
      onCancel={onClose}
    >
      <div className={`group-manager-create-row ${styles['group-manager-create-row']}`}>
        <Input
          id="group-manager-create-name"
          name="group-manager-create-name"
          value={name}
          maxLength={64}
          placeholder={namePlaceholder}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onPressEnter={() => void create()}
        />
        <Button
          type="primary"
          disabled={!normalizedName || busy}
          icon={<Plus size={15} />}
          onClick={() => void create()}
        >
          {addLabel}
        </Button>
      </div>
      <div className={`group-manager-list-shell ${styles['group-manager-list-shell']}`}>
        {orderedGroups.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyLabel} />
        ) : (
          <div className={`group-manager-list ${styles['group-manager-list']}`} role="list">
            {orderedGroups.map((group, index) => {
              const editing = editingId === group.id
              const dropEdge = dropTarget?.id === group.id ? dropTarget.edge : null
              return (
                <div
                  key={group.id}
                  role="listitem"
                  className={[
                    'group-manager-row',
                    styles['group-manager-row'],
                    editing ? 'is-editing' : '',
                    editing ? styles['is-editing'] : '',
                    draggingId === group.id ? 'is-dragging' : '',
                    draggingId === group.id ? styles['is-dragging'] : '',
                    dropEdge ? `is-drop-${dropEdge}` : '',
                    dropEdge ? styles[`is-drop-${dropEdge}`] : '',
                  ].filter(Boolean).join(' ')}
                  data-group-manager-row="true"
                  data-editing={editing ? 'true' : undefined}
                  onDragOver={(event) => updateDropTarget(event, group.id)}
                  onDrop={(event) => finishDrop(event, group.id)}
                >
                  <Tooltip title={reorderLabel}>
                    <Button
                      type="text"
                      className={`group-manager-drag-handle ${styles['group-manager-drag-handle']}`}
                      aria-label={reorderLabel}
                      disabled={busy || editing}
                      draggable={!busy && !editing}
                      icon={<GripVertical size={16} />}
                      onDragStart={(event) => startDrag(event, group.id)}
                      onDragEnd={() => { setDraggingId(null); setDropTarget(null) }}
                      onKeyDown={(event) => handleOrderKey(event, group.id)}
                    />
                  </Tooltip>
                  <span className={`group-manager-row-icon ${styles['group-manager-row-icon']}`}><Folder size={16} /></span>
                  <span className={`group-manager-row-copy ${styles['group-manager-row-copy']}`}>
                    {editing ? (
                      <Input
                        autoFocus
                        id={`group-manager-edit-${group.id}`}
                        name={`group-manager-edit-${group.id}`}
                        value={editingName}
                        maxLength={64}
                        disabled={busy}
                        onChange={(event) => setEditingName(event.target.value)}
                        onPressEnter={() => void rename()}
                      />
                    ) : (
                      <Tooltip title={group.name}><strong>{group.name}</strong></Tooltip>
                    )}
                    {!editing ? <small>{itemCountLabel(itemCounts[group.id] ?? 0)}</small> : null}
                  </span>
                  <div className={`group-manager-row-actions ${styles['group-manager-row-actions']}`}>
                    {editing ? (
                      <>
                        <Tooltip title={saveLabel}>
                          <Button
                            type="text"
                            aria-label={saveLabel}
                            disabled={!normalizedEditingName || busy}
                            icon={<Check size={15} />}
                            onClick={() => void rename()}
                          />
                        </Tooltip>
                        <Tooltip title={cancelLabel}>
                          <Button
                            type="text"
                            aria-label={cancelLabel}
                            disabled={busy}
                            icon={<X size={15} />}
                            onClick={() => { setEditingId(null); setEditingName('') }}
                          />
                        </Tooltip>
                      </>
                    ) : (
                      <>
                        <span className={`group-manager-order-actions ${styles['group-manager-order-actions']}`}>
                          <Tooltip title={moveUpLabel}>
                            <Button
                              type="text"
                              aria-label={moveUpLabel}
                              disabled={busy || index === 0}
                              icon={<ChevronUp size={15} />}
                              onClick={() => moveGroup(group.id, -1)}
                            />
                          </Tooltip>
                          <Tooltip title={moveDownLabel}>
                            <Button
                              type="text"
                              aria-label={moveDownLabel}
                              disabled={busy || index === orderedGroups.length - 1}
                              icon={<ChevronDown size={15} />}
                              onClick={() => moveGroup(group.id, 1)}
                            />
                          </Tooltip>
                        </span>
                        <Tooltip title={editLabel}>
                          <Button
                            type="text"
                            aria-label={editLabel}
                            disabled={busy}
                            icon={<Pencil size={15} />}
                            onClick={() => { setEditingId(group.id); setEditingName(group.name) }}
                          />
                        </Tooltip>
                        <Popconfirm
                          title={deleteTitle}
                          description={deleteDescription}
                          okText={deleteLabel}
                          cancelText={cancelLabel}
                          okButtonProps={{ danger: true }}
                          onConfirm={() => remove(group.id)}
                        >
                          <Tooltip title={deleteLabel}>
                            <Button
                              type="text"
                              danger
                              aria-label={deleteLabel}
                              disabled={busy}
                              icon={<Trash2 size={15} />}
                            />
                          </Tooltip>
                        </Popconfirm>
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

function normalizeGroupName(value: string) {
  return value.trim().replace(/\s+/g, ' ')
}

function sameGroupOrder<T extends GroupManagerItem>(left: T[], right: T[]) {
  return left.length === right.length && left.every((group, index) => group.id === right[index]?.id)
}

function placeGroup<T extends GroupManagerItem>(groups: T[], sourceId: string, target: DropTarget) {
  const sourceIndex = groups.findIndex((group) => group.id === sourceId)
  if (sourceIndex < 0 || sourceId === target.id) return groups
  const nextGroups = [...groups]
  const [source] = nextGroups.splice(sourceIndex, 1)
  const targetIndex = nextGroups.findIndex((group) => group.id === target.id)
  if (targetIndex < 0) return groups
  nextGroups.splice(target.edge === 'before' ? targetIndex : targetIndex + 1, 0, source)
  return nextGroups
}
