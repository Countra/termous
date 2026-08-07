import type { Session } from '../../../types/domain'

export interface SessionInventoryRequestIdentity {
  sessionId: string
  revision: number
}

export function getSessionInventoryVisibleScope(
  session: Session | null,
  activeTab: string,
  collapsed: boolean,
): string {
  if (
    collapsed ||
    (activeTab !== 'system' && activeTab !== 'monitor') ||
    !session ||
    session.kind !== 'ssh' ||
    session.status !== 'connected'
  ) {
    return ''
  }
  return session.id
}

export function getAutomaticSessionInventoryDemand(
  session: Session | null,
  activeTab: string,
  collapsed: boolean,
): string {
  const sessionId = getSessionInventoryVisibleScope(session, activeTab, collapsed)
  if (!sessionId || (session?.inventory_status ?? 'idle') !== 'idle') {
    return ''
  }
  return sessionId
}

export function canRetrySessionInventory(session: Session | null): boolean {
  return Boolean(
    session &&
      session.kind === 'ssh' &&
      session.status === 'connected' &&
      session.inventory_status === 'failed',
  )
}

export function isSessionInventoryRequestCurrent(
  request: SessionInventoryRequestIdentity,
  current: SessionInventoryRequestIdentity | null,
  visibleSessionId: string,
  aborted: boolean,
): boolean {
  return Boolean(
    !aborted &&
      current &&
      request.sessionId === current.sessionId &&
      request.revision === current.revision &&
      request.sessionId === visibleSessionId,
  )
}
