export type TerminalSplitDirection = 'horizontal' | 'vertical'

export type TerminalSplitPresetId =
  | 'two-columns'
  | 'two-rows'
  | 'main-left'
  | 'main-right'
  | 'three-columns'
  | 'left-main-right-stack'
  | 'right-main-left-stack'
  | 'grid-2x2'
  | 'focus'

export interface TerminalSplitRect {
  x: number
  y: number
  width: number
  height: number
}

export interface TerminalSplitPresetZone {
  id: string
  rect: TerminalSplitRect
}

export interface TerminalSplitPreset {
  id: TerminalSplitPresetId
  labelKey: string
  paneCount: number
  zones: TerminalSplitPresetZone[]
}

export interface TerminalPaneLeaf {
  type: 'leaf'
  id: string
  sessionId: string | null
}

export interface TerminalSplitBranch {
  type: 'split'
  id: string
  direction: TerminalSplitDirection
  children: TerminalSplitNode[]
  sizes: number[]
}

export type TerminalSplitNode = TerminalPaneLeaf | TerminalSplitBranch

export interface TerminalSplitLayout {
  root: TerminalSplitNode | null
  activePaneId: string | null
}

export const TERMINAL_SPLIT_MAX_PANES = 4

export const terminalSplitPresets: TerminalSplitPreset[] = [
  {
    id: 'two-columns',
    labelKey: 'workbench.split.presets.twoColumns',
    paneCount: 2,
    zones: [
      { id: 'left', rect: { x: 0, y: 0, width: 50, height: 100 } },
      { id: 'right', rect: { x: 50, y: 0, width: 50, height: 100 } },
    ],
  },
  {
    id: 'two-rows',
    labelKey: 'workbench.split.presets.twoRows',
    paneCount: 2,
    zones: [
      { id: 'top', rect: { x: 0, y: 0, width: 100, height: 50 } },
      { id: 'bottom', rect: { x: 0, y: 50, width: 100, height: 50 } },
    ],
  },
  {
    id: 'main-left',
    labelKey: 'workbench.split.presets.mainLeft',
    paneCount: 2,
    zones: [
      { id: 'main', rect: { x: 0, y: 0, width: 66, height: 100 } },
      { id: 'side', rect: { x: 66, y: 0, width: 34, height: 100 } },
    ],
  },
  {
    id: 'main-right',
    labelKey: 'workbench.split.presets.mainRight',
    paneCount: 2,
    zones: [
      { id: 'side', rect: { x: 0, y: 0, width: 34, height: 100 } },
      { id: 'main', rect: { x: 34, y: 0, width: 66, height: 100 } },
    ],
  },
  {
    id: 'three-columns',
    labelKey: 'workbench.split.presets.threeColumns',
    paneCount: 3,
    zones: [
      { id: 'left', rect: { x: 0, y: 0, width: 33.33, height: 100 } },
      { id: 'center', rect: { x: 33.33, y: 0, width: 33.34, height: 100 } },
      { id: 'right', rect: { x: 66.67, y: 0, width: 33.33, height: 100 } },
    ],
  },
  {
    id: 'left-main-right-stack',
    labelKey: 'workbench.split.presets.leftMainRightStack',
    paneCount: 3,
    zones: [
      { id: 'main', rect: { x: 0, y: 0, width: 66, height: 100 } },
      { id: 'right-top', rect: { x: 66, y: 0, width: 34, height: 50 } },
      { id: 'right-bottom', rect: { x: 66, y: 50, width: 34, height: 50 } },
    ],
  },
  {
    id: 'right-main-left-stack',
    labelKey: 'workbench.split.presets.rightMainLeftStack',
    paneCount: 3,
    zones: [
      { id: 'left-top', rect: { x: 0, y: 0, width: 34, height: 50 } },
      { id: 'left-bottom', rect: { x: 0, y: 50, width: 34, height: 50 } },
      { id: 'main', rect: { x: 34, y: 0, width: 66, height: 100 } },
    ],
  },
  {
    id: 'grid-2x2',
    labelKey: 'workbench.split.presets.grid2x2',
    paneCount: 4,
    zones: [
      { id: 'top-left', rect: { x: 0, y: 0, width: 50, height: 50 } },
      { id: 'top-right', rect: { x: 50, y: 0, width: 50, height: 50 } },
      { id: 'bottom-left', rect: { x: 0, y: 50, width: 50, height: 50 } },
      { id: 'bottom-right', rect: { x: 50, y: 50, width: 50, height: 50 } },
    ],
  },
  {
    id: 'focus',
    labelKey: 'workbench.split.presets.focus',
    paneCount: 1,
    zones: [
      { id: 'main', rect: { x: 0, y: 0, width: 100, height: 100 } },
    ],
  },
]

export function createSingleTerminalLayout(sessionId: string | null, paneId = 'terminal-pane-0'): TerminalSplitLayout {
  return {
    root: { type: 'leaf', id: paneId, sessionId },
    activePaneId: sessionId ? paneId : null,
  }
}

export function getTerminalSplitPreset(presetId: TerminalSplitPresetId) {
  return terminalSplitPresets.find((preset) => preset.id === presetId)
}

export function getTerminalPaneLeaves(node: TerminalSplitNode | null): TerminalPaneLeaf[] {
  if (!node) {
    return []
  }
  if (node.type === 'leaf') {
    return [node]
  }
  return node.children.flatMap(getTerminalPaneLeaves)
}

export function countTerminalPanes(node: TerminalSplitNode | null) {
  return getTerminalPaneLeaves(node).length
}

export function canAddTerminalPane(layout: TerminalSplitLayout | null) {
  return countTerminalPanes(layout?.root ?? null) < TERMINAL_SPLIT_MAX_PANES
}

export function findTerminalPaneBySession(node: TerminalSplitNode | null, sessionId: string) {
  return getTerminalPaneLeaves(node).find((leaf) => leaf.sessionId === sessionId) ?? null
}

export function replaceTerminalPaneSession(node: TerminalSplitNode, paneId: string, sessionId: string | null): TerminalSplitNode {
  if (node.type === 'leaf') {
    return node.id === paneId ? { ...node, sessionId } : node
  }
  return {
    ...node,
    children: node.children.map((child) => replaceTerminalPaneSession(child, paneId, sessionId)),
  }
}

export function createPresetTerminalLayout(
  presetId: TerminalSplitPresetId,
  sessionIds: Array<string | null>,
): TerminalSplitLayout {
  const preset = getTerminalSplitPreset(presetId)
  if (!preset) {
    return createSingleTerminalLayout(sessionIds[0] ?? null)
  }
  const normalizedSessions = preset.zones.map((_, index) => sessionIds[index] ?? null)
  const root = buildPresetNode(presetId, normalizedSessions)
  const firstActive = getTerminalPaneLeaves(root).find((leaf) => leaf.sessionId)?.id ?? null
  return { root, activePaneId: firstActive }
}

export function compactTerminalSplitLayout(
  layout: TerminalSplitLayout,
  allowedSessionIds: string[],
  options: { preserveEmptyPanes?: boolean } = {},
): TerminalSplitLayout {
  const allowed = new Set(allowedSessionIds)
  const root = compactNode(layout.root, allowed, Boolean(options.preserveEmptyPanes))
  const leaves = getTerminalPaneLeaves(root)
  const activePaneExists = Boolean(leaves.find((leaf) => leaf.id === layout.activePaneId && leaf.sessionId))
  return {
    root,
    activePaneId: activePaneExists ? layout.activePaneId : leaves.find((leaf) => leaf.sessionId)?.id ?? null,
  }
}

export function updateTerminalSplitBranchSizes(
  node: TerminalSplitNode,
  branchId: string,
  sizes: number[],
): TerminalSplitNode {
  if (node.type === 'leaf') {
    return node
  }
  if (node.id === branchId) {
    return { ...node, sizes: normalizePanelSizes(node.children.length, sizes) }
  }
  return {
    ...node,
    children: node.children.map((child) => updateTerminalSplitBranchSizes(child, branchId, sizes)),
  }
}

export function createDropSessionOrder(
  layout: TerminalSplitLayout,
  draggedSessionId: string,
  targetZoneId: string,
  preset: TerminalSplitPreset,
) {
  const existingSessionIds = getTerminalPaneLeaves(layout.root)
    .map((leaf) => leaf.sessionId)
    .filter((sessionId): sessionId is string => Boolean(sessionId && sessionId !== draggedSessionId))
  const targetIndex = Math.max(0, preset.zones.findIndex((zone) => zone.id === targetZoneId))
  const next: Array<string | null> = new Array(preset.paneCount).fill(null)
  next[targetIndex] = draggedSessionId
  for (const sessionId of existingSessionIds) {
    const emptyIndex = next.findIndex((value) => !value)
    if (emptyIndex < 0) {
      break
    }
    next[emptyIndex] = sessionId
  }
  return next
}

function buildPresetNode(presetId: TerminalSplitPresetId, sessionIds: Array<string | null>): TerminalSplitNode {
  const leaf = (index: number): TerminalPaneLeaf => ({
    type: 'leaf',
    id: `terminal-pane-${index}`,
    sessionId: sessionIds[index] ?? null,
  })
  switch (presetId) {
    case 'focus':
      return leaf(0)
    case 'two-rows':
      return split('terminal-split-root', 'vertical', [leaf(0), leaf(1)], [50, 50])
    case 'main-left':
      return split('terminal-split-root', 'horizontal', [leaf(0), leaf(1)], [66, 34])
    case 'main-right':
      return split('terminal-split-root', 'horizontal', [leaf(0), leaf(1)], [34, 66])
    case 'three-columns':
      return split('terminal-split-root', 'horizontal', [leaf(0), leaf(1), leaf(2)], [33.33, 33.34, 33.33])
    case 'left-main-right-stack':
      return split('terminal-split-root', 'horizontal', [
        leaf(0),
        split('terminal-split-right-stack', 'vertical', [leaf(1), leaf(2)], [50, 50]),
      ], [66, 34])
    case 'right-main-left-stack':
      return split('terminal-split-root', 'horizontal', [
        split('terminal-split-left-stack', 'vertical', [leaf(0), leaf(1)], [50, 50]),
        leaf(2),
      ], [34, 66])
    case 'grid-2x2':
      return split('terminal-split-root', 'horizontal', [
        split('terminal-split-left-grid', 'vertical', [leaf(0), leaf(2)], [50, 50]),
        split('terminal-split-right-grid', 'vertical', [leaf(1), leaf(3)], [50, 50]),
      ], [50, 50])
    case 'two-columns':
    default:
      return split('terminal-split-root', 'horizontal', [leaf(0), leaf(1)], [50, 50])
  }
}

function split(id: string, direction: TerminalSplitDirection, children: TerminalSplitNode[], sizes: number[]): TerminalSplitBranch {
  return { type: 'split', id, direction, children, sizes }
}

function compactNode(node: TerminalSplitNode | null, allowed: Set<string>, preserveEmptyPanes: boolean): TerminalSplitNode | null {
  if (!node) {
    return null
  }
  if (node.type === 'leaf') {
    if (!node.sessionId) {
      return preserveEmptyPanes ? node : null
    }
    return allowed.has(node.sessionId) ? node : preserveEmptyPanes ? { ...node, sessionId: null } : null
  }
  const children = node.children
    .map((child) => compactNode(child, allowed, preserveEmptyPanes))
    .filter((child): child is TerminalSplitNode => Boolean(child))
  if (children.length === 0) {
    return null
  }
  if (children.length === 1) {
    return children[0]
  }
  return {
    ...node,
    children,
    sizes: normalizePanelSizes(children.length, node.sizes),
  }
}

function normalizePanelSizes(count: number, sizes: number[]) {
  const next = sizes.slice(0, count)
  while (next.length < count) {
    next.push(100 / count)
  }
  const total = next.reduce((sum, size) => sum + size, 0)
  return total > 0 ? next.map((size) => (size / total) * 100) : new Array(count).fill(100 / count)
}
