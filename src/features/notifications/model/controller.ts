import { emptyNotificationState, mergeNotificationEvent, type NotificationGateway, type NotificationState } from '#entities/notification'
import { NotificationStream } from '#common/notification-stream'

export class NotificationController {
  private state: NotificationState = emptyNotificationState
  private listeners = new Set<() => void>()
  private stream: NotificationStream
  readonly api: NotificationGateway
  constructor(api: NotificationGateway) {
    this.api = api
    this.stream = new NotificationStream({
      url: () => this.api.eventsUrl(),
      receive: (event) => this.commit(mergeNotificationEvent(this.state, event)),
      disconnected: () => this.commit({ ...this.state, connected: false, error: true }),
    })
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private commit(next: NotificationState) { this.state = next; for (const listener of this.listeners) listener() }
  start() { void this.stream.start() }
  close() {
    this.stream.close()
    this.commit({ ...this.state, connected: false })
  }
}
