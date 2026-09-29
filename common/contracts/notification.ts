export type NotificationKind = 'agent' | 'file' | 'approval' | 'cloud'
export type NotificationOutcome = 'success' | 'failed' | 'partial' | 'uncertain' | 'attention'

export interface NotificationMessage {
  id: string
  sequence: number
  kind: NotificationKind
  outcome: NotificationOutcome
  occurred_at: string
  source_id: string
  session_id?: string
  session_title?: string
  preview?: string
  source_name?: string
  target_count?: number
  expires_at?: string
  operation: string
  name?: string
  completed_files: number
  total_files: number
  skipped_items: number
  transferred_bytes?: number
  total_bytes?: number
  native_eligible: boolean
  read: boolean
}

export interface NotificationPage {
  items: NotificationMessage[]
  watermark: number
  unread_count: number
  next_before: number
}

export type NotificationEvent =
  | { type: 'snapshot'; page: NotificationPage }
  | { type: 'upsert'; message: NotificationMessage }

export type NotificationTarget =
  | { kind: 'agent'; session_id: string }
  | { kind: 'transfer'; transfer_id: string }
  | { kind: 'approval'; approval_id: string }
  | { kind: 'cloud'; binding_id: string; tab: 'sync' | 'devices' | 'security' }
  | { kind: 'centre'; filter: NotificationKind }

export interface NotificationActivation {
  id: string
  target: NotificationTarget
  messages: NotificationMessage[]
}

export interface NotificationPreferences { enabled: boolean; agent: boolean; file: boolean; approval: boolean; cloud: boolean }
export interface NotificationCapabilities {
  supported: boolean
  preferences: NotificationPreferences
}

export interface NotificationBridge {
  pending(): Promise<NotificationActivation[]>
  acknowledge(id: string): Promise<void>
  onActivation(callback: () => void): () => void
}

export const notificationIPCChannels = {
  pending: 'notifications:pending', acknowledge: 'notifications:acknowledge',
  activation: 'notifications:activation',
} as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NOTIFICATION_INVALID')
  return value as Record<string, unknown>
}
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('NOTIFICATION_INVALID')
  return value
}
function text(value: unknown, max = 256): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('NOTIFICATION_INVALID')
  return value
}
function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('NOTIFICATION_INVALID')
  return value
}
function summary(value: unknown, max: number): string {
  const result = text(value, max * 2)
  if (Array.from(result).length > max || /[\p{Cc}\p{Cf}]/u.test(result)) throw new Error('NOTIFICATION_INVALID')
  return result
}
export function decodeNotification(value: unknown): NotificationMessage {
  const r = record(value)
  if (r.kind !== 'agent' && r.kind !== 'file' && r.kind !== 'approval' && r.kind !== 'cloud') throw new Error('NOTIFICATION_INVALID')
  if (r.outcome !== 'success' && r.outcome !== 'failed' && r.outcome !== 'partial' && r.outcome !== 'uncertain' && r.outcome !== 'attention') throw new Error('NOTIFICATION_INVALID')
  if ((r.kind === 'approval' && r.outcome !== 'attention') || (r.kind !== 'approval' && r.kind !== 'cloud' && r.outcome === 'attention')) throw new Error('NOTIFICATION_INVALID')
  const occurred = text(r.occurred_at)
  if (!Number.isFinite(Date.parse(occurred))) throw new Error('NOTIFICATION_INVALID')
  const id = text(r.id), source = text(r.source_id, 128)
  if (!id || !source) throw new Error('NOTIFICATION_INVALID')
  const expires = r.expires_at === undefined ? undefined : text(r.expires_at)
  if ((expires !== undefined && !Number.isFinite(Date.parse(expires))) || (r.kind === 'approval' && (!expires || Date.parse(expires) <= Date.parse(occurred)))) throw new Error('NOTIFICATION_INVALID')
  return {
    id, source_id: source, kind: r.kind, outcome: r.outcome, occurred_at: occurred,
    sequence: integer(r.sequence), operation: text(r.operation),
    ...(r.session_id === undefined ? {} : { session_id: text(r.session_id, 128) }),
    ...(r.name === undefined ? {} : { name: text(r.name) }),
    ...(r.session_title === undefined ? {} : { session_title: summary(r.session_title, 80) }),
    ...(r.preview === undefined ? {} : { preview: summary(r.preview, 160) }),
    ...(r.source_name === undefined ? {} : { source_name: summary(r.source_name, 80) }),
    ...(expires === undefined ? {} : { expires_at: expires }),
    ...(r.target_count === undefined ? {} : { target_count: integer(r.target_count) }),
    ...(r.transferred_bytes === undefined ? {} : { transferred_bytes: integer(r.transferred_bytes) }),
    ...(r.total_bytes === undefined ? {} : { total_bytes: integer(r.total_bytes) }),
    completed_files: integer(r.completed_files), total_files: integer(r.total_files),
    skipped_items: integer(r.skipped_items), native_eligible: boolean(r.native_eligible), read: boolean(r.read),
  }
}
export function decodeNotificationPage(value: unknown): NotificationPage {
  const r = record(value)
  if (!Array.isArray(r.items) || r.items.length > 1000) throw new Error('NOTIFICATION_INVALID')
  return { items: r.items.map(decodeNotification), watermark: integer(r.watermark), unread_count: integer(r.unread_count), next_before: integer(r.next_before) }
}
export function decodeNotificationEvent(value: unknown): NotificationEvent {
  const r = record(value)
  if (r.type === 'snapshot') return { type: r.type, page: decodeNotificationPage(r.page) }
  if (r.type === 'upsert') return { type: r.type, message: decodeNotification(r.message) }
  throw new Error('NOTIFICATION_INVALID')
}
export function validateNotificationPreferences(value: unknown): NotificationPreferences {
  const r = record(value)
  if (Object.keys(r).some((key) => !['enabled', 'agent', 'file', 'approval', 'cloud'].includes(key))) throw new Error('NOTIFICATION_PREFERENCES_INVALID')
  // 已保存的偏好缺少新增类别时沿用默认开启策略。
  return { enabled: boolean(r.enabled), agent: boolean(r.agent), file: boolean(r.file), approval: r.approval === undefined ? true : boolean(r.approval), cloud: r.cloud === undefined ? true : boolean(r.cloud) }
}

export function notificationTarget(message: NotificationMessage): NotificationTarget {
  if (message.kind === 'cloud') return { kind: 'cloud', binding_id: message.source_id, tab: message.operation.startsWith('cloud_device') ? 'devices' : message.operation === 'cloud_rekey' || message.operation === 'cloud_auth' ? 'security' : 'sync' }
  if (message.kind === 'approval') return { kind: 'approval', approval_id: message.source_id }
  if (message.kind === 'agent') return message.session_id ? { kind: 'agent', session_id: message.session_id } : { kind: 'centre', filter: 'agent' }
  return { kind: 'transfer', transfer_id: message.source_id }
}

export function notificationText(message: NotificationMessage, language: string): { title: string; body: string; subject: string; summary: string } {
  const zh = language.startsWith('zh')
  if (message.kind === 'cloud') {
    const labels: Record<string, [string, string]> = { cloud_sync: ['云同步', 'Cloud sync'], cloud_device_approve: ['设备批准', 'Device approval'], cloud_device_revoke: ['设备撤销', 'Device revocation'], cloud_rekey: ['密钥轮换', 'Key rotation'], cloud_auth: ['云账号需要重新登录', 'Cloud sign-in required'], cloud_conflicts: ['云同步有冲突待处理', 'Cloud sync conflicts need attention'] }
    const label = labels[message.operation] ?? ['云服务', 'Cloud service']
    const title = label[zh ? 0 : 1] + (message.outcome === 'attention' ? '' : zh ? message.outcome === 'success' ? '已完成' : '未完成' : message.outcome === 'success' ? ' completed' : ' incomplete')
    const body = zh ? '打开账号查看详情' : 'Open Account for details'
    return { title, body, subject: zh ? '云服务' : 'Cloud service', summary: body }
  }
  const operations: Record<string, [string, string]> = {
    run: ['AI 助手本轮任务', 'AI assistant task'], upload_file: ['文件上传', 'Upload'], upload_directory: ['文件夹上传', 'Folder upload'],
    download_file: ['文件下载', 'Download'], download_directory: ['文件夹下载', 'Folder download'],
    remote_copy: ['文件复制', 'File copy'], remote_move: ['文件移动', 'File move'],
  }
  const outcomes: Record<NotificationOutcome, [string, string]> = {
    success: ['已完成', 'completed'], failed: ['失败', 'failed'], partial: ['部分完成', 'partially completed'], uncertain: ['结果待确认', 'result uncertain'], attention: ['待审批', 'awaiting approval'],
  }
  if (message.kind === 'approval') {
    const kinds: Record<string, [string, string]> = { command: ['命令', 'Command'], files: ['文件操作', 'File operation'], remoteops: ['远程管理操作', 'Remote management'], forwarding: ['端口转发', 'Port forwarding'], snippet: ['命令片段', 'Snippet'] }
    const kind = kinds[message.operation] ?? ['操作', 'Operation']
    const subject = message.source_name || (zh ? 'AI 助手' : 'AI assistant')
    return { title: zh ? `有${kind[0]}待审批` : `${kind[1]} awaiting approval`, subject, summary: '', body: subject }
  }
  const label = operations[message.operation] ?? (message.kind === 'agent' ? operations.run : ['文件传输', 'File transfer'])
  const subject = message.kind === 'agent'
    ? message.session_title || (zh ? `会话 ${message.session_id?.slice(-8) ?? ''}` : `Session ${message.session_id?.slice(-8) ?? ''}`).trim()
    : message.name || (zh ? '文件传输任务' : 'File transfer task')
  const bytes = message.transferred_bytes ?? 0
  const totalBytes = message.total_bytes ?? 0
  const summary = message.kind === 'agent'
    ? message.preview || (zh ? '打开会话查看本轮任务详情' : 'Open the session for task details')
    : [message.total_files ? (zh ? `完成 ${message.completed_files} / ${message.total_files} 项` : `${message.completed_files} / ${message.total_files} items completed`) : (zh ? '查看传输详情' : 'View transfer details'),
      bytes || totalBytes ? (zh ? `已传输 ${formatBytes(bytes)}${totalBytes ? ` / ${formatBytes(totalBytes)}` : ''}` : `${formatBytes(bytes)}${totalBytes ? ` / ${formatBytes(totalBytes)}` : ''} transferred`) : '',
      message.skipped_items ? (zh ? `跳过 ${message.skipped_items} 项` : `${message.skipped_items} skipped`) : '',
      message.outcome === 'uncertain' ? (zh ? '请核对目标文件状态' : 'Check the destination file state') : ''].filter(Boolean).join(' · ')
  return {
    title: `${label[zh ? 0 : 1]}${zh ? '' : ' '}${outcomes[message.outcome][zh ? 0 : 1]}`,
    subject, summary, body: `${subject}\n${summary}`,
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  const index = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0
  const value = bytes / 1024 ** index
  return `${Number(value.toFixed(index ? 1 : 0))} ${units[index]}`
}
