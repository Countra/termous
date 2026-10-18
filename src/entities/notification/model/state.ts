import { decodeNotificationEvent, type NotificationEvent, type NotificationMessage } from '#common/contracts'

export interface NotificationState {
  items: NotificationMessage[]
  watermark: number
  unread: number
  connected: boolean
  loaded: boolean
  error: boolean
}
export const emptyNotificationState: NotificationState = { items: [], watermark: 0, unread: 0, connected: false, loaded: false, error: false }

export function mergeNotificationEvent(state: NotificationState, event: NotificationEvent): NotificationState {
  if (event.type === 'snapshot') return { items: event.page.items, watermark: event.page.watermark, unread: event.page.unread_count, connected: true, loaded: true, error: false }
  if (event.message.sequence <= state.watermark) return state
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000
  const items = [event.message, ...state.items.filter((m) => m.id !== event.message.id && Date.parse(m.occurred_at) >= cutoff)].slice(0, 1000)
  return { ...state, items, watermark: event.message.sequence, unread: items.filter((m) => !m.read).length }
}

export { decodeNotificationEvent }
export type { NotificationMessage, NotificationKind, NotificationActivation, NotificationTarget } from '#common/contracts'
export { notificationText, notificationTarget } from '#common/contracts'

export interface NotificationGateway {
  eventsUrl(): string
  read(input: { ids: string[] } | { watermark: number }): Promise<void>
  dismiss(input: { ids: string[] } | { watermark: number }): Promise<void>
}
