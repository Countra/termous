import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import type { RuntimeResourceBinding } from '../../contracts/resourceBindings.ts'
import { isRecord } from '../../contracts/validation.ts'
import { boundObservationTarget, desktopBindingKey, observationTarget, observationTargetKey, type DesktopObservationState, type ObservationTarget } from '../../contracts/desktopObservation.ts'

interface DesktopContextSnapshot {
  version: 1
  session_id: string
  core_instance_id: string
  binding: string
  target: ObservationTarget | null
  attachment_id?: string
}

// 此状态只提供待复验的目标线索；有效附着和授权仍由本轮准备层与 Core 持有。
export class DesktopObservationContext implements DesktopObservationState {
  private target: ObservationTarget | null = null
  private attachmentID?: string
  private observationReady = false
  private readonly replacedAttachments = new Set<string>()
  private readonly sessionID: string
  private readonly coreID: string
  private readonly bindings: readonly RuntimeResourceBinding[]
  constructor(sessionID: string, coreID: string, bindings: readonly RuntimeResourceBinding[] = []) {
    this.sessionID = sessionID; this.coreID = coreID; this.bindings = bindings
  }

  current() { return this.target ? structuredClone(this.target) : undefined }
  selected() { return boundObservationTarget(this.bindings) ?? this.current() }

  observe(name: string, args: Record<string, unknown>, data: Record<string, unknown>) {
    if (!name.startsWith('termous.desktops.') || data.error) return
    if (data.completed === true && (name === 'termous.desktops.detach' && args.attachment_id === this.attachmentID
      || name === 'termous.desktops.close' && this.target?.kind === 'protocol_session' && args.session_id === this.target.session_id
        && (args.connection_generation === undefined || args.connection_generation === this.target.connection_generation))) {
      this.clear(); return
    }
    const attachment = isRecord(data.control) ? data.control.attachment : data.attachment
    const capture = isRecord(data.capture) ? data.capture : undefined
    const session = isRecord(data.session) ? data.session : undefined
    const observed = isRecord(attachment) && ['ready', 'preparing', 'waiting_user_action', 'failed'].includes(String(attachment.state)) ? attachment : undefined
    const target = observationTarget(observed?.target) ?? observationTarget(observed)
      ?? observationTarget(capture?.target) ?? observationTarget(isRecord(capture?.metadata) ? capture.metadata.target : undefined)
      ?? (session && ['ready', 'streaming'].includes(String(session.status)) ? observationTarget({ ...session, session_id: session.id }) : undefined)
    if (!target) return
    const requested = observationTarget(args.target) ?? observationTarget(args)
    if (requested && observationTargetKey(requested) !== observationTargetKey(target)
      || observed && args.attachment_id !== undefined && args.attachment_id !== observed.id
      || session && args.session_id !== undefined && args.session_id !== session.id) return
    const bound = boundObservationTarget(this.bindings)
    if (bound && observationTargetKey(bound) !== observationTargetKey(target)) return
    const profile = this.bindings.find(value => value.kind === 'desktop_profile')
    if (profile && (target.kind !== 'protocol_session' || session && session.profile_id !== profile.desktop_profile_id)) return
    // 准备中的成功附着已确认目标身份，但并未授予输入权限；失败切换只清除旧目标，不能恢复旧屏幕。
    if (observed?.state === 'failed') {
      if (name === 'termous.desktops.attach' && this.target && observationTargetKey(this.target) !== observationTargetKey(target)) this.clear()
      return
    }
    if (!this.target || observationTargetKey(this.target) !== observationTargetKey(target)) {
      this.attachmentID = undefined; this.replacedAttachments.clear(); this.observationReady = false
    }
    this.target = target
    const id = observed?.id ?? (capture ? args.attachment_id : undefined)
    if (typeof id === 'string' && id.length <= 256) {
      if (this.attachmentID && this.attachmentID !== id) this.replacedAttachments.add(this.attachmentID)
      this.attachmentID = id
      this.observationReady = observed?.state === 'ready' || capture !== undefined
      if (this.replacedAttachments.size > 16) this.replacedAttachments.delete(this.replacedAttachments.values().next().value!)
    }
  }

  clear() { this.target = null; this.attachmentID = undefined; this.observationReady = false; this.replacedAttachments.clear() }
  takeReplacedAttachments() {
    if (!this.observationReady) return []
    const values = [...this.replacedAttachments]; this.replacedAttachments.clear(); return values
  }

  snapshot(): DesktopContextSnapshot {
    // 替代附着尚未就绪时保留待解决的旧诊断关联；此 ID 不能恢复路由或授权。
    const diagnosticID = !this.observationReady && this.replacedAttachments.size ? this.replacedAttachments.values().next().value : this.attachmentID
    return { version: 1, session_id: this.sessionID, core_instance_id: this.coreID, binding: desktopBindingKey(this.bindings),
      target: this.target ? structuredClone(this.target) : null, ...(diagnosticID ? { attachment_id: diagnosticID } : {}) }
  }

  restore(value: unknown) {
    this.clear()
    if (!isRecord(value) || JSON.stringify(value).length > 8192 || value.version !== 1 || value.session_id !== this.sessionID
      || value.core_instance_id !== this.coreID || value.binding !== desktopBindingKey(this.bindings)) return false
    const target = value.target === null ? null : observationTarget(value.target)
    if (target === undefined || value.attachment_id !== undefined && (typeof value.attachment_id !== 'string' || value.attachment_id.length > 256)) return false
    const bound = boundObservationTarget(this.bindings)
    if (bound && target && observationTargetKey(bound) !== observationTargetKey(target)) return false
    this.target = target
    this.attachmentID = typeof value.attachment_id === 'string' ? value.attachment_id : undefined
    return true
  }

  project(result: AgentToolResult<unknown>): AgentToolResult<unknown> {
    // 随既有工具回执落盘，覆盖尚未发生压缩的中断场景；不新增事件、授权或图片内容。
    return { ...result, content: [...result.content, { type: 'text', text: JSON.stringify({ termous_desktop_context: this.snapshot() }) }] }
  }

  summary(availability: 'available' | 'deferred' | 'unavailable' = 'available') {
    const target = this.selected()
    const guidance = availability === 'available'
      ? 'To observe this target, call termous.desktops.capture({}); the runtime verifies it and prepares a current attachment.'
      : availability === 'deferred' ? 'The observation declaration is not loaded. Use discover_tools({"names":["termous.desktops.capture"]}) and inspect availability before observing.'
        : 'Desktop observation is unavailable under current permissions. Explain the missing capability; do not substitute another action.'
    return target ? `[TERMOUS_DESKTOP_CONTEXT] Previous target only, not a current attachment or control grant: ${JSON.stringify(target)}. ${guidance} Do not query an attachment from an earlier run to restore it. Input follows existing approval. [/TERMOUS_DESKTOP_CONTEXT]` : ''
  }
}
