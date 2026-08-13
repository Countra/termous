import { Group, Panel, Separator } from 'react-resizable-panels'
import {
  forwardRef,
  Fragment,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import type { AppTheme as ThemeMode } from '#common/contracts'
import type { Session } from '#entities/session'
import { TerminalPaneViewport } from './TerminalPaneViewport'
import styles from './TerminalSplitWorkspace.module.scss'
import {
  compactTerminalSplitLayout,
  createDropSessionOrder,
  createPresetTerminalLayout,
  createSingleTerminalLayout,
  findTerminalPaneBySession,
  getTerminalPaneLeaves,
  getTerminalSplitPreset,
  moveTerminalSessionToPane,
  replaceTerminalPaneSession,
  terminalSplitPresets,
  TERMINAL_SPLIT_MAX_PANES,
  updateTerminalSplitBranchSizes,
  type TerminalPaneLeaf,
  type TerminalSplitLayout,
  type TerminalSplitNode,
  type TerminalSplitPreset,
  type TerminalSplitPresetId,
  type TerminalSplitPresetZone,
} from '../model/terminalSplitLayout'

export interface TerminalDragPoint {
  x: number
  y: number
}

export type TerminalContextSplitResult = 'applied' | 'focused' | 'limit' | 'missing-session' | 'not-enough-sessions'

export interface TerminalSplitWorkspaceHandle {
  dropSessionAt: (point: TerminalDragPoint, sessionId: string) => boolean
  splitSessionFromMenu: (sessionId: string) => TerminalContextSplitResult
}

interface TerminalSplitWorkspaceProps {
  sessions: Session[]
  activeSession: Session | null
  workspaceActive: boolean
  themeMode: ThemeMode
  placeholder: string
  emptyState?: ReactNode
  actionBusy?: boolean
  searchPanel?: ReactNode
  dragSessionId?: string | null
  dragPoint?: TerminalDragPoint | null
  onSelectSession: (sessionId: string) => void
  onResize?: (cols: number, rows: number) => void
  onReconnectSession?: (session: Session) => void
  onSearchSession?: (sessionId: string, initialQuery?: string) => void
  onOpenFilesAtPath?: (session: Session, path: string) => void
  onCloseSession?: (session: Session) => void
}

interface DropTarget {
  presetId: TerminalSplitPreset['id']
  zoneId: string
}

const panelMinSize = 18

export const TerminalSplitWorkspace = forwardRef<TerminalSplitWorkspaceHandle, TerminalSplitWorkspaceProps>(
  (
    {
      sessions,
      activeSession,
      workspaceActive,
      themeMode,
      placeholder,
      emptyState,
      actionBusy = false,
      searchPanel,
      dragSessionId,
      dragPoint,
      onSelectSession,
      onResize,
      onReconnectSession,
      onSearchSession,
      onOpenFilesAtPath,
      onCloseSession,
    },
    ref,
  ) => {
    const { t } = useTranslation()
    const rootRef = useRef<HTMLDivElement>(null)
    const targetRef = useRef<DropTarget | null>(null)
    const [layout, setLayout] = useState<TerminalSplitLayout>(() => createSingleTerminalLayout(activeSession?.id ?? null))
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
    const [paneDropTargetId, setPaneDropTargetId] = useState<string | null>(null)
    const layoutRef = useRef(layout)
    const previousSessionIdsRef = useRef<string[]>([])
    const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
    const sessionIds = useMemo(() => sessions.map((session) => session.id), [sessions])
    const dragInsideWorkspace = Boolean(dragPoint && isPointInsideElement(dragPoint, rootRef.current))

    useEffect(() => {
      layoutRef.current = layout
    }, [layout])

    useEffect(() => {
      targetRef.current = dropTarget
    }, [dropTarget])

    useEffect(() => {
      if (!dragSessionId) {
        setDropTarget(null)
        setPaneDropTargetId(null)
      }
    }, [dragSessionId])

    useEffect(() => {
      if (!dragSessionId || !dragPoint || !dragInsideWorkspace || dropTarget) {
        setPaneDropTargetId(null)
        return
      }
      const paneId = findPaneIdFromPoint(dragPoint, rootRef.current)
      if (!paneId) {
        setPaneDropTargetId(null)
        return
      }
      const pane = getTerminalPaneLeaves(layoutRef.current.root).find((leaf) => leaf.id === paneId)
      setPaneDropTargetId(pane && pane.sessionId !== dragSessionId ? pane.id : null)
    }, [dragInsideWorkspace, dragPoint, dragSessionId, dropTarget])

    useEffect(() => {
      const previousSessionIds = previousSessionIdsRef.current
      const currentSessionIdSet = new Set(sessionIds)
      const hasRemovedSession = previousSessionIds.some((sessionId) => !currentSessionIdSet.has(sessionId))
      previousSessionIdsRef.current = sessionIds
      setLayout((current) => {
        if (sessionIds.length === 0) {
          return createSingleTerminalLayout(null)
        }
        let next = compactTerminalSplitLayout(current, sessionIds, { preserveEmptyPanes: !hasRemovedSession })
        if (!next.root) {
          next = createSingleTerminalLayout(activeSession?.id ?? sessionIds[0] ?? null)
        }
        if (!activeSession?.id || !next.root) {
          return next
        }
        const activePane = findTerminalPaneBySession(next.root, activeSession.id)
        if (activePane) {
          return { ...next, activePaneId: activePane.id }
        }
        const paneId = next.activePaneId ?? getTerminalPaneLeaves(next.root).find((pane) => pane.sessionId === null)?.id
        if (!paneId) {
          return next
        }
        return {
          root: replaceTerminalPaneSession(next.root, paneId, activeSession.id),
          activePaneId: paneId,
        }
      })
    }, [activeSession?.id, sessionIds])

    const activatePane = useCallback(
      (pane: TerminalPaneLeaf) => {
        setLayout((current) => ({ ...current, activePaneId: pane.id }))
        if (pane.sessionId) {
          onSelectSession(pane.sessionId)
        }
      },
      [onSelectSession],
    )

    const updateBranchSizes = useCallback((branchId: string, sizes: number[]) => {
      setLayout((current) => {
        if (!current.root) {
          return current
        }
        return { ...current, root: updateTerminalSplitBranchSizes(current.root, branchId, sizes) }
      })
    }, [])

    const applyDrop = useCallback(
      (sessionId: string, target: DropTarget) => {
        const preset = getTerminalSplitPreset(target.presetId)
        const current = layoutRef.current
        if (!preset || !current.root) {
          return false
        }
        const sessionsForPreset = createDropSessionOrder(current, sessionId, target.zoneId, preset)
        const next = createPresetTerminalLayout(target.presetId, sessionsForPreset)
        const activePane = next.root ? findTerminalPaneBySession(next.root, sessionId) : null
        setLayout({
          ...next,
          activePaneId: activePane?.id ?? next.activePaneId,
        })
        onSelectSession(sessionId)
        setDropTarget(null)
        return true
      },
      [onSelectSession],
    )

    const applyPaneDrop = useCallback(
      (sessionId: string, paneId: string) => {
        const current = layoutRef.current
        if (!current.root) {
          return false
        }
        const targetPane = getTerminalPaneLeaves(current.root).find((pane) => pane.id === paneId)
        if (!targetPane || targetPane.sessionId === sessionId) {
          return false
        }
        setLayout({
          root: moveTerminalSessionToPane(current.root, paneId, sessionId),
          activePaneId: paneId,
        })
        onSelectSession(sessionId)
        setPaneDropTargetId(null)
        return true
      },
      [onSelectSession],
    )

    const applyContextSplit = useCallback(
      (sessionId: string): TerminalContextSplitResult => {
        if (!sessionById.has(sessionId)) {
          return 'missing-session'
        }
        const current = layoutRef.current
        const leaves = getTerminalPaneLeaves(current.root)
        const visibleSessionIds = uniqueSessionIds(
          leaves
            .map((leaf) => leaf.sessionId)
            .filter((value): value is string => Boolean(value && sessionById.has(value))),
        )
        const existingPane = current.root ? findTerminalPaneBySession(current.root, sessionId) : null
        if (existingPane && visibleSessionIds.length > 1) {
          setLayout({ ...current, activePaneId: existingPane.id })
          onSelectSession(sessionId)
          return 'focused'
        }
        if (visibleSessionIds.length >= TERMINAL_SPLIT_MAX_PANES) {
          return 'limit'
        }
        const presetId = getContextSplitPresetId(visibleSessionIds.length)
        if (!presetId) {
          return 'limit'
        }
        const nextSessionIds = [...visibleSessionIds.filter((value) => value !== sessionId), sessionId]
        const next = createPresetTerminalLayout(presetId, nextSessionIds)
        const activePane = next.root ? findTerminalPaneBySession(next.root, sessionId) : null
        setLayout({
          ...next,
          activePaneId: activePane?.id ?? next.activePaneId,
        })
        onSelectSession(sessionId)
        setDropTarget(null)
        setPaneDropTargetId(null)
        return 'applied'
      },
      [onSelectSession, sessionById],
    )

    useImperativeHandle(
      ref,
      () => ({
        dropSessionAt(point, sessionId) {
          const target = targetRef.current
          if (!isPointInsideElement(point, rootRef.current)) {
            return false
          }
          if (target) {
            return applyDrop(sessionId, target)
          }
          const paneId = findPaneIdFromPoint(point, rootRef.current)
          return paneId ? applyPaneDrop(sessionId, paneId) : false
        },
        splitSessionFromMenu(sessionId) {
          return applyContextSplit(sessionId)
        },
      }),
      [applyContextSplit, applyDrop, applyPaneDrop],
    )

    const renderNode = useCallback(
      (node: TerminalSplitNode): ReactNode => {
        if (node.type === 'leaf') {
          const session = node.sessionId ? sessionById.get(node.sessionId) ?? null : null
          const active = node.id === layout.activePaneId
          const dropTargeted = node.id === paneDropTargetId
          return (
            <TerminalPaneViewport
              key={node.id}
              paneId={node.id}
              session={session}
              active={active}
              workspaceActive={workspaceActive}
              dropTargeted={dropTargeted}
              themeMode={themeMode}
              placeholder={placeholder}
              emptyState={emptyState}
              actionBusy={actionBusy}
              searchPanel={searchPanel}
              onResize={active ? onResize : undefined}
              onActivate={() => activatePane(node)}
              onReconnect={session && session.kind === 'ssh' && session.host_id ? () => onReconnectSession?.(session) : undefined}
              onSearch={onSearchSession}
              onOpenPath={onOpenFilesAtPath}
              onClose={session ? () => onCloseSession?.(session) : undefined}
            />
          )
        }
        return (
          <Group
            key={node.id}
            orientation={node.direction}
            className={`${styles.group} ${styles[node.direction]}`}
            onLayoutChanged={(sizes, meta) => {
              if (!meta.isUserInteraction) {
                return
              }
              updateBranchSizes(
                node.id,
                node.children.map((child, index) => Number(sizes[child.id] ?? node.sizes[index] ?? 100 / node.children.length)),
              )
            }}
          >
            {node.children.map((child, index) => (
              <Fragment key={child.id}>
                <Panel
                  id={child.id}
                  minSize={`${panelMinSize}%`}
                  defaultSize={`${node.sizes[index] ?? 100 / node.children.length}%`}
                >
                  {renderNode(child)}
                </Panel>
                {index < node.children.length - 1 ? (
                  <Separator id={`${node.id}-separator-${index}`} className={`${styles['resize-handle']} ${styles[node.direction]}`} />
                ) : null}
              </Fragment>
            ))}
          </Group>
        )
      },
      [
        actionBusy,
        activatePane,
        emptyState,
        layout.activePaneId,
        onCloseSession,
        onOpenFilesAtPath,
        onReconnectSession,
        onSearchSession,
        onResize,
        placeholder,
        searchPanel,
        sessionById,
        paneDropTargetId,
        themeMode,
        updateBranchSizes,
        workspaceActive,
      ],
    )

    return (
      <div
        ref={rootRef}
        className={[styles.workspace, dragInsideWorkspace ? styles['drag-over'] : ''].filter(Boolean).join(' ')}
        aria-label={t('workbench.terminal')}
      >
        {layout.root ? renderNode(layout.root) : (
          <TerminalPaneViewport
            paneId="terminal-pane-empty"
            session={null}
            active
            workspaceActive={workspaceActive}
            themeMode={themeMode}
            placeholder={placeholder}
            emptyState={emptyState}
            onActivate={() => undefined}
          />
        )}
        {dragSessionId && dragPoint ? (
          <TerminalSnapOverlay
            visible={dragInsideWorkspace}
            target={dropTarget}
            onTargetChange={setDropTarget}
          />
        ) : null}
      </div>
    )
  },
)

TerminalSplitWorkspace.displayName = 'TerminalSplitWorkspace'

function TerminalSnapOverlay({
  visible,
  target,
  onTargetChange,
}: {
  visible: boolean
  target: DropTarget | null
  onTargetChange: (target: DropTarget | null) => void
}) {
  const { t } = useTranslation()
  const activePreset = target ? getTerminalSplitPreset(target.presetId) : null
  if (!visible) {
    return null
  }
  return (
    <div className={styles['snap-layer']}>
      <div className={styles['snap-bar']} aria-label={t('workbench.split.chooseLayout')} onPointerLeave={() => onTargetChange(null)}>
        {terminalSplitPresets.map((preset) => (
          <TerminalSnapPresetButton
            key={preset.id}
            preset={preset}
            target={target}
            onTargetChange={onTargetChange}
          />
        ))}
      </div>
      {activePreset && target ? (
        <div className={styles['snap-preview']} aria-hidden="true">
          {activePreset.zones.map((zone) => (
            <span
              key={zone.id}
              className={[styles['snap-preview-zone'], zone.id === target.zoneId ? styles.target : ''].filter(Boolean).join(' ')}
              style={zoneStyle(zone)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TerminalSnapPresetButton({
  preset,
  target,
  onTargetChange,
}: {
  preset: TerminalSplitPreset
  target: DropTarget | null
  onTargetChange: (target: DropTarget) => void
}) {
  const { t } = useTranslation()
  return (
    <div className={[styles['snap-preset'], preset.id === 'focus' ? styles['focus-preset'] : ''].filter(Boolean).join(' ')} aria-label={t(preset.labelKey)}>
      {preset.zones.map((zone) => (
        <button
          key={zone.id}
          type="button"
          className={[
            styles['snap-zone'],
            target?.presetId === preset.id && target.zoneId === zone.id ? styles.active : '',
          ].filter(Boolean).join(' ')}
          style={zoneStyle(zone)}
          aria-label={`${t(preset.labelKey)} ${zone.id}`}
          onPointerEnter={() => onTargetChange({ presetId: preset.id, zoneId: zone.id })}
          onFocus={() => onTargetChange({ presetId: preset.id, zoneId: zone.id })}
        />
      ))}
    </div>
  )
}

function zoneStyle(zone: TerminalSplitPresetZone) {
  return {
    left: `${zone.rect.x}%`,
    top: `${zone.rect.y}%`,
    width: `${zone.rect.width}%`,
    height: `${zone.rect.height}%`,
  }
}

function getContextSplitPresetId(visiblePaneCount: number): TerminalSplitPresetId | null {
  if (visiblePaneCount <= 1) {
    return 'two-columns'
  }
  if (visiblePaneCount === 2) {
    return 'three-columns'
  }
  if (visiblePaneCount === 3) {
    return 'grid-2x2'
  }
  return null
}

function uniqueSessionIds(sessionIds: string[]) {
  return Array.from(new Set(sessionIds))
}

function isPointInsideElement(point: TerminalDragPoint, element: HTMLElement | null) {
  if (!element) {
    return false
  }
  const rect = element.getBoundingClientRect()
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}

function findPaneIdFromPoint(point: TerminalDragPoint, root: HTMLElement | null) {
  if (!root || typeof document.elementsFromPoint !== 'function') {
    return null
  }
  for (const element of document.elementsFromPoint(point.x, point.y)) {
    if (!(element instanceof HTMLElement)) {
      continue
    }
    const pane = element.closest<HTMLElement>('[data-terminal-pane-frame][data-pane-id]')
    if (pane && root.contains(pane)) {
      return pane.dataset.paneId ?? null
    }
  }
  return null
}
