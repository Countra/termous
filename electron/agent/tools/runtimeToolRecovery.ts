import type { CapabilityFailure } from '../contracts/toolCapabilities.ts'

// 只分类已结构化的错误码；错误正文及远端页面不能指定恢复操作。
export function runtimeFailureKind(errorCode?: string): CapabilityFailure {
  const code = errorCode?.toLowerCase() ?? ''
  if (/forbidden|unauthorized|permission|denied|host_key|credential|approval_(?:rejected|expired|cancelled)/u.test(code)) return 'blocked'
  if (/uncertain|ambiguous|deadline|timeout/u.test(code)) return 'uncertain'
  if (/status_unavailable|not_ready|no_new_frame|in_progress|busy|session_limit/u.test(code)) return 'pending'
  if (/conflict|stale/u.test(code)) return 'stale'
  if (/not_found/u.test(code)) return 'missing'
  if (/invalid|validation|binding_mismatch/u.test(code)) return 'invalid'
  if (/unsupported|unavailable|disabled/u.test(code)) return 'unavailable'
  return 'unknown'
}

export const recoveryGuidance: Record<CapabilityFailure, string> = {
  blocked: '权限、信任或审批未满足；等待用户处理，不得原样重试、扩大目标或绕过。',
  uncertain: '结果可能不确定，先用已获准的只读入口核查原资源；不能更换请求 ID 或自动重放写操作。',
  stale: '重新读取原资源及当前版本或连接代次；已登记任务继续查询原任务 ID。不得重用或自动重放未确认输入，也不能更换请求 ID 绕过核验。',
  pending: '资源或环境未就绪；查询原资源并等待，条件变化后可重试。勿重复创建或更换目标绕过等待。',
  missing: '资源不存在，查询不会创建或恢复它。核验目标和标识，资源恢复或参数修正后再重试；缺少操作时用 discover_tools 搜索动作与资源。',
  invalid: '按工具 schema 和本轮绑定修正参数；参数或前置条件修正后可重试原工具，原样重试不能修复。',
  unavailable: '工具未加载或资源不支持此能力；用 discover_tools 核对获准目录。确认缺失则说明限制，不用 Shell 或其他领域工具绕过。',
  unknown: '原因未明；核对目标、职责、参数和环境，不把通用错误当作资源不存在。缺少能力时用 discover_tools 搜索动作与资源；有修正或恢复依据时可重试。',
}
