import { App as AntdApp } from 'antd'
import { useEffect, useRef } from 'react'
import { termousNotificationClassName } from '#shared/ui'
import type { AgentFeedbackSnapshot } from '../model/surface/agentFeedback.ts'

export function AgentSurfaceFeedback({ value, onAnswer, onDismiss }: { value: AgentFeedbackSnapshot; onAnswer: (id: string, accepted: boolean) => void; onDismiss?: (id: string, version: string) => void }) {
  const { notification, modal } = AntdApp.useApp()
  const answer = useRef(onAnswer)
  answer.current = onAnswer
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  const mounted = useRef(false)
  const keys = useRef(new Map<string, string>())
  useEffect(() => {
    mounted.current = true
    const currentKeys = keys.current
    return () => { mounted.current = false; for (const key of currentKeys.keys()) notification.destroy(key); currentKeys.clear() }
  }, [notification])
  const delivered = useRef(new Set<string>())
  useEffect(() => {
    for (const notice of value.notices) {
      if (delivered.current.has(notice.version) || notice.expiresAt !== undefined && notice.expiresAt <= Date.now()) continue
      delivered.current.add(notice.version)
      keys.current.set(notice.id, notice.version)
      notification[notice.kind]({ key: notice.id, title: notice.title, description: notice.description,
        duration: notice.expiresAt === undefined ? notice.duration : Math.max(0.1, (notice.expiresAt - Date.now()) / 1000),
        placement: notice.placement, showProgress: notice.showProgress, role: notice.role, className: termousNotificationClassName,
        onClose: () => {
          if (keys.current.get(notice.id) === notice.version) keys.current.delete(notice.id)
          if (mounted.current) dismiss.current?.(notice.id, notice.version)
        } })
    }
    if (delivered.current.size > 100) delivered.current = new Set(value.notices.map(notice => notice.version))
  }, [notification, value.notices])
  const confirmation = value.confirmation
  const current = useRef(confirmation)
  current.current = confirmation
  useEffect(() => {
    const request = current.current
    if (!request) return
    const dialog = modal.confirm({ centered: true, className: 'termous-modal', title: request.title, content: request.content,
      okText: request.okText, cancelText: request.cancelText,
      onOk: () => answer.current(request.id, true), onCancel: () => answer.current(request.id, false),
      afterClose: () => answer.current(request.id, false) })
    return () => dialog.destroy()
  }, [confirmation?.id, modal])
  return null
}
