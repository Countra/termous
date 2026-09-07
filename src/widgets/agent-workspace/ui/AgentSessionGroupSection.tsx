import { Button, Dropdown, type MenuProps } from 'antd'
import { ArrowDown, ArrowUp, ChevronRight, MessageSquarePlus, MoreHorizontal, Pencil, Pin, FolderMinus } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSessionGroup } from '#entities/agent'
import { ContextActionMenu, contextActionMenuPopupClassName } from '#shared/ui'
import type { SessionSidebarExecute, SessionSidebarPlacement } from '../model/sessionSidebar.ts'
import { AgentSessionNameEditor } from './AgentSessionNameEditor.tsx'
import type { SessionSidebarDragProps, SessionSidebarPointerProps } from './AgentSessionRow.tsx'
import styles from './AgentSessionSidebar.module.scss'

export function AgentSessionGroupSection({ title, group, pinned, count, collapsed, disabled, busy, editing, orderBusy,
  before, after, dragProps, pointerProps, dropPlacement, dropActive, children, execute, onToggle, onCreate, onRename, onDelete, onMove, onEditingChange }: {
  title: string
  group?: AgentSessionGroup
  pinned?: boolean
  count: number
  collapsed: boolean
  disabled: boolean
  busy: boolean
  editing: boolean
  orderBusy: boolean
  before?: string
  after?: string
  dragProps?: SessionSidebarDragProps
  pointerProps?: SessionSidebarPointerProps
  dropPlacement?: SessionSidebarPlacement
  dropActive?: boolean
  children: ReactNode
  execute: SessionSidebarExecute
  onToggle: () => void
  onCreate?: (groupId?: string) => void
  onRename?: (id: string, name: string) => Promise<void>
  onDelete?: (group: AgentSessionGroup) => void
  onMove?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
  onEditingChange: (id: string, editing: boolean) => void
}) {
  const { t } = useTranslation()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const unavailable = disabled || busy
  const draggable = Boolean(group && onMove && !unavailable && !orderBusy && dragProps?.draggable)
  const finishEdit = () => {
    const restoreFocus = document.activeElement === document.body || headerRef.current?.contains(document.activeElement)
    if (group) onEditingChange(group.id, false)
    if (restoreFocus) window.requestAnimationFrame(() => buttonRef.current?.focus())
  }
  const items: MenuProps['items'] = group ? [
    ...(onCreate ? [{ key: 'new', label: t('agent.sessions.newInGroup'), icon: <MessageSquarePlus size={14} />, disabled: unavailable }] : []),
    ...(onRename ? [{ key: 'rename', label: t('agent.sessions.renameGroup'), icon: <Pencil size={14} />, disabled: unavailable }] : []),
    ...(onMove ? [
      { key: 'up', label: t('agent.sessions.moveUp'), icon: <ArrowUp size={14} />, disabled: unavailable || orderBusy || !before },
      { key: 'down', label: t('agent.sessions.moveDown'), icon: <ArrowDown size={14} />, disabled: unavailable || orderBusy || !after },
    ] : []),
    ...(onDelete ? [{ type: 'divider' as const }, { key: 'delete', label: t('agent.sessions.dissolveGroup'), icon: <FolderMinus size={14} />, disabled: unavailable, danger: true }] : []),
  ] : []
  const onAction: MenuProps['onClick'] = ({ key, domEvent }) => {
    domEvent.stopPropagation()
    if (!group || unavailable) return
    if (key === 'new') onCreate?.(group.id)
    if (key === 'rename') onEditingChange(group.id, true)
    if (key === 'delete') onDelete?.(group)
    if ((key === 'up' || key === 'down') && onMove && !orderBusy) {
      const target = key === 'up' ? before : after
      if (target) void execute('group-order', () => onMove(group.id, target, key === 'up' ? 'before' : 'after'))
    }
  }
  return (
    <section
      className={styles['session-section']}
      aria-label={title}
      data-agent-session-group={group?.id ?? (pinned ? '$pinned' : '$ungrouped')}
      data-drop-active={dropActive || undefined}
      data-grouped={Boolean(group) || undefined}
      onDragOver={dragProps?.onDragOver}
      onDrop={dragProps?.onDrop}
    >
      <ContextActionMenu items={items} onClick={onAction} disabled={!group || editing || unavailable}>
        <div ref={headerRef} className={styles['section-header']} data-agent-session-header data-drop-placement={dropPlacement}>
          {editing && group ? (
            <AgentSessionNameEditor value={group.name} label={t('agent.sessions.renameGroup')} maxCharacters={64} busy={unavailable} onCancel={finishEdit} onSave={async (name) => {
              if (!onRename) return false
              const saved = await execute(group.id, () => onRename(group.id, name))
              if (saved) finishEdit()
              return saved
            }} />
          ) : (
            <>
              <button ref={buttonRef} type="button" className={styles['section-toggle']} aria-expanded={!collapsed}
                draggable={draggable} title={draggable ? t('agent.sessions.dragGroupHint') : undefined}
                onDragStart={draggable ? dragProps?.onDragStart : undefined} onDragEnd={dragProps?.onDragEnd}
                {...(draggable ? pointerProps : {})}
                onClick={(event) => {
                  pointerProps?.onClick?.(event)
                  if (!event.defaultPrevented) onToggle()
                }}>
                <ChevronRight size={12} className={styles['section-chevron']} aria-hidden="true" />
                {pinned ? <Pin size={12} aria-hidden="true" /> : null}
                <strong>{title}</strong><small>{count}</small>
              </button>
              <span className={styles['section-actions']}>
                {items.length > 0 ? <Dropdown trigger={['click']} disabled={unavailable} classNames={{ root: contextActionMenuPopupClassName }} menu={{ items, onClick: onAction }}><Button type="text" size="small" disabled={unavailable} loading={busy} aria-label={t('agent.sessions.groupActions')} icon={<MoreHorizontal size={14} />} /></Dropdown> : null}
              </span>
            </>
          )}
        </div>
      </ContextActionMenu>
      {!collapsed ? <div className={styles['section-body']} role="list">{count === 0 ? <span className={styles['section-empty']}>{t('agent.sessions.emptyGroup')}</span> : children}</div> : null}
    </section>
  )
}
