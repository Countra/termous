import { isDesktopPointerEvent, type DesktopPointerControl, type DesktopPointerEvent } from '#common/contracts'
import type { RemoteDesktopSession } from '#entities/remote-desktop'

export interface AutomationPointerSample { event: DesktopPointerEvent; live: boolean }
export interface AutomationPointerFeed {
  snapshot(): AutomationPointerSample | null
  control(): DesktopPointerControl | null
  subscribe(listener: () => void): () => void
}

// 指针状态独立于 React 会话状态；版本水位在清空后仍保留，防止旧 GET 或迟到事件复活光标。
export class AutomationPointerState implements AutomationPointerFeed {
  readonly sessionId: string
  readonly generation: number
  private value: AutomationPointerSample | null = null
  private revision = 0
  private authority: string | null | undefined
  private online = true
  private expiresAt = Infinity
  private currentControl: DesktopPointerControl | null = null
  private controlFromEvent = false
  private readonly listeners = new Set<() => void>()

  constructor(sessionId: string, generation: number) { this.sessionId = sessionId; this.generation = generation }

  snapshot() {
    if (!this.online || Date.now() >= this.expiresAt || (this.authority !== undefined && this.value?.event.pointer?.automation_id !== this.authority)) return null
    if (this.currentControl && this.value?.event.pointer?.execution_generation !== this.currentControl.execution_generation) return null
    return this.value
  }

  control() { return this.online && Date.now() < this.expiresAt ? this.currentControl : null }

  private setControl(control: DesktopPointerControl | null) {
    this.currentControl = control
    this.authority = control?.automation_id ?? null
    this.expiresAt = control ? Date.parse(control.expires_at) : 0
  }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private notify() { for (const listener of this.listeners) listener() }

  publish(event: DesktopPointerEvent, live = true) {
    if (!isDesktopPointerEvent(event) || event.session_id !== this.sessionId || event.connection_generation !== this.generation || event.revision < this.revision || (event.revision === this.revision && (live || this.value))) return
    if (event.control !== undefined) {
      this.controlFromEvent = true
      this.setControl(event.control)
    }
    this.revision = event.revision
    this.value = { event, live: live && !event.snapshot }
    this.notify()
  }

  reconcile(session: RemoteDesktopSession) {
    if (session.id !== this.sessionId || session.connection_generation !== this.generation) return
    const event: DesktopPointerEvent = { type: 'automation_pointer', session_id: session.id, connection_generation: session.connection_generation,
      revision: session.automation_pointer_revision ?? 0, pointer: session.automation_pointer ?? null, control: session.automation_pointer_control }
    // 迟到 GET 不得推翻更新的视觉清理或授权续期；新 Core 的投影是展示权威。
    if (event.control !== undefined) {
      // 初始空投影允许版本为零；其余快照与实时消息共享校验，先验证再改变在线状态。
      const empty = event.revision === 0 && event.control === null && event.pointer === null
      if (event.revision < this.revision || (!empty && !isDesktopPointerEvent(event))) return
      this.controlFromEvent = true
      this.setControl(event.control)
      if (!['ready', 'streaming'].includes(session.status)) {
        this.revision = event.revision
        this.suspend()
        return
      }
    }
    if (!['ready', 'streaming'].includes(session.status)) { this.suspend(); return }
    this.online = true
    if (event.control === undefined && !this.controlFromEvent) {
      this.authority = session.automation?.id ?? null
      this.expiresAt = session.automation ? Math.min(Date.parse(session.automation.expires_at), Date.parse(session.automation.idle_expires_at)) : 0
    }
    this.publish(event, false)
    this.notify()
  }

  suspend() { this.online = false; this.value = null; this.notify() }
}

export class AutomationPointerStore {
  private readonly sessions = new Map<string, AutomationPointerState>()
  reconcile(sessions: RemoteDesktopSession[]) {
    const ids = new Set(sessions.map(s => s.id))
    for (const id of this.sessions.keys()) if (!ids.has(id)) this.remove(id)
    for (const session of sessions) this.upsert(session)
  }
  upsert(session: RemoteDesktopSession) {
    let state = this.sessions.get(session.id)
    if (state?.generation !== session.connection_generation) {
      state?.suspend()
      state = new AutomationPointerState(session.id, session.connection_generation)
      this.sessions.set(session.id, state)
    }
    state.reconcile(session)
  }
  remove(id: string) { this.sessions.get(id)?.suspend(); this.sessions.delete(id) }
  feed(id: string, generation: number) {
    const state = this.sessions.get(id)
    return state?.generation === generation ? state : undefined
  }
  publish(event: DesktopPointerEvent) { this.sessions.get(event.session_id)?.publish(event) }
  suspend() { for (const state of this.sessions.values()) state.suspend() }
}
