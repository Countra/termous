import type { SessionKind, SessionStatus } from '#entities/session'

export interface TerminalCompletionViewportContext {
  sessionId: string | null
  sessionKind?: SessionKind
  sessionStatus?: SessionStatus
  paneActive: boolean
  workspaceActive: boolean
  searchOpen: boolean
  contextMenuOpen: boolean
}

export interface TerminalCompletionActivityTransition {
  changed: boolean
  active: boolean
  closeSessionId: string | null
}

export function shouldActivateTerminalCompletionViewport(
  context: TerminalCompletionViewportContext,
): boolean {
  return Boolean(
    context.sessionId
    && context.sessionKind === 'ssh'
    && context.sessionStatus === 'connected'
    && context.paneActive
    && context.workspaceActive
    && !context.searchOpen
    && !context.contextMenuOpen,
  )
}

export function transitionTerminalCompletionActivity(
  viewportSessionId: string | null,
  currentActive: boolean,
  requestedSessionId: string | null,
  requestedActive: boolean,
): TerminalCompletionActivityTransition {
  if (viewportSessionId !== requestedSessionId || currentActive === requestedActive) {
    return {
      changed: false,
      active: currentActive,
      closeSessionId: null,
    }
  }

  return {
    changed: true,
    active: requestedActive,
    closeSessionId: !requestedActive ? requestedSessionId : null,
  }
}
