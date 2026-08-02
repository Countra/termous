import type { TerminalPromptBoundary } from './terminalProtocol'
import type { TerminalTransportState } from './terminalTransport'

export type TerminalCompletionReadiness =
  | 'disabled'
  | 'waiting_prompt'
  | 'ready'
  | 'unavailable'

export interface TerminalCompletionSessionSnapshot {
  sessionId: string
  readiness: TerminalCompletionReadiness
  boundary: TerminalPromptBoundary | null
}

interface TerminalCompletionSessionState {
  readiness: Exclude<TerminalCompletionReadiness, 'disabled'>
  boundary: TerminalPromptBoundary | null
}

export class TerminalCompletionRuntime {
  private enabled: boolean
  private readonly sessions = new Map<string, TerminalCompletionSessionState>()

  constructor(enabled = true) {
    this.enabled = enabled
  }

  setEnabled(enabled: boolean) {
    if (this.enabled === enabled) {
      return
    }
    this.enabled = enabled
  }

  applyTransportState(sessionId: string, state: TerminalTransportState) {
    if (state === 'disposed' || state === 'ended') {
      this.sessions.delete(sessionId)
      return
    }
    if (state === 'live') {
      const current = this.sessions.get(sessionId)
      this.sessions.set(sessionId, current ?? {
        readiness: 'waiting_prompt',
        boundary: null,
      })
      return
    }
    this.sessions.set(sessionId, {
      readiness: state === 'idle' ? 'waiting_prompt' : 'unavailable',
      boundary: null,
    })
  }

  applyPromptBoundary(sessionId: string, boundary: TerminalPromptBoundary) {
    const current = this.sessions.get(sessionId)
    if (current?.boundary && !canAdvanceBoundary(current.boundary, boundary)) {
      return false
    }
    if (current?.boundary && sameBoundary(current.boundary, boundary)) {
      if (current.readiness !== 'ready') {
        this.sessions.set(sessionId, { readiness: 'ready', boundary: { ...boundary } })
        return true
      }
      return false
    }
    this.sessions.set(sessionId, {
      readiness: 'ready',
      boundary: { ...boundary },
    })
    return true
  }

  invalidateSession(sessionId: string) {
    if (!this.sessions.has(sessionId)) {
      return
    }
    this.sessions.set(sessionId, {
      readiness: 'unavailable',
      boundary: null,
    })
  }

  getSnapshot(sessionId: string): TerminalCompletionSessionSnapshot {
    if (!this.enabled) {
      return { sessionId, readiness: 'disabled', boundary: null }
    }
    const current = this.sessions.get(sessionId)
    if (!current) {
      return { sessionId, readiness: 'waiting_prompt', boundary: null }
    }
    return {
      sessionId,
      readiness: current.readiness,
      boundary: current.boundary ? { ...current.boundary } : null,
    }
  }

  disposeSession(sessionId: string) {
    this.sessions.delete(sessionId)
  }

  clear() {
    this.sessions.clear()
  }
}

function canAdvanceBoundary(
  current: TerminalPromptBoundary,
  next: TerminalPromptBoundary,
) {
  if (next.source_generation !== current.source_generation) {
    return next.source_generation > current.source_generation
  }
  if (next.shell_id !== current.shell_id) {
    // 嵌套 Shell 可令 prompt generation 重置，input epoch 是跨 Shell 的顺序边界。
    return next.input_epoch > current.input_epoch
  }
  if (next.input_epoch < current.input_epoch) {
    return false
  }
  if (next.prompt_generation !== current.prompt_generation) {
    return next.prompt_generation > current.prompt_generation
  }
  return next.input_epoch === current.input_epoch
}

function sameBoundary(left: TerminalPromptBoundary, right: TerminalPromptBoundary) {
  return (
    left.source_generation === right.source_generation
    && left.shell_id === right.shell_id
    && left.prompt_generation === right.prompt_generation
    && left.input_epoch === right.input_epoch
    && left.shell === right.shell
    && left.cwd === right.cwd
  )
}
