import { Archive, FolderPlus, GripVertical, MessageSquarePlus, PanelLeftClose, Pin, Search } from 'lucide-react'
import { Button, Input, Tooltip } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentSessionGroup } from '#entities/agent'
import { usePersistentJsonState } from '#shared/hooks'
import { ConfirmDialog } from '#shared/ui'
import {
  parseSessionSidebarCollapsed, partitionSidebarSessions, sessionSidebarPinSection, sessionSidebarStorageKey,
  sessionSidebarUngroupedSection,
  type SessionSidebarExecute, type SessionSidebarPlacement,
} from '../model/sessionSidebar.ts'
import { useSessionSidebarDrag } from '../model/useSessionSidebarDrag.ts'
import type { AgentWorkspaceSession } from '../model/types.ts'
import { AgentSessionGroupSection } from './AgentSessionGroupSection.tsx'
import { AgentSessionCreateGroupDialog } from './AgentSessionCreateGroupDialog.tsx'
import { AgentSessionRow } from './AgentSessionRow.tsx'
import styles from './AgentSessionSidebar.module.scss'

const noGroups: AgentSessionGroup[] = []
const noPending: ReadonlySet<string> = new Set()

export interface AgentSessionSidebarProps {
  sessions: AgentWorkspaceSession[]
  groups?: AgentSessionGroup[]
  selectedSessionId?: string
  disabled: boolean
  queuedSessionId?: string
  pendingIds?: ReadonlySet<string>
  onCreate: (groupId?: string) => void
  onSelect: (sessionId: string) => void
  onArchive: (sessionId: string) => void
  onDelete: (sessionId: string) => void
  onClose?: () => void
  onRename?: (id: string, title: string) => Promise<void>
  onPin?: (id: string, pinned: boolean) => Promise<void>
  onMoveToGroup?: (id: string, groupId: string | undefined, unpin?: boolean) => Promise<void>
  onCreateGroup?: (name: string) => Promise<void>
  onRenameGroup?: (id: string, name: string) => Promise<void>
  onDeleteGroup?: (id: string) => Promise<void>
  onMoveGroup?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
  onMovePin?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
  onMoveSession?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
  onOpenArchives?: () => void
  searchQuery?: string
  onSearchQueryChange?: (value: string) => void
  searchResults?: AgentWorkspaceSession[]
  searchLoading?: boolean
  searchError?: string
  onSearchRetry?: () => void
}

export function AgentSessionSidebar(props: AgentSessionSidebarProps) {
  const { t } = useTranslation()
  const { sessions, groups = noGroups, pendingIds = noPending, selectedSessionId, disabled } = props
  const [localQuery, setLocalQuery] = useState('')
  const query = props.searchQuery ?? localQuery
  const searching = query.trim().length > 0
  const [collapsed, setCollapsed] = usePersistentJsonState(sessionSidebarStorageKey, [] as string[], parseSessionSidebarCollapsed)
  const [localPending, setLocalPending] = useState<string[]>([])
  const pendingRef = useRef(new Set<string>())
  const pending = new Set([...pendingIds, ...localPending])
  const [operationFailed, setOperationFailed] = useState(false)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<AgentSessionGroup>()
  const [editingIds, setEditingIds] = useState<ReadonlySet<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const partition = useMemo(() => partitionSidebarSessions(sessions, groups), [groups, sessions])
  const selected = sessions.find(({ id }) => id === selectedSessionId)
  const selectedSection = selected?.pinned ? sessionSidebarPinSection
    : groups.some(({ id }) => id === selected?.group_id) ? selected?.group_id : sessionSidebarUngroupedSection
  useEffect(() => {
    if (!selectedSessionId || !selectedSection) return
    setCollapsed((current) => current.filter((id) => id !== selectedSection))
    const frame = window.requestAnimationFrame(() => {
      const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-agent-session-id]') ?? [])
        .find((element) => element.dataset.agentSessionId === selectedSessionId)
      row?.scrollIntoView?.({ block: 'nearest' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [selectedSessionId, selectedSection, setCollapsed])
  const execute: SessionSidebarExecute = async (key, operation) => {
    if (disabled || pendingIds.has(key) || pendingRef.current.has(key)) return false
    pendingRef.current.add(key)
    setLocalPending([...pendingRef.current])
    setOperationFailed(false)
    try { await operation(); return true } catch { if (key !== 'group-create') setOperationFailed(true); return false } finally {
      pendingRef.current.delete(key)
      setLocalPending([...pendingRef.current])
    }
  }
  const editingExists = sessions.some(({ id }) => editingIds.has(id)) || groups.some(({ id }) => editingIds.has(id))
  const changeEditing = (id: string, editing: boolean) => setEditingIds((current) => {
    const next = new Set(current)
    if (editing) next.add(id)
    else next.delete(id)
    return next
  })
  const dragDisabled = disabled || searching || editingExists || creatingGroup
  const { source, drop, preview, resetDrag, rowDragProps, sectionDragProps, handlePointerProps, listDragProps } = useSessionSidebarDrag({
    sessions, groups, pendingIds: pending, disabled: dragDisabled, listRef, execute,
    onMoveSession: props.onMoveSession, onMoveToGroup: props.onMoveToGroup, onPin: props.onPin, onMoveGroup: props.onMoveGroup,
  })
  const renderRow = (session: AgentWorkspaceSession, showGroup: boolean, siblings: AgentWorkspaceSession[] = []) => {
    const index = siblings.findIndex(({ id }) => id === session.id)
    return <AgentSessionRow
      key={session.id} session={session} groups={partition.groups} selected={selectedSessionId === session.id}
      disabled={disabled} busy={pending.has(session.id)} editing={editingIds.has(session.id)} pendingIds={pending} queued={session.id === props.queuedSessionId}
      showGroup={showGroup} search={searching} execute={execute}
      before={siblings[index - 1]?.id} after={index < 0 ? undefined : siblings[index + 1]?.id}
      dropPlacement={drop?.kind === 'session-order' && drop.id === session.id ? drop.placement : undefined}
      dragging={source?.kind === 'session' && source.id === session.id}
      dragProps={rowDragProps(session)} pointerProps={handlePointerProps({ kind: 'session', id: session.id })}
      onSelect={props.onSelect} onArchive={props.onArchive} onDelete={props.onDelete} onRename={props.onRename}
      onPin={props.onPin} onMoveToGroup={props.onMoveToGroup} onMovePin={props.onMovePin} onMoveSession={props.onMoveSession} onEditingChange={changeEditing}
    />
  }
  const toggle = (id: string) => setCollapsed((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const renderSection = (title: string, items: AgentWorkspaceSession[], group?: AgentSessionGroup, pinned = false, index = -1) => {
    const key = group?.id ?? (pinned ? sessionSidebarPinSection : sessionSidebarUngroupedSection)
    return <AgentSessionGroupSection key={key} title={title} group={group} pinned={pinned} count={items.length}
      collapsed={collapsed.includes(key)} disabled={disabled} busy={pending.has(key)} editing={editingIds.has(key)} orderBusy={pending.has('group-order')}
      before={partition.groups[index - 1]?.id} after={index < 0 ? undefined : partition.groups[index + 1]?.id}
      dragProps={sectionDragProps(group?.id, pinned)}
      pointerProps={group ? handlePointerProps({ kind: 'group', id: group.id }) : undefined}
      dropActive={drop?.kind === 'group' && drop.id === group?.id && !pinned || drop?.kind === 'pin-area' && pinned}
      dropPlacement={drop?.kind === 'group-order' && drop.id === group?.id ? drop.placement : undefined}
      execute={execute} onToggle={() => toggle(key)} onCreate={props.onCreate} onRename={props.onRenameGroup}
      onDelete={props.onDeleteGroup ? setDeletingGroup : undefined} onMove={props.onMoveGroup} onEditingChange={changeEditing}
    >{items.map((session) => renderRow(session, pinned, items))}</AgentSessionGroupSection>
  }
  const visibleSearch = props.searchResults ?? (props.onSearchQueryChange ? [] : sessions.filter((session) => session.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())))
  return (
    <aside className={styles['session-sidebar']} data-agent-panel aria-label={t('agent.sessions.title')}>
      <div className={styles['session-sidebar-header']}>
        <div className={styles['session-sidebar-title']}>
          <strong>{t('agent.sessions.title')}</strong>
          <span>
            <Tooltip title={t('agent.sessions.new')}><Button type="text" disabled={disabled} aria-label={t('agent.sessions.new')} icon={<MessageSquarePlus size={15} />} onClick={() => props.onCreate()} /></Tooltip>
            {props.onCreateGroup ? <Tooltip title={t('agent.sessions.createGroup')}><Button type="text" disabled={disabled || pending.has('group-create')} aria-label={t('agent.sessions.createGroup')} icon={<FolderPlus size={15} />} onClick={() => setCreatingGroup(true)} /></Tooltip> : null}
            {props.onClose ? <Tooltip title={t('app.close')}><Button type="text" aria-label={t('app.close')} icon={<PanelLeftClose size={16} />} onClick={props.onClose} /></Tooltip> : null}
          </span>
        </div>
        <div className={styles['search-container']}><Input allowClear prefix={<Search size={14} aria-hidden="true" />} value={query} aria-label={t('agent.sessions.search')} placeholder={t('agent.sessions.search')} onChange={(event) => {
          resetDrag()
          if (props.onSearchQueryChange) props.onSearchQueryChange(event.target.value)
          else setLocalQuery(event.target.value)
        }} />
          {source?.kind === 'session' && partition.pinned.length === 0 && props.onPin ? <div className={styles['pin-drop-target']} data-agent-sidebar-pin-drop data-drop-active={drop?.kind === 'pin-area' || undefined}
            onDragOver={sectionDragProps(undefined, true).onDragOver} onDrop={sectionDragProps(undefined, true).onDrop}><Pin size={13} aria-hidden="true" />{t('agent.sessions.pinDropTarget')}</div> : null}
        </div>
      </div>
      {operationFailed ? <p className={styles['sidebar-error']} role="alert">{t('agent.sessions.operationFailed')}</p> : null}
      <div ref={listRef} className={styles['session-list']} aria-busy={searching && props.searchLoading} {...listDragProps}>
        {searching ? (
          props.searchLoading ? <p className={styles['session-list-empty']} role="status">{t('agent.sessions.searchLoading')}</p>
            : props.searchError ? <div className={styles['sidebar-error']} role="alert">{t('agent.sessions.searchFailed')}{props.onSearchRetry ? <Button size="small" onClick={props.onSearchRetry}>{t('agent.sessions.retry')}</Button> : null}</div>
              : <div role="list">{visibleSearch.length === 0 ? <p className={styles['session-list-empty']}>{t('agent.sessions.noResults')}</p> : visibleSearch.map((session) => renderRow(session, true))}</div>
        ) : (
          <>
            {partition.pinned.length > 0 ? renderSection(t('agent.sessions.pinned'), partition.pinned, undefined, true) : null}
            {partition.groups.map((group, index) => renderSection(group.name, partition.grouped.get(group.id) ?? [], group, false, index))}
            {partition.groups.length > 0 ? renderSection(t('agent.sessions.ungrouped'), partition.ungrouped)
              : <div role="list">{partition.ungrouped.map((session) => renderRow(session, false, partition.ungrouped))}</div>}
            {sessions.length === 0 && groups.length === 0 ? <p className={styles['session-list-empty']}>{t('agent.sessions.empty')}</p> : null}
          </>
        )}
      </div>
      {props.onOpenArchives ? <div className={styles['sidebar-footer']}><Button type="text" icon={<Archive size={14} />} onClick={props.onOpenArchives}>{t('agent.archives.title')}</Button></div> : null}
      {preview ? <div className={styles['drag-preview']} style={{ left: preview.x + 12, top: preview.y + 12 }} aria-hidden="true"><GripVertical size={14} /><span>{preview.source.kind === 'session' ? sessions.find(({ id }) => id === preview.source.id)?.title : groups.find(({ id }) => id === preview.source.id)?.name}</span></div> : null}
      <AgentSessionCreateGroupDialog open={creatingGroup} disabled={disabled} onClose={() => setCreatingGroup(false)} onCreate={async (name) => {
        if (!props.onCreateGroup) return false
        return execute('group-create', () => props.onCreateGroup!(name))
      }} />
      <ConfirmDialog open={Boolean(deletingGroup)} title={t('agent.sessions.dissolveGroupTitle', { name: deletingGroup?.name })} description={t('agent.sessions.dissolveGroupDescription')} confirmLabel={t('agent.sessions.dissolveGroup')} confirmLoading={Boolean(deletingGroup && pending.has(deletingGroup.id))} onCancel={() => setDeletingGroup(undefined)} onConfirm={() => {
        if (!deletingGroup || !props.onDeleteGroup) return
        void execute(deletingGroup.id, () => props.onDeleteGroup!(deletingGroup.id)).then((saved) => { if (saved) setDeletingGroup(undefined) })
      }} />
    </aside>
  )
}
