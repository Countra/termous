import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { App } from 'antd'
import type { NotificationArgsProps } from 'antd'
import { useTranslation } from 'react-i18next'
import { termousNotificationClassName } from './notificationStyles'

const FeedbackContext = createContext({ active: true, scope: 'app' })

export function FeedbackMessageScope({ active = true, scope, children }: { active?: boolean; scope?: string; children: ReactNode }) {
  const parent = useContext(FeedbackContext)
  return <FeedbackContext value={{ active: parent.active && active, scope: scope ?? parent.scope }}>{children}</FeedbackContext>
}

interface Props {
  type: 'error' | 'warning' | 'info' | 'success'
  title: string
  description?: ReactNode
  action?: ReactNode
  onClose?: () => void
}

type Notification = ReturnType<typeof App.useApp>['notification']
interface Owner { options: NotificationArgsProps; onClose?: () => void }
interface Notice { owners: Map<symbol, Owner>; dismissed: boolean }
const notices = new WeakMap<Notification, Map<string, Notice>>()

function display(notification: Notification, key: string, notice: Notice) {
  if (notice.dismissed) return
  const owners = [...notice.owners.values()].reverse()
  // 同一失败可能同时由页面和操作弹窗捕获，优先保留带重试入口的消息。
  const owner = owners.find(value => value.options.actions) ?? owners.find(value => value.options.description) ?? owners[0]
  if (!owner) return
  notification.open({ ...owner.options, key, onClose: () => {
    notice.dismissed = true
    for (const value of notice.owners.values()) value.onClose?.()
  } })
}

// 消息脱离页面布局，但仍归属原页面：隐藏、账号切换或错误解除时移除。
export function FeedbackMessage({ type, title, description, action, onClose }: Props) {
  const { notification } = App.useApp()
  const { t } = useTranslation()
  const { active, scope } = useContext(FeedbackContext)
  const owner = useRef<Owner>({ options: {} })
  const token = useRef(Symbol('feedback'))
  const key = JSON.stringify(['feedback', scope, title])

  useEffect(() => {
    owner.current.options = {
      type, title, description, actions: action ? <span onClickCapture={event => {
        const notice = notices.get(notification)?.get(key)
        if (!notice?.owners.has(token.current) || notice.dismissed) { event.preventDefault(); event.stopPropagation() }
      }}>{action}</span> : undefined, placement: 'bottomRight',
      className: termousNotificationClassName,
      closable: { 'aria-label': t('app.close') },
      duration: type === 'error' || type === 'warning' || action ? 0 : 5,
      showProgress: type === 'success' || type === 'info',
      role: type === 'error' || type === 'warning' ? 'alert' : 'status',
    }
    owner.current.onClose = onClose
    const notice = notices.get(notification)?.get(key)
    if (active && notice?.owners.has(token.current)) display(notification, key, notice)
  }, [notification, key, active, type, title, description, action, onClose, t])

  useEffect(() => {
    if (!active) return
    let registry = notices.get(notification)
    if (!registry) { registry = new Map(); notices.set(notification, registry) }
    let notice = registry.get(key)
    if (!notice) { notice = { owners: new Map(), dismissed: false }; registry.set(key, notice) }
    const id = token.current
    notice.owners.set(id, owner.current)
    display(notification, key, notice)
    return () => {
      notice.owners.delete(id)
      if (notice.owners.size) display(notification, key, notice)
      else { registry.delete(key); notification.destroy(key) }
    }
  }, [notification, key, active])
  return null
}
