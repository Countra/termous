import { capabilityValue, runtimeCapability } from './runtimeCapabilityCatalog.ts'
import { isRecord } from '../contracts/validation.ts'

export type ToolOutcome = 'failed' | 'waiting' | 'pending' | 'settled' | 'unknown'
const pending = new Set(['preparing', 'queued', 'running', 'pending', 'connecting', 'reconnecting', 'starting', 'stopping', 'cancelling', 'executing', 'validating', 'verifying', 'enqueued', 'interrupting'])
const terminal = new Set(['completed', 'succeeded', 'success', 'ready', 'connected', 'closed', 'cancelled', 'stopped', 'detached', 'interrupted'])
const failed = new Set(['failed', 'timed_out', 'invalidated', 'uncertain', 'partial_failed', 'completed_unknown'])

function approvals(name: string, data: Record<string, unknown>) {
  const paths = runtimeCapability(name)?.evidence?.approvals ?? ['approval', 'report.approval']
  return paths.map((path) => capabilityValue(data, path)).filter(isRecord)
}

export function runtimeToolFailureCode(name: string, data: Record<string, unknown>, isError = false): string | undefined {
  if (isRecord(data.error)) return typeof data.error.code === 'string' ? data.error.code.slice(0, 128) : 'tool_failed'
  for (const approval of approvals(name, data)) if (['rejected', 'expired', 'cancelled'].includes(String(approval.state))) return `approval_${String(approval.state)}`
  for (const path of runtimeCapability(name)?.evidence?.states ?? []) {
    const state = capabilityValue(data, path)
    if (!failed.has(String(state))) continue
    const parent = capabilityValue(data, path.slice(0, path.lastIndexOf('.')))
    if (state === 'uncertain' || state === 'completed_unknown') return 'operation_uncertain'
    if (state === 'partial_failed') return 'operation_partial_failed'
    if (isRecord(parent)) for (const key of ['error_code', 'reason']) if (typeof parent[key] === 'string' && parent[key]) return parent[key].slice(0, 128)
    if (state === 'timed_out') return 'operation_timeout'
    return 'operation_failed'
  }
  return isError ? 'tool_failed' : undefined
}

// 只解释契约指定的状态字段；不能把远端正文中的 state、指令或工具名升级为运行时控制数据。
export function runtimeToolOutcome(name: string, data: Record<string, unknown>, isError = false): ToolOutcome {
  if (runtimeToolFailureCode(name, data, isError)) return 'failed'
  if (approvals(name, data).some((approval) => ['pending', 'waiting'].includes(String(approval.state)))) return 'waiting'
  const evidence = runtimeCapability(name)?.evidence
  const states = (evidence?.states ?? []).map((path) => capabilityValue(data, path)).filter((state): state is string => typeof state === 'string')
  if (states.some((state) => state === 'paused' || state.startsWith('waiting'))) return 'waiting'
  // 长驻资源的就绪态由领域契约声明；例如隧道 running 已就绪，而命令 running 仍待结束。
  if (states.some((state) => evidence?.settled?.includes(state))) return 'settled'
  if (states.some((state) => pending.has(state))) return 'pending'
  if (states.some((state) => terminal.has(state))) return 'settled'
  return 'unknown'
}

export const roleGuidance = {
  list: '列表只发现候选对象；选定精确对象后读取详情，不把反复列出当作任务推进。',
  inspect: '这是状态或能力查询；请按回执判断下一步，不将查询视为目标操作已经执行。',
  observe: '这是观察结果；使用已取得的信息推进目标，不用刷新观察身份代替实际操作。',
  preview: '这是预览，尚未执行或确认。核对完整范围与结果后，才可按用户授权提交。',
  submit: '已取得提交回执，尚需查询原任务的状态；不要重复提交来等待完成。',
  poll: '查询原任务直到终态，再读取结果；不要创建新任务代替等待。',
  result: '读取实际结果并检查分页、截断、失败和不确定项；不要仅据成功返回声称目标完成。',
  mutate: '核验写入后的实际状态；确认请求 ID 与版本，结果不确定时不得自动重放。',
  input: '输入回执只说明协议接收，尚需查询操作状态及观察应用结果；不自动重放未确认输入。',
  cancel: '只请求停止后续工作；继续查询终态，不能假定已停止或已回滚。',
  close: '仅关闭或释放该资源，不创建新资源；确认完成后不要重复清理。',
} as const
