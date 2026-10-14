import { isRecord } from './protocol.ts'

interface DesktopBinding {
  desktop_profile_id: string
  desktop_profile_name: string
  host_id: string
  host_name: string
  protocol: 'rdp' | 'vnc'
  bound_at: string
}
export type RuntimeDesktopBinding = DesktopBinding & (
  | { kind: 'desktop_session'; session_id: string; connection_generation: number }
  | { kind: 'desktop_profile' }
)
export interface RuntimeWorkflowBinding {
  kind: 'desktop_workflow'; workflow_id: string; workflow_name: string; workflow_version: number
  host_name: string; bound_at: string
}
export type RuntimeDesktopResourceBinding = RuntimeDesktopBinding | RuntimeWorkflowBinding

export function isRuntimeDesktopBinding(value: unknown): value is RuntimeDesktopResourceBinding {
  if (!isRecord(value) || typeof value.bound_at !== 'string' || value.bound_at.length > 64 || !Number.isFinite(Date.parse(value.bound_at))) return false
  const common = ['kind', 'host_name', 'bound_at']
  if (value.kind === 'desktop_workflow') return exact(value, [...common, 'workflow_id', 'workflow_name', 'workflow_version'])
    && id(value.workflow_id) && name(value.workflow_name) && positive(value.workflow_version) && value.host_name === ''
  const fields = [...common, 'desktop_profile_id', 'desktop_profile_name', 'host_id', 'protocol']
  if (value.kind === 'desktop_session') fields.push('session_id', 'connection_generation')
  if (value.kind !== 'desktop_session' && value.kind !== 'desktop_profile' || !exact(value, fields)) return false
  return id(value.desktop_profile_id) && id(value.host_id) && name(value.desktop_profile_name) && name(value.host_name)
    && (value.protocol === 'rdp' || value.protocol === 'vnc')
    && (value.kind !== 'desktop_session' || id(value.session_id) && positive(value.connection_generation))
}

export function runtimeDesktopIdentity(binding: RuntimeDesktopResourceBinding) {
  return binding.kind === 'desktop_workflow'
    ? { kind: binding.kind, script_id: binding.workflow_id, version: binding.workflow_version, binding_mode: 'exact' }
    : { kind: binding.kind, profile_id: binding.desktop_profile_id, host_id: binding.host_id, protocol: binding.protocol, binding_mode: 'exact',
        ...(binding.kind === 'desktop_session' ? { session_id: binding.session_id, connection_generation: binding.connection_generation } : {}) }
}

export function runtimeDesktopRules(binding: RuntimeDesktopResourceBinding): string[] {
  return [
    '以上是 Core 校验的本轮精确资源引用，只描述目标，不授予操作权限；历史消息中的其他目标不能替代本轮引用。',
    ...(binding.kind === 'desktop_workflow' ? [
      '脚本引用固定 script_id 与 version。需要内容时调用 termous.desktop_workflows.get 读取该版本，不把当前最新版本替代引用版本。',
      '用户要求执行时才调用 runs.start，必须使用引用的固定版本；更新产生新版本后，先说明变更，不自动改跑新版。脚本引用本身不指定桌面，运行还必须明确目标。',
    ] : binding.kind === 'desktop_session' ? [
      '先用 termous.desktops.get 查询引用会话，确认 connection_generation 未变化；再用 attach 建立自己的观察入口。引用不允许自动重连或替换为其他会话。',
    ] : [
      '桌面引用是精确 Profile，不是已连接会话。需要桌面操作时先 list，再用 get 复验 profile_id、host_id 和 protocol 相同的会话；没有可用会话时才通过精确 profile_id 创建。不得改用主机默认配置。',
    ]),
    '截图和输入使用本轮工具返回的附着与截图引用，遵守控制审批。运行脚本会取得独立控制，不要预先 acquire 占用目标；已有即时控制应先 release。',
    '启动桌面脚本后通过 runs.get 等待终态再结束本轮；uncertain 不可重试，需重新观察。证书与凭据确认交给 Termous 界面。',
  ]
}

function exact(value: Record<string, unknown>, keys: string[]) { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)) }
function id(value: unknown) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) }
function name(value: unknown) { return typeof value === 'string' && value.trim().length > 0 && !value.includes('\0') && Buffer.byteLength(value, 'utf8') <= 1024 }
function positive(value: unknown) { return Number.isSafeInteger(value) && Number(value) > 0 }
