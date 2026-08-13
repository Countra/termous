import type { FitAddon } from '@xterm/addon-fit'
import type { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import type { TerminalSearchResult } from '../model/terminalSearch'
import type { TerminalInputLock } from '../model/terminalProtocol'
import type {
  TerminalTransport,
  TerminalTransportState,
} from '../model/terminalTransport'

export interface CompletionPromptAnchor {
  sourceGeneration: number
  shellId: string
  promptGeneration: number
  inputEpoch: number
  cursorX: number
  cursorY: number
}

export interface TerminalEntry {
  sessionId: string
  terminal: Terminal
  fit: FitAddon
  search: SearchAddon
  searchResult: TerminalSearchResult
  searchDecorationKey: string
  transport: TerminalTransport
  transportState: TerminalTransportState
  container: HTMLDivElement
  disposables: Array<{ dispose: () => void }>
  lastSize: { cols: number; rows: number }
  resizeFrame: number | null
  resizeTimer: number | null
  suppressCompletionInput: boolean
  inputLock: TerminalInputLock
  completionPromptAnchor: CompletionPromptAnchor | null
  disposed: boolean
}
