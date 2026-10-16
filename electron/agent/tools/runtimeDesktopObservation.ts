import { isRecord } from '../contracts/validation.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'

export type ExecutionValues = Record<string, string | number | boolean>

export function desktopAttachment(data: Record<string, unknown>) {
  const value = isRecord(data.control) && isRecord(data.control.attachment) ? data.control.attachment : data.attachment
  return isRecord(value) ? value : undefined
}

export function desktopGrantCurrent(attachment: Record<string, unknown>, now: number) {
  const grant = attachment.grant
  return attachment.state === 'ready' && isRecord(grant) && typeof grant.id === 'string' && grant.id.length > 0
    && ['expires_at', 'idle_expires_at'].every((key) => typeof grant[key] === 'string' && Date.parse(grant[key]) > now)
}

// 仅归一化桌面协议规定的结构；不从任意工具正文识别控制权或恢复指令。
export function desktopObservation(name: string, data: Record<string, unknown>, args: unknown, failed: boolean, now: number): ExecutionValues | undefined {
  if (!name.startsWith('termous.desktops.')) return undefined
  const attachment = desktopAttachment(data)
  if (attachment && typeof attachment.id === 'string') {
    const confirmed = !['failed', 'waiting'].includes(runtimeToolOutcome(name, data, failed)) && attachment.state === 'ready'
    const values: ExecutionValues = { attachment_id: attachment.id,
      grant_status: confirmed && desktopGrantCurrent(attachment, now) ? 'held'
        : confirmed && attachment.grant == null ? 'not_held' : 'needs_verification' }
    for (const field of ['session_id', 'connection_generation', 'execution_generation', 'state'] as const) {
      const value = attachment[field]
      if (typeof value === 'string' && value.length <= 128 || typeof value === 'number' && Number.isSafeInteger(value)) values[field] = value
    }
    if (isRecord(attachment.grant)) {
      for (const [key, field] of [['id', 'grant_id'], ['expires_at', 'grant_expires_at'], ['idle_expires_at', 'grant_idle_expires_at']] as const) {
        const value = attachment.grant[key]
        if (typeof value === 'string' && value.length <= 128) values[field] = value
      }
    }
    return values
  }
  // 会话查询也能证明旧连接或执行入口已失效，但不能据此授予任何附着控制权。
  if (['termous.desktops.get', 'termous.desktops.connect'].includes(name) && isRecord(data.session) && typeof data.session.id === 'string') {
    const session = data.session
    const values: ExecutionValues = { session_id: String(session.id) }
    for (const field of ['status', 'connection_generation'] as const) {
      const value = session[field]
      if (typeof value === 'string' && value.length <= 128 || typeof value === 'number' && Number.isSafeInteger(value)) values[field] = value
    }
    if (isRecord(session.desktop) && typeof session.desktop.execution_generation === 'number' && Number.isSafeInteger(session.desktop.execution_generation)) {
      values.execution_generation = session.desktop.execution_generation
    }
    return values
  }
  if (name === 'termous.desktops.get' && isRecord(args) && typeof args.session_id === 'string'
    && isRecord(data.error) && data.error.code === 'REMOTE_DESKTOP_SESSION_NOT_FOUND') return { session_id: args.session_id, status: 'not_found' }
  if (!isRecord(args) || typeof args.attachment_id !== 'string') return undefined
  const released = !failed && data.completed === true && (name === 'termous.desktops.control.release' || name === 'termous.desktops.detach')
  const code = isRecord(data.error) ? String(data.error.code) : ''
  const invalid = ['desktop_control_stale', 'desktop_generation_stale', 'desktop_cleanup_uncertain', 'desktop_not_found'].includes(code)
  const operation = isRecord(data.operation) ? data.operation : undefined
  if (!released && !invalid && !operation) return undefined
  return { attachment_id: args.attachment_id, ...(released || invalid ? { grant_status: released ? 'released' : 'needs_verification' } : {}),
    ...(typeof operation?.client_request_id === 'string' ? { operation_id: operation.client_request_id } : {}),
    ...(typeof operation?.state === 'string' ? { operation_state: operation.state } : {}),
    ...(typeof args.grant_id === 'string' ? { grant_id: args.grant_id } : {}) }
}

// 过期判断仅改变提示，不成为本地权限门禁；实际权限仍由 Core 在调用时检查。
export function projectDesktopEvidence(values: ExecutionValues, historical: boolean, now: number): ExecutionValues {
  if (!values.grant_status) return values
  const expired = ['grant_expires_at', 'grant_idle_expires_at'].some((key) => typeof values[key] === 'string' && Date.parse(values[key]) <= now)
  return { ...values, grant_status: historical && ['held', 'not_held'].includes(String(values.grant_status))
    || values.grant_status === 'held' && expired ? 'needs_verification' : values.grant_status }
}

// 就绪回执用于关联同一附着的查询诊断；控制授权仍需独立核验。
export function confirmedDesktopAttachment(name: string, data: Record<string, unknown>) {
  if (!['termous.desktops.get', 'termous.desktops.control.acquire'].includes(name)
    || ['failed', 'pending', 'waiting'].includes(runtimeToolOutcome(name, data))) return undefined
  const attachment = desktopAttachment(data)
  return attachment?.state === 'ready' && typeof attachment.id === 'string' ? attachment : undefined
}

// 审批完成后可能没有可用授权；这样的申请回执不能消除先前的控制冲突。
export function desktopControlUnconfirmed(name: string, data: Record<string, unknown>, now: number) {
  if (name !== 'termous.desktops.control.acquire') return false
  const attachment = confirmedDesktopAttachment(name, data)
  return !attachment || !desktopGrantCurrent(attachment, now)
}
