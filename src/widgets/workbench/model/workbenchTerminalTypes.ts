import type { TerminalDragPoint, TerminalSearchResult } from '#features/terminal'

export interface WorkbenchTerminalSearchState {
  open: boolean
  sessionId: string | null
  query: string
  caseSensitive: boolean
  regex: boolean
  result: TerminalSearchResult
}

export interface WorkbenchTerminalTabDragState {
  sessionId: string
  start: TerminalDragPoint
  point: TerminalDragPoint
  dragging: boolean
}
