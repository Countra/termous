import { useCallback, useEffect, useRef, useState, type DragEvent, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { AgentSessionGroup } from '#entities/agent'
import type { AgentWorkspaceSession } from './types.ts'
import { validSessionSidebarDrop, type SessionSidebarDrag, type SessionSidebarDrop, type SessionSidebarExecute, type SessionSidebarPlacement } from './sessionSidebar.ts'

export interface SessionSidebarDragOptions {
  sessions: AgentWorkspaceSession[]
  groups: AgentSessionGroup[]
  pendingIds: ReadonlySet<string>
  disabled: boolean
  listRef: RefObject<HTMLElement | null>
  execute: SessionSidebarExecute
  onMoveSession?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
  onMoveToGroup?: (id: string, groupId: string | undefined, unpin?: boolean) => Promise<void>
  onPin?: (id: string, pinned: boolean) => Promise<void>
  onMoveGroup?: (id: string, targetId: string, placement: SessionSidebarPlacement) => Promise<void>
}

export type SessionSidebarNativeDragProps = Pick<HTMLAttributes<HTMLElement>, 'draggable' | 'onDragStart' | 'onDragOver' | 'onDragEnd' | 'onDrop'>

interface PointerDrag {
  id: number
  source: SessionSidebarDrag
  element: HTMLElement
  x: number
  y: number
  active: boolean
}

export function useSessionSidebarDrag(options: SessionSidebarDragOptions) {
  const latest = useRef(options)
  latest.current = options
  const sourceRef = useRef<SessionSidebarDrag | undefined>(undefined)
  const dropRef = useRef<SessionSidebarDrop | undefined>(undefined)
  const pointer = useRef<PointerDrag | undefined>(undefined)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const scrollFrame = useRef<number | undefined>(undefined)
  const scrollPoint = useRef<{ x: number; y: number } | undefined>(undefined)
  const mounted = useRef(true)
  const suppressClick = useRef<{ element: HTMLElement; pointerId: number } | undefined>(undefined)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [source, setSource] = useState<SessionSidebarDrag>()
  const [drop, setDrop] = useState<SessionSidebarDrop>()
  const [preview, setPreview] = useState<{ x: number; y: number; source: SessionSidebarDrag }>()

  const clearClickSuppression = useCallback(() => {
    if (clickTimer.current !== undefined) clearTimeout(clickTimer.current)
    clickTimer.current = undefined
    suppressClick.current = undefined
  }, [])
  const resetDrag = useCallback(() => {
    if (pressTimer.current !== undefined) clearTimeout(pressTimer.current)
    if (scrollFrame.current !== undefined) window.cancelAnimationFrame(scrollFrame.current)
    pressTimer.current = undefined
    scrollFrame.current = undefined
    scrollPoint.current = undefined
    const captured = pointer.current
    pointer.current = undefined
    sourceRef.current = undefined
    dropRef.current = undefined
    if (captured?.element.hasPointerCapture?.(captured.id)) captured.element.releasePointerCapture(captured.id)
    if (mounted.current) { setSource(undefined); setDrop(undefined); setPreview(undefined) }
  }, [])

  const canStart = (value: SessionSidebarDrag) => {
    const current = latest.current
    if (current.disabled || current.pendingIds.has(value.id)) return false
    return value.kind === 'group'
      ? Boolean(current.onMoveGroup) && !current.pendingIds.has('group-order') && current.groups.some(({ id }) => id === value.id)
      : Boolean(current.onMoveSession || current.onMoveToGroup || current.onPin)
        && !current.pendingIds.has('session-order') && current.sessions.some(({ id, archived }) => id === value.id && !archived)
  }
  const canDrop = (target: SessionSidebarDrop | undefined) => {
    const current = latest.current
    return Boolean(target && !current.disabled && validSessionSidebarDrop(sourceRef.current, target, current.sessions, current.groups, current.pendingIds)
      && (target.kind === 'group' ? current.onMoveToGroup : target.kind === 'pin-area' ? current.onPin
        : target.kind === 'session-order' ? current.onMoveSession : current.onMoveGroup))
  }
  const updateDrop = (target: SessionSidebarDrop | undefined) => {
    const next = canDrop(target) ? target : undefined
    if (JSON.stringify(next) === JSON.stringify(dropRef.current)) return
    dropRef.current = next
    setDrop(next)
  }
  const targetAt = (element: Element | null, y: number): SessionSidebarDrop | undefined => {
    if (!element) return undefined
    const list = latest.current.listRef.current
    const zone = element.closest<HTMLElement>('[data-agent-sidebar-pin-drop]')
    if (zone && list?.parentElement?.contains(zone)) return { kind: 'pin-area' }
    if (!list?.contains(element)) return undefined
    const section = element.closest<HTMLElement>('[data-agent-session-group]')
    const groupId = section?.dataset.agentSessionGroup
    if (sourceRef.current?.kind === 'group') {
      const header = section?.querySelector<HTMLElement>('[data-agent-session-header]')
      if (header && groupId) return orderedTarget('group-order', groupId, header, y)
      return undefined
    }
    const row = element.closest<HTMLElement>('[data-agent-session-id]')
    if (row?.dataset.agentSessionId) return orderedTarget('session-order', row.dataset.agentSessionId, row, y)
    if (groupId === '$pinned') return { kind: 'pin-area' }
    if (groupId) return { kind: 'group', id: groupId === '$ungrouped' ? undefined : groupId }
    return { kind: 'group' }
  }
  const targetAtPoint = (x: number, y: number) => targetAt(document.elementFromPoint?.(x, y) ?? null, y)
  const updateScroll = (x: number, y: number) => {
    scrollPoint.current = { x, y }
    if (scrollFrame.current !== undefined || !sourceRef.current) return
    const tick = () => {
      scrollFrame.current = undefined
      const list = latest.current.listRef.current
      const point = scrollPoint.current
      if (!list || !point || !sourceRef.current) return
      const bounds = list.getBoundingClientRect()
      const edge = Math.min(48, bounds.height / 3)
      if (edge <= 0 || point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return
      const distance = point.y - bounds.top < edge ? point.y - bounds.top - edge
        : bounds.bottom - point.y < edge ? edge - (bounds.bottom - point.y) : 0
      const max = Math.max(0, list.scrollHeight - list.clientHeight)
      const next = Math.max(0, Math.min(max, list.scrollTop + distance / edge * 14))
      if (next === list.scrollTop) return
      list.scrollTop = next
      // 滚动会改变命中的行，必须重新定位后才能提交相对排序。
      updateDrop(targetAtPoint(point.x, point.y))
      scrollFrame.current = window.requestAnimationFrame(tick)
    }
    scrollFrame.current = window.requestAnimationFrame(tick)
  }
  const finish = (target: SessionSidebarDrop | undefined) => {
    const dragged = sourceRef.current
    const allowed = canDrop(target)
    const current = latest.current
    resetDrag()
    if (!dragged || !target || !allowed) return
    if (target.kind === 'group') void current.execute(dragged.id, () => current.onMoveToGroup!(dragged.id, target.id, true))
    if (target.kind === 'pin-area') void current.execute(dragged.id, () => current.onPin!(dragged.id, true))
    if (target.kind === 'session-order') void current.execute('session-order', () => current.onMoveSession!(dragged.id, target.id, target.placement))
    if (target.kind === 'group-order') void current.execute('group-order', () => current.onMoveGroup!(dragged.id, target.id, target.placement))
  }
  const over = (event: DragEvent<HTMLElement>, target: SessionSidebarDrop | undefined) => {
    if (!sourceRef.current) return
    event.stopPropagation()
    updateScroll(event.clientX, event.clientY)
    updateDrop(target)
    event.dataTransfer.dropEffect = canDrop(target) ? 'move' : 'none'
    if (canDrop(target)) event.preventDefault()
  }
  const dropOn = (event: DragEvent<HTMLElement>, target: SessionSidebarDrop | undefined) => {
    if (!sourceRef.current) return
    event.preventDefault()
    event.stopPropagation()
    finish(target)
  }
  const startNative = (event: DragEvent<HTMLElement>, value: SessionSidebarDrag) => {
    if (pointer.current || !canStart(value)) { event.preventDefault(); return }
    resetDrag()
    sourceRef.current = value
    setSource(value)
    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('application/x-termous-agent-sidebar', JSON.stringify(value))
    const image = value.kind === 'group' ? event.currentTarget.closest<HTMLElement>('[data-agent-session-header]')
      : event.currentTarget.closest<HTMLElement>('[data-agent-session-id]')
    if (image) event.dataTransfer.setDragImage?.(image, 20, 14)
  }
  const startPointer = (event: ReactPointerEvent<HTMLElement>, value: SessionSidebarDrag) => {
    if (event.isPrimary === false || event.button !== 0) return
    clearClickSuppression()
    if (event.pointerType === 'mouse' || !canStart(value)) return
    resetDrag()
    pointer.current = { id: event.pointerId, source: value, element: event.currentTarget, x: event.clientX, y: event.clientY, active: false }
    event.stopPropagation()
    pressTimer.current = setTimeout(() => {
      const pending = pointer.current
      pressTimer.current = undefined
      if (!pending || !canStart(pending.source)) { resetDrag(); return }
      pending.active = true
      suppressClick.current = { element: pending.element, pointerId: pending.id }
      pending.element.setPointerCapture?.(pending.id)
      sourceRef.current = pending.source
      setSource(pending.source)
      setPreview({ x: pending.x, y: pending.y, source: pending.source })
    }, 300)
  }
  const movePointer = (event: PointerEvent) => {
    const current = pointer.current
    if (!current || current.id !== event.pointerId) return
    if (!current.active) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8) resetDrag()
      return
    }
    event.preventDefault()
    setPreview({ x: event.clientX, y: event.clientY, source: current.source })
    updateDrop(targetAtPoint(event.clientX, event.clientY))
    updateScroll(event.clientX, event.clientY)
  }
  const endPointer = (event: PointerEvent, cancel: boolean) => {
    if (suppressClick.current?.pointerId === event.pointerId) {
      if (cancel) clearClickSuppression()
      // 仅拦截本次 pointerup 紧随的合成 click，不影响后续鼠标或键盘点击。
      else clickTimer.current = setTimeout(clearClickSuppression, 0)
    }
    const current = pointer.current
    if (!current || current.id !== event.pointerId) return
    if (cancel || !current.active) { resetDrag(); return }
    event.preventDefault()
    finish(targetAtPoint(event.clientX, event.clientY))
  }
  const actions = useRef({ movePointer, endPointer, canStart, canDrop, updateDrop })
  actions.current = { movePointer, endPointer, canStart, canDrop, updateDrop }
  useEffect(() => {
    mounted.current = true
    const move = (event: PointerEvent) => actions.current.movePointer(event)
    const up = (event: PointerEvent) => actions.current.endPointer(event, false)
    const cancel = (event: PointerEvent) => actions.current.endPointer(event, true)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') resetDrag() }
    const blur = () => { resetDrag(); clearClickSuppression() }
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up, { passive: false })
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', blur)
    return () => {
      mounted.current = false
      resetDrag()
      clearClickSuppression()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', blur)
    }
  }, [resetDrag, clearClickSuppression])
  useEffect(() => {
    const current = sourceRef.current ?? pointer.current?.source
    if (current && !actions.current.canStart(current)) resetDrag()
    else if (dropRef.current && !actions.current.canDrop(dropRef.current)) actions.current.updateDrop(undefined)
  }, [options.disabled, options.sessions, options.groups, options.pendingIds, resetDrag])

  const rowDragProps = (session: AgentWorkspaceSession): SessionSidebarNativeDragProps => ({
    draggable: canStart({ kind: 'session', id: session.id }),
    onDragStart: (event) => startNative(event, { kind: 'session', id: session.id }),
    onDragEnd: resetDrag,
    onDragOver: (event) => over(event, targetAt(event.currentTarget, event.clientY)),
    onDrop: (event) => dropOn(event, targetAt(event.currentTarget, event.clientY)),
  })
  const sectionDragProps = (id?: string, pinned = false): SessionSidebarNativeDragProps => {
    const target = (event: DragEvent<HTMLElement>): SessionSidebarDrop | undefined => sourceRef.current?.kind === 'group'
      ? targetAt(event.currentTarget, event.clientY) : pinned ? { kind: 'pin-area' } : { kind: 'group', id }
    return {
      draggable: Boolean(id && canStart({ kind: 'group', id })),
      onDragStart: id ? (event) => startNative(event, { kind: 'group', id }) : undefined,
      onDragEnd: resetDrag,
      onDragOver: (event) => over(event, target(event)),
      onDrop: (event) => dropOn(event, target(event)),
    }
  }
  const handlePointerProps = (value: SessionSidebarDrag): Pick<HTMLAttributes<HTMLElement>, 'onPointerDown' | 'onLostPointerCapture' | 'onClick' | 'onContextMenu'> => ({
    onPointerDown: (event) => startPointer(event, value),
    onLostPointerCapture: () => { if (pointer.current?.active) resetDrag() },
    onClick: (event) => {
      const suppressed = suppressClick.current?.element === event.currentTarget && event.detail !== 0
      clearClickSuppression()
      if (suppressed) { event.preventDefault(); event.stopPropagation() }
    },
    onContextMenu: (event) => { if (pointer.current) { event.preventDefault(); event.stopPropagation() } },
  })
  const listDragProps: Pick<HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDrop' | 'onDragLeave'> = {
    onDragOver: (event) => over(event, targetAt(event.target instanceof Element ? event.target : null, event.clientY)),
    onDrop: (event) => dropOn(event, targetAt(event.target instanceof Element ? event.target : null, event.clientY)),
    onDragLeave: (event) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
        updateDrop(undefined)
        scrollPoint.current = undefined
      }
    },
  }
  return { source, drop, preview, resetDrag, rowDragProps, sectionDragProps, handlePointerProps, listDragProps }
}

function orderedTarget(kind: 'session-order' | 'group-order', id: string, element: HTMLElement, y: number): SessionSidebarDrop {
  const bounds = element.getBoundingClientRect()
  return { kind, id, placement: y < bounds.top + bounds.height / 2 ? 'before' : 'after' }
}
