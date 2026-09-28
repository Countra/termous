import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { getTermousBridge } from '#shared/bridge'
import { NotificationController } from '#features/notifications'
import { notificationTarget, type NotificationGateway, type NotificationKind, type NotificationMessage, type NotificationTarget } from '#entities/notification'
import { NotificationCenter } from '#widgets/notification-center'

export function NotificationControl({ api, enabled, navigate }: {
  api: NotificationGateway
  enabled: boolean
  navigate(target: NotificationTarget): Promise<boolean>
}) {
  const controller = useMemo(() => new NotificationController(api), [api])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<NotificationKind | 'all'>('all')
  const [selected, setSelected] = useState<NotificationMessage | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const mounted = useRef(true)
  const navigatedActivation = useRef<string | null>(null)
  const navigateRef = useRef(navigate)
  useEffect(() => { navigateRef.current = navigate }, [navigate])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { if (enabled) controller.start(); return () => controller.close() }, [controller, enabled])

  const perform = useCallback(async (action: () => Promise<void>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try { await action(); if (mounted.current) setError(false) }
    catch { if (mounted.current) setError(true) }
    finally { pending.current = false; if (mounted.current) setBusy(false) }
  }, [])

  const view = useCallback(async (message: NotificationMessage, current = () => mounted.current) => {
    setSelected(message)
    const found = await navigateRef.current(notificationTarget(message))
    if (!current()) return false
    setUnavailable(!found)
    setOpen(!found)
    return true
  }, [])

  useEffect(() => {
    const bridge = getTermousBridge()?.notifications
    if (!enabled || !bridge) return
    let active = true
    let draining = false
    let again = false
    const drain = async () => {
      if (draining) { again = true; return }
      draining = true
      try {
        do {
          again = false
          const intents = await bridge.pending()
          for (const intent of intents) {
            if (!active) return
            if (navigatedActivation.current !== intent.id) {
              setFilter(intent.target.kind === 'centre' ? intent.target.filter : 'all')
              if (intent.messages.length === 1) {
                setOpen(false)
                if (!await view(intent.messages[0], () => active)) return
              } else {
                setOpen(true)
                setUnavailable(false)
              }
              // 定位与已读交接分开，后者失败重试时不能再次切换页面。
              navigatedActivation.current = intent.id
            }
            await api.read({ ids: intent.messages.map((m) => m.id) })
            if (!active) return
            await bridge.acknowledge(intent.id)
            if (!active) return
            navigatedActivation.current = null
            setError(false)
          }
        } while (again && active)
      } catch { if (active) setError(true) }
      finally { draining = false }
    }
    const stop = bridge.onActivation(() => { void drain() })
    void drain()
    return () => { active = false; stop() }
  }, [api, enabled, view])

  return <NotificationCenter state={state} open={open} filter={filter} selected={selected} unavailable={unavailable} busy={busy} error={error}
    onOpen={setOpen} onFilter={setFilter} onView={(message) => { void perform(async () => { if (await view(message)) await api.read({ ids: [message.id] }) }) }}
    onReadAll={() => { const watermark = state.watermark; void perform(() => api.read({ watermark })) }}
    onClearRead={() => { const watermark = state.watermark; void perform(() => api.dismiss({ watermark })) }}
    onDismiss={(message) => { void perform(() => api.dismiss({ ids: [message.id] })) }} />
}
