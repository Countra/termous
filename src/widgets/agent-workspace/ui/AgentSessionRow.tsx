import { Button, Dropdown, Tooltip, type MenuProps } from 'antd'
import { Archive, ArrowDown, ArrowUp, FolderInput, GripVertical, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { useRef, type HTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSessionGroup } from '#entities/agent'
import { ContextActionMenu, contextActionMenuPopupClassName } from '#shared/ui'
import type { SessionSidebarExecute, SessionSidebarPlacement } from '../model/sessionSidebar.ts'
import type { AgentWorkspaceSession } from '../model/types.ts'
import { AgentSessionNameEditor } from './AgentSessionNameEditor.tsx'
import styles from './AgentSessionSidebar.module.scss'

export type SessionSidebarDragProps = Pick<HTMLAttributes<HTMLElement>, 'draggable' | 'onDragStart' | 'onDragOver' | 'onDragEnd' | 'onDrop'>
export type SessionSidebarPointerProps = Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onLostPointerCapture' | 'onClick' | 'onContextMenu'>

export function AgentSessionRow({ session, groups, selected, disabled, busy, editing, pendingIds, queued, showGroup, search,
  before, after, dropPlacement, dragging, dragProps, pointerProps, execute, onSelect, onArchive, onDelete, onRename,
  onPin, onMoveToGroup, onMovePin, onMoveSession, onEditingChange }: {
  session: AgentWorkspaceSession
  groups: AgentSessionGroup[]
  selected: boolean
  disabled: boolean
  busy: boolean
  editing: boolean
  pendingIds: ReadonlySet<string>
  queued: boolean
  showGroup: boolean
  search: boolean
  before?: string
  after?: string
  dropPlacement?: SessionSidebarPlacement
  dragging?: boolean
  dragProps?: SessionSidebarDragProps
  pointerProps?: SessionSidebarPointerProps
  execute: SessionSidebarExecute
  onSelect: (id: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onRename?: (id: string, title: string) => Promise<void>
  onPin?: (id: string, pinned: boolean) => Promise<void>
  onMoveToGroup?: (id: string, groupId: string | undefined, unpin?: boolean) => Promise<void>
  onMovePin?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
  onMoveSession?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
  onEditingChange: (id: string, editing: boolean) => void
}) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const unavailable = disabled || busy
  const active = ['queued', 'starting', 'running', 'waiting_approval', 'stopping'].includes(session.run_status)
  const group = groups.find(({ id }) => id === session.group_id)
  const moveSession = onMoveSession ?? (session.pinned ? onMovePin : undefined)
  const orderKey = onMoveSession ? 'session-order' : 'pin-order'
  const finishEdit = () => {
    const restoreFocus = document.activeElement === document.body || rowRef.current?.contains(document.activeElement)
    onEditingChange(session.id, false)
    if (restoreFocus) window.requestAnimationFrame(() => buttonRef.current?.focus())
  }
  const items: MenuProps['items'] = [
    ...(onRename ? [{ key: 'rename', label: t('agent.sessions.rename'), icon: <Pencil size={14} />, disabled: unavailable }] : []),
    ...(onPin ? [{ key: 'pin', label: t(session.pinned ? 'agent.sessions.unpin' : 'agent.sessions.pin'), icon: session.pinned ? <PinOff size={14} /> : <Pin size={14} />, disabled: unavailable || pendingIds.has('pin-order') }] : []),
    ...(onMoveToGroup ? [{ key: 'move', label: t('agent.sessions.moveToGroup'), icon: <FolderInput size={14} />, disabled: unavailable, children: [
      { key: 'group:', label: t('agent.sessions.ungrouped'), disabled: !session.group_id },
      ...groups.map(({ id, name }) => ({ key: `group:${id}`, label: name, disabled: session.group_id === id || pendingIds.has(id) })),
    ] }] : []),
    ...(moveSession ? [
      { key: 'up', label: t('agent.sessions.moveUp'), icon: <ArrowUp size={14} />, disabled: unavailable || search || !before || pendingIds.has(orderKey) || Boolean(before && pendingIds.has(before)) },
      { key: 'down', label: t('agent.sessions.moveDown'), icon: <ArrowDown size={14} />, disabled: unavailable || search || !after || pendingIds.has(orderKey) || Boolean(after && pendingIds.has(after)) },
    ] : []),
    { type: 'divider' },
    { key: 'archive', icon: <Archive size={14} />, label: t('agent.sessions.archive'), disabled: unavailable || active || queued },
    { key: 'delete', icon: <Trash2 size={14} />, label: t('app.delete'), danger: true, disabled: unavailable || active },
  ]
  const onAction: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (unavailable) return
    if (key === 'rename') onEditingChange(session.id, true)
    if (key === 'pin' && onPin) void execute(session.id, () => onPin(session.id, !session.pinned))
    if (key.startsWith('group:') && onMoveToGroup) void execute(session.id, () => onMoveToGroup(session.id, key.slice(6) || undefined))
    if ((key === 'up' || key === 'down') && moveSession && !search) {
      const target = key === 'up' ? before : after
      if (target) void execute(orderKey, () => moveSession(session.id, target, key === 'up' ? 'before' : 'after'))
    }
    if (key === 'archive' && !active && !queued) onArchive(session.id)
    if (key === 'delete' && !active) onDelete(session.id)
  }
  const modelName = session.model_alias ?? session.model_name
  return (
    <ContextActionMenu items={items} onClick={onAction} disabled={editing || unavailable}>
      <div
        ref={rowRef}
        onDragOver={dragProps?.onDragOver}
        onDrop={dragProps?.onDrop}
        className={`${styles['session-row']} ${selected ? styles['is-selected'] : ''}`}
        role="listitem"
        data-agent-session-id={session.id}
        data-drop-placement={dropPlacement}
        data-dragging={dragging || undefined}
        aria-busy={busy}
      >
        {editing ? (
          <AgentSessionNameEditor
            value={session.title}
            label={t('agent.sessions.rename')}
            busy={unavailable}
            onCancel={finishEdit}
            onSave={async (title) => {
              if (!onRename) return false
              const saved = await execute(session.id, () => onRename(session.id, title))
              if (saved) finishEdit()
              return saved
            }}
          />
        ) : (
          <>
            <button type="button" className={styles['session-grip']} aria-label={t('agent.sessions.dragSession', { title: session.title })}
              title={t('agent.sessions.dragHint')} disabled={unavailable || !dragProps?.draggable}
              draggable={!unavailable && Boolean(dragProps?.draggable)} onDragStart={dragProps?.onDragStart} onDragEnd={dragProps?.onDragEnd}
              {...pointerProps}><GripVertical size={14} aria-hidden="true" /></button>
            <button ref={buttonRef} className={styles['session-select']} type="button" aria-current={selected ? 'page' : undefined} onClick={() => onSelect(session.id)}>
              <strong>{session.pinned ? <Pin size={11} aria-hidden="true" /> : null}<span>{session.title}</span></strong>
              <span className={styles['session-meta']}>
                <span className={styles['session-model']} title={modelName}>
                  <i data-status={session.run_status.replace('_', '-')} aria-hidden="true" />
                  {showGroup ? <span className={styles['group-badge']} title={group?.name ?? t('agent.sessions.ungrouped')}>{group?.name ?? t('agent.sessions.ungrouped')}</span> : null}
                  <span>{modelName}</span>
                </span>
              </span>
            </button>
            <div className={styles['session-actions']}>
              <Dropdown trigger={['click']} disabled={unavailable} classNames={{ root: contextActionMenuPopupClassName }} menu={{ items, onClick: onAction, rootClassName: contextActionMenuPopupClassName }}>
                <Tooltip title={t('agent.sessions.more')}>
                  <Button type="text" size="small" disabled={unavailable} loading={busy} aria-label={t('agent.sessions.more')} icon={<MoreHorizontal size={15} />} />
                </Tooltip>
              </Dropdown>
            </div>
          </>
        )}
      </div>
    </ContextActionMenu>
  )
}
