import { Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { CirclePlay, FileText, GripVertical, ListRestart, MoreHorizontal, Pencil, Play, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentQueueState, AgentQueuedTurn, AgentQueuedTurnMovePlacement } from '#entities/agent'
import { ContextActionMenu, contextActionMenuPopupClassName } from '#shared/ui'
import {
  applyOptimisticQueuedTurnOrder,
  moveQueuedTurnIDs,
  stepQueuedTurn,
  type QueuedTurnMove,
} from '../model/queuedTurnOrder.ts'
import styles from './AgentQueuedTurnList.module.scss'

interface QueuedTurnDropTarget {
  turnId: string
  placement: AgentQueuedTurnMovePlacement
}

export function AgentQueuedTurnList({
  turns,
  queueState,
  disabled,
  canExecute,
  editingTurnId,
  onEdit,
  onExecute,
  onDelete,
  onMove,
  onResume,
}: {
  turns: AgentQueuedTurn[]
  queueState?: AgentQueueState
  disabled: boolean
  canExecute: boolean
  editingTurnId?: string
  onEdit: (turnId: string) => void
  onExecute: (turnId: string) => void
  onDelete: (turnId: string) => void
  onMove: (
    turnId: string,
    targetTurnId: string,
    placement: AgentQueuedTurnMovePlacement,
  ) => Promise<boolean>
  onResume: () => void
}) {
  const { t } = useTranslation()
  const [draggingTurnId, setDraggingTurnId] = useState<string>()
  const draggingTurnIdRef = useRef<string | undefined>(undefined)
  const [dropTarget, setDropTarget] = useState<QueuedTurnDropTarget>()
  const [optimisticOrder, setOptimisticOrder] = useState<string[]>()
  const [reordering, setReordering] = useState(false)
  const queued = useMemo(() => turns.filter(({ state }) => state === 'queued'), [turns])
  const displayedTurns = useMemo(
    () => applyOptimisticQueuedTurnOrder(queued, optimisticOrder),
    [optimisticOrder, queued],
  )
  const reorderDisabled = disabled
    || Boolean(editingTurnId)
    || queued.some(({ interrupt_target_run_id }) => Boolean(interrupt_target_run_id))
    || queued.length < 2
    || reordering
  if (queued.length === 0) return null
  const resetDrag = () => {
    draggingTurnIdRef.current = undefined
    setDraggingTurnId(undefined)
    setDropTarget(undefined)
  }
  const placementAtPointer = (event: DragEvent<HTMLElement>): AgentQueuedTurnMovePlacement => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
  }
  const executeMove = async (move: QueuedTurnMove | undefined) => {
    resetDrag()
    if (!move || reorderDisabled) return
    setOptimisticOrder(move.orderedIds)
    setReordering(true)
    try {
      await onMove(move.sourceId, move.targetId, move.placement)
    } finally {
      setOptimisticOrder(undefined)
      setReordering(false)
    }
  }
  const startDrag = (event: DragEvent<HTMLElement>, turnId: string) => {
    if (reorderDisabled) {
      event.preventDefault()
      return
    }
    draggingTurnIdRef.current = turnId
    setDraggingTurnId(turnId)
    setDropTarget(undefined)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', turnId)
    const row = event.currentTarget.closest('[data-agent-queued-turn-id]')
    if (row instanceof HTMLElement) event.dataTransfer.setDragImage(row, 20, 18)
  }
  const updateDropTarget = (event: DragEvent<HTMLDivElement>, targetTurnId: string) => {
    const sourceId = draggingTurnIdRef.current || event.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === targetTurnId || reorderDisabled) {
      setDropTarget(undefined)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const placement = placementAtPointer(event)
    setDropTarget((current) => (
      current?.turnId === targetTurnId && current.placement === placement
        ? current
        : { turnId: targetTurnId, placement }
    ))
  }
  const finishDrop = (event: DragEvent<HTMLDivElement>, targetTurnId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const sourceId = draggingTurnIdRef.current || event.dataTransfer.getData('text/plain')
    const move = moveQueuedTurnIDs(
      displayedTurns.map(({ id }) => id),
      sourceId,
      targetTurnId,
      placementAtPointer(event),
    )
    void executeMove(move)
  }
  const moveByKey = (event: KeyboardEvent<HTMLElement>, turnId: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()
    if (reorderDisabled) return
    void executeMove(stepQueuedTurn(
      displayedTurns.map(({ id }) => id),
      turnId,
      event.key === 'ArrowUp' ? -1 : 1,
    ))
  }
  return (
    <section className={styles.queue} aria-label={t('agent.queue.title')}>
      <header>
        <span><ListRestart size={13} aria-hidden="true" />{t('agent.queue.pending', { count: queued.length })}</span>
        {queueState?.state === 'paused' ? (
          <Button type="text" size="small" disabled={disabled} icon={<Play size={13} aria-hidden="true" />} onClick={onResume}>
            {t('agent.queue.resume')}
          </Button>
        ) : <small>{t('agent.queue.running')}</small>}
      </header>
      <div className={styles.list} role="list" aria-busy={reordering || undefined}>
        {displayedTurns.map((turn, index) => (
          <AgentQueuedTurnItem
            key={turn.id}
            turn={turn}
            position={index + 1}
            disabled={disabled || Boolean(editingTurnId)}
            reorderDisabled={reorderDisabled}
            canExecute={canExecute}
            editing={turn.id === editingTurnId}
            dragging={turn.id === draggingTurnId}
            dropPlacement={dropTarget?.turnId === turn.id ? dropTarget.placement : undefined}
            onEdit={() => onEdit(turn.id)}
            onExecute={() => onExecute(turn.id)}
            onDelete={() => onDelete(turn.id)}
            onDragStart={(event) => startDrag(event, turn.id)}
            onDragOver={(event) => updateDropTarget(event, turn.id)}
            onDragEnd={resetDrag}
            onDrop={(event) => finishDrop(event, turn.id)}
            onMoveByKey={(event) => moveByKey(event, turn.id)}
          />
        ))}
      </div>
    </section>
  )
}

function AgentQueuedTurnItem({
  turn,
  position,
  disabled,
  reorderDisabled,
  canExecute,
  editing,
  dragging,
  dropPlacement,
  onEdit,
  onExecute,
  onDelete,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onMoveByKey,
}: {
  turn: AgentQueuedTurn
  position: number
  disabled: boolean
  reorderDisabled: boolean
  canExecute: boolean
  editing: boolean
  dragging: boolean
  dropPlacement?: AgentQueuedTurnMovePlacement
  onEdit: () => void
  onExecute: () => void
  onDelete: () => void
  onDragStart: (event: DragEvent<HTMLElement>) => void
  onDragOver: (event: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  onMoveByKey: (event: KeyboardEvent<HTMLElement>) => void
}) {
  const { t } = useTranslation()
  const items: MenuProps['items'] = [
    { key: 'edit', icon: <Pencil size={14} />, label: t('agent.queue.editMessage') },
  ]
  const run = (key: string) => {
    if (key === 'edit') onEdit()
  }
  const row = (
    <div
      className={styles.item}
      role="listitem"
      data-agent-queued-turn-id={turn.id}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      data-drop-placement={dropPlacement}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Tooltip title={t(reorderDisabled ? 'agent.queue.reorderUnavailable' : 'app.reorder')} mouseLeaveDelay={0}>
        <Button
          type="text"
          size="small"
          className={styles.handle}
          disabled={reorderDisabled}
          draggable={!reorderDisabled}
          aria-label={t('agent.queue.reorderMessage', { position })}
          aria-keyshortcuts="ArrowUp ArrowDown"
          icon={<GripVertical size={14} aria-hidden="true" />}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onKeyDown={onMoveByKey}
        />
      </Tooltip>
      <span className={styles.copy} title={turn.prompt}>{turn.prompt}</span>
      {turn.attachments.length > 0 ? (
        <span className={styles.attachments} aria-label={t('agent.queue.attachmentCount', { count: turn.attachments.length })}>
          <FileText size={12} aria-hidden="true" />{turn.attachments.length}
        </span>
      ) : null}
      <Tooltip title={t(canExecute ? 'agent.queue.executeNow' : 'agent.queue.executeUnavailable')}>
        <Button type="text" size="small" className={styles.execute} disabled={disabled || !canExecute} aria-label={t('agent.queue.executeNow')} icon={<CirclePlay size={14} aria-hidden="true" />} onClick={onExecute}>
          <span className={styles['execute-label']}>{t('agent.queue.executeNow')}</span>
        </Button>
      </Tooltip>
      <Tooltip title={t('app.delete')}>
        <Button type="text" size="small" className={styles.action} danger disabled={disabled} aria-label={t('app.delete')} icon={<Trash2 size={14} aria-hidden="true" />} onClick={onDelete} />
      </Tooltip>
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        classNames={{ root: contextActionMenuPopupClassName }}
        menu={{ items, onClick: ({ key, domEvent }) => { domEvent.stopPropagation(); run(key) } }}
        disabled={disabled}
      >
        <Tooltip title={t('agent.queue.actions')}>
          <Button type="text" size="small" className={styles.more} aria-label={t('agent.queue.actions')} icon={<MoreHorizontal size={14} aria-hidden="true" />} />
        </Tooltip>
      </Dropdown>
    </div>
  )
  return (
    <ContextActionMenu items={items} disabled={disabled} onClick={({ key }) => run(key)}>
      {row}
    </ContextActionMenu>
  )
}
