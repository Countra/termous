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
import type { Session, ThemeMode } from '../../types/domain'
import { TerminalPaneViewport } from './TerminalPaneViewport'
import {
  compactTerminalSplitLayout,
  createDropSessionOrder,
  createPresetTerminalLayout,
  createSingleTerminalLayout,
  findTerminalPaneBySession,
  getTerminalPaneLeaves,
  getTerminalSplitPreset,
  replaceTerminalPaneSession,
  terminalSplitPresets,
  updateTerminalSplitBranchSizes,
  type TerminalPaneLeaf,
  type TerminalSplitLayout,
  type TerminalSplitNode,
  type TerminalSplitPreset,
  type TerminalSplitPresetZone,
} from './terminalSplitLayout'

export interface TerminalDragPoint {
  x: number
  y: number
}

export interface TerminalSplitWorkspaceHandle {
  dropSessionAt: (point: TerminalDragPoint, sessionId: string) => boolean
}

interface TerminalSplitWorkspaceProps {
  sessions: Session[]
  activeSession: Session | null
  themeMode: ThemeMode
  placeholder: string
  actionBusy?: boolean
  searchPanel?: ReactNode
  dragSessionId?: string | null
  dragPoint?: TerminalDragPoint | null
  onSelectSession: (sessionId: string) => void
  onResize?: (cols: number, rows: number) => void
  onReconnectSession?: (session: Session) => void
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
      themeMode,
      placeholder,
      actionBusy = false,
      searchPanel,
      dragSessionId,
      dragPoint,
      onSelectSession,
      onResize,
      onReconnectSession,
      onCloseSession,
    },
    ref,
  ) => {
    const { t } = useTranslation()
    const rootRef = useRef<HTMLDivElement>(null)
    const targetRef = useRef<DropTarget | null>(null)
    const [layout, setLayout] = useState<TerminalSplitLayout>(() => createSingleTerminalLayout(activeSession?.id ?? null))
    const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
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
      }
    }, [dragSessionId])

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

    useImperativeHandle(
      ref,
      () => ({
        dropSessionAt(point, sessionId) {
          const target = targetRef.current
          if (!target || !isPointInsideElement(point, rootRef.current)) {
            return false
          }
          return applyDrop(sessionId, target)
        },
      }),
      [applyDrop],
    )

    const renderNode = useCallback(
      (node: TerminalSplitNode): ReactNode => {
        if (node.type === 'leaf') {
          const session = node.sessionId ? sessionById.get(node.sessionId) ?? null : null
          const active = node.id === layout.activePaneId
          return (
            <TerminalPaneViewport
              key={node.id}
              paneId={node.id}
              session={session}
              active={active}
              themeMode={themeMode}
              placeholder={placeholder}
              actionBusy={actionBusy}
              searchPanel={searchPanel}
              onResize={active ? onResize : undefined}
              onActivate={() => activatePane(node)}
              onReconnect={session && session.kind === 'ssh' && session.host_id ? () => onReconnectSession?.(session) : undefined}
              onClose={session ? () => onCloseSession?.(session) : undefined}
            />
          )
        }
        return (
          <Group
            key={node.id}
            orientation={node.direction}
            className={`terminal-split-group is-${node.direction}`}
            onLayoutChange={(sizes) => {
              updateBranchSizes(
                node.id,
                node.children.map((child, index) => Number(sizes[child.id] ?? node.sizes[index] ?? 100 / node.children.length)),
              )
            }}
          >
            {node.children.map((child, index) => (
              <Fragment key={child.id}>
                <Panel id={child.id} minSize={panelMinSize} defaultSize={node.sizes[index] ?? 100 / node.children.length}>
                  {renderNode(child)}
                </Panel>
                {index < node.children.length - 1 ? (
                  <Separator id={`${node.id}-separator-${index}`} className={`terminal-split-resize-handle is-${node.direction}`} />
                ) : null}
              </Fragment>
            ))}
          </Group>
        )
      },
      [
        actionBusy,
        activatePane,
        layout.activePaneId,
        onCloseSession,
        onReconnectSession,
        onResize,
        placeholder,
        searchPanel,
        sessionById,
        themeMode,
        updateBranchSizes,
      ],
    )

    return (
      <div
        ref={rootRef}
        className={`terminal-split-workspace ${dragInsideWorkspace ? 'is-drag-over' : ''}`}
        aria-label={t('workbench.terminal')}
      >
        {layout.root ? renderNode(layout.root) : (
          <TerminalPaneViewport
            paneId="terminal-pane-empty"
            session={null}
            active
            themeMode={themeMode}
            placeholder={placeholder}
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
    <div className="terminal-snap-layer">
      <div className="terminal-snap-bar" aria-label={t('workbench.split.chooseLayout')} onPointerLeave={() => onTargetChange(null)}>
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
        <div className="terminal-snap-preview" aria-hidden="true">
          {activePreset.zones.map((zone) => (
            <span
              key={zone.id}
              className={`terminal-snap-preview-zone ${zone.id === target.zoneId ? 'is-target' : ''}`}
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
    <div className="terminal-snap-preset" aria-label={t(preset.labelKey)}>
      {preset.zones.map((zone) => (
        <button
          key={zone.id}
          type="button"
          className={`terminal-snap-zone ${
            target?.presetId === preset.id && target.zoneId === zone.id ? 'is-active' : ''
          }`}
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

function isPointInsideElement(point: TerminalDragPoint, element: HTMLElement | null) {
  if (!element) {
    return false
  }
  const rect = element.getBoundingClientRect()
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
}
