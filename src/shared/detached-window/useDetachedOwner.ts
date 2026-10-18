import { useCallback, useEffect, useRef, useState } from 'react'
import type { DetachedAppearance, DetachedConnection, DetachedIdentity, DetachedPacket, DetachedPhase } from '#common/contracts'
import { sameDetachedConnection } from '#common/contracts'
import { getTermousBridge } from '#shared/bridge'
import { DetachedRequestPeer } from './requestPeer.ts'
import { settleDetachedRender } from './settleRender.ts'

export interface DetachedHostAdapter {
  snapshot: () => unknown
  command: (packet: DetachedPacket) => Promise<unknown>
  prepare: () => Promise<void>
  returned: (presentation: unknown) => void
  finishReturn?: () => Promise<void>
  navigate: () => Promise<boolean>
  cancelFeedback: () => void
  retainResponse?: (packet: DetachedPacket) => boolean
}

export function useDetachedOwner(identity: DetachedIdentity, adapter: DetachedHostAdapter, appearance: DetachedAppearance, enabled: boolean) {
  const bridge = enabled ? getTermousBridge()?.detachedWindows : undefined
  const [phase, setPhase] = useState<DetachedPhase>('embedded')
  const [capture, setCapture] = useState<string>()
  const [error, setError] = useState(false)
  const [frozen, setFrozen] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const state = useRef<{ connection?: DetachedConnection; peer?: DetachedRequestPeer; phase: DetachedPhase; restoring?: boolean }>({ phase: 'embedded' })
  const current = useRef({ adapter, appearance })
  current.current = { adapter, appearance }
  const setLifecycle = useCallback((value: DetachedPhase) => { state.current.phase = value; setPhase(value) }, [])
  const reset = useCallback(() => {
    state.current.peer?.dispose()
    state.current = { phase: 'embedded' }
    setPhase('embedded')
    setCapture(undefined)
    setFrozen(false)
    setRestoring(false)
    current.current.adapter.cancelFeedback()
  }, [])

  const returnWindow = useCallback(async (navigate: boolean) => {
    if (!bridge || state.current.phase !== 'detached') return false
    const { connection, peer } = state.current
    if (!connection || !peer) return false
    setError(false)
    setLifecycle('returning')
    try {
      await bridge.reveal()
      if (state.current.connection !== connection) return false
      if (navigate) {
        const accepted = await current.current.adapter.navigate()
        if (state.current.connection !== connection) return false
        if (!accepted) { setLifecycle('detached'); return false }
      }
      const presentation = await peer.request('flush', undefined, 30000)
      if (state.current.connection !== connection) return false
      current.current.adapter.returned(presentation)
      current.current.adapter.cancelFeedback()
      // 交接确认后挂载嵌入视图，退出过渡结束前继续锁定编辑权和重复打开入口。
      state.current.restoring = true
      setRestoring(true)
      await settleDetachedRender()
      await current.current.adapter.finishReturn?.()
      if (state.current.connection !== connection) return false
      await bridge.close(connection)
      if (state.current.connection === connection) reset()
      return true
    } catch {
      if (state.current.connection !== connection) return false
      setError(true)
      state.current.restoring = false
      setRestoring(false)
      setLifecycle('detached')
      bridge.send({ connection, kind: 'state', payload: { handoffFailed: true } })
      return false
    }
  }, [bridge, reset, setLifecycle])

  useEffect(() => {
    if (!bridge) return
    const unsubscribe = bridge.subscribe(packet => {
      const { connection, peer } = state.current
      if (!connection || !peer || !sameDetachedConnection(connection, packet.connection)) return
      if (packet.kind === 'closed') { if (state.current.phase === 'opening') setError(true); reset(); return }
      if (packet.kind === 'return') { void returnWindow(Boolean(packet.payload)); return }
      if (packet.kind === 'ready' && state.current.phase === 'opening') {
        current.current.adapter.cancelFeedback()
        setLifecycle('detached')
        bridge.send({ connection, kind: 'appearance', payload: current.current.appearance })
        bridge.send({ connection, kind: 'ready' })
        return
      }
      peer.accept(packet, async request => {
        if (state.current.connection !== connection) throw new Error('detached_disconnected')
        if (request.operation === 'snapshot') return current.current.adapter.snapshot()
        if (request.operation === 'return') return returnWindow(Boolean(request.payload))
        if (request.operation === 'reveal') { await bridge.reveal(); return }
        if (state.current.restoring || state.current.phase !== 'detached' && state.current.phase !== 'returning') throw new Error('detached_editor_inactive')
        return current.current.adapter.command(request)
      }, packet.operation !== 'snapshot' && (current.current.adapter.retainResponse?.(packet) ?? true))
    })
    return () => {
      unsubscribe()
      const connection = state.current.connection
      reset()
      if (connection) void bridge.close(connection).catch(() => setError(true))
    }
  }, [bridge, reset, returnWindow, setLifecycle])

  useEffect(() => {
    const connection = state.current.connection
    if (bridge && connection) bridge.send({ connection, kind: 'appearance', payload: appearance })
  }, [appearance, bridge])

  const focus = useCallback(async () => {
    if (!bridge || !state.current.connection) return false
    const focusing = state.current
    try {
      const focused = await bridge.focus(identity)
      if (state.current === focusing) setError(!focused)
      return focused
    } catch {
      // 聚焦失败保留当前交接状态；旧窗口的迟到结果不能覆盖新窗口的提示。
      if (state.current === focusing) setError(true)
      return false
    }
  }, [bridge, identity])

  const open = useCallback(async (element: HTMLElement | null) => {
    if (!bridge) return
    if (state.current.phase !== 'embedded') { await focus(); return }
    setError(false)
    setLifecycle('opening')
    const opening = state.current
    try {
      await current.current.adapter.prepare()
      if (state.current !== opening) return
      setFrozen(true)
      await settleDetachedRender()
      if (state.current !== opening) return
      const bounds = element?.getBoundingClientRect()
      const { capture: captured, ...connection } = await bridge.open(identity, bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : undefined)
      // 宿主可能在原生创建窗口期间卸载；迟到窗口必须关闭，不能再初始化。
      if (state.current !== opening) { await bridge.close(connection); return }
      state.current.connection = connection
      state.current.peer = new DetachedRequestPeer(connection, bridge.send)
      setCapture(captured)
      bridge.send({ connection, kind: 'initialize' })
      bridge.send({ connection, kind: 'appearance', payload: current.current.appearance })
    } catch { if (state.current === opening) { reset(); setError(true) } }
  }, [bridge, identity, focus, reset, setLifecycle])

  const publish = useCallback((payload: unknown) => {
    const connection = state.current.connection
    if (bridge && connection) bridge.send({ connection, kind: 'state', payload })
  }, [bridge])
  const reveal = useCallback(() => bridge?.reveal(), [bridge])

  return { phase, capture, error, frozen, restoring, available: !!bridge, open, returnWindow, publish,
    focus, reveal }
}
