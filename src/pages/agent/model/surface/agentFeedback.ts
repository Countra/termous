import type { App as AntdApp } from 'antd'

type NotificationAPI = ReturnType<typeof AntdApp.useApp>['notification']
export interface AgentFeedbackNotice {
  id: string; version: string; kind: 'error' | 'warning' | 'success'; title: string; description?: string
  duration?: number; expiresAt?: number; placement?: 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft' | 'top' | 'bottom'
  showProgress?: boolean; role?: 'alert' | 'status'
}
export interface AgentFeedbackConfirmation { id: string; title: string; content: string; okText?: string; cancelText?: string }
export interface AgentFeedbackSnapshot { notices: AgentFeedbackNotice[]; confirmation?: AgentFeedbackConfirmation }
type ConfirmOptions = { title?: unknown; content?: unknown; okText?: string; cancelText?: string; onOk?: () => void; onCancel?: () => void; afterClose?: () => void; className?: string; centered?: boolean }
export interface AgentFeedback {
  notification: Pick<NotificationAPI, 'error' | 'warning' | 'success'>
  modal: { confirm: (options: ConfirmOptions) => void }
}

export class AgentFeedbackStore implements AgentFeedback {
  private value: AgentFeedbackSnapshot = { notices: [] }
  private readonly listeners = new Set<() => void>()
  private confirmation?: ConfirmOptions
  readonly getSnapshot = () => this.value
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private update(value: AgentFeedbackSnapshot) { this.value = value; for (const listener of this.listeners) listener() }
  private notice(kind: AgentFeedbackNotice['kind'], options: Parameters<NotificationAPI['error']>[0]) {
    const id = options.key === undefined ? crypto.randomUUID() : String(options.key)
    const duration = options.duration === false ? 0 : options.duration ?? undefined
    this.update({
      ...this.value, notices: [...this.value.notices.filter(notice => notice.id !== id).slice(-2), {
        id, version: crypto.randomUUID(), kind, title: String(options.title ?? options.message ?? ''),
        description: options.description === undefined ? undefined : String(options.description),
        duration, expiresAt: duration === 0 ? undefined : Date.now() + (duration ?? 3) * 1000,
        placement: options.placement, showProgress: options.showProgress, role: options.role,
      }]
    })
  }
  readonly notification: AgentFeedback['notification'] = {
    error: options => this.notice('error', options), warning: options => this.notice('warning', options), success: options => this.notice('success', options),
  }
  readonly modal = {
    confirm: (options: ConfirmOptions) => {
      this.cancel()
      this.confirmation = options
      this.update({
        ...this.value, confirmation: {
          id: crypto.randomUUID(), title: String(options.title ?? ''),
          content: String(options.content ?? ''), okText: options.okText, cancelText: options.cancelText
        }
      })
    }
  }
  answer(id: string, accepted: boolean) {
    if (this.value.confirmation?.id !== id) return
    const options = this.confirmation
    this.confirmation = undefined
    this.update({ ...this.value, confirmation: undefined })
    if (accepted) options?.onOk?.(); else options?.onCancel?.()
    options?.afterClose?.()
  }
  dismiss(id: string, version: string) {
    this.update({ ...this.value, notices: this.value.notices.filter(notice => notice.id !== id || notice.version !== version) })
  }
  cancel() { if (this.value.confirmation) this.answer(this.value.confirmation.id, false) }
}
