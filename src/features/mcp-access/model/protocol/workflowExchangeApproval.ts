import type { McpApprovalOperation, McpApprovalState } from '#entities/mcp-access'
import { McpAccessProtocolError, requireString, requireNonNegativeInteger, requireArray, optionalString } from './base.ts'

const actionFields: Record<string, readonly string[]> = {
  import: ['local_paths'],
  export: ['script_id', 'script_version', 'resource_name', 'local_target', 'mode', 'overwrite_policy'],
  export_template: ['script_id', 'script_version', 'resource_name', 'resource_id', 'local_target', 'mode', 'overwrite_policy'],
}

export function decodeWorkflowExchangeApproval(operation: Record<string, unknown>, action: string, state: McpApprovalState): McpApprovalOperation {
  const fields = actionFields[action]
  if (!fields || operation.domain !== 'desktop_workflow'
    || Object.keys(operation).some(key => !['action', 'domain', 'description', ...fields].includes(key))) {
    throw new McpAccessProtocolError('工作流文件交换审批范围无效')
  }
  const active = state === 'pending' || state === 'dispatching'
  const result: McpApprovalOperation = { action, domain: 'desktop_workflow', local_paths: [], remote_paths: [], rename_mappings: [], description: optionalString(operation.description) }
  if (action === 'import') {
    // 后端在终态清理本机路径，不能因此拒绝整个审批快照。
    const paths = !active && operation.local_paths === undefined ? [] : requireArray(operation.local_paths, '导入文件路径缺失')
    if (paths.length > 1 || active && paths.length !== 1) throw new McpAccessProtocolError('导入文件审批范围无效')
    result.local_paths = paths.map(path => requireString(path, '导入文件路径无效'))
    return result
  }
  if (active || operation.local_target !== undefined) result.local_target = requireString(operation.local_target, '导出目标缺失')
  result.mode = requireString(operation.mode, '导出格式缺失')
  if (!(action === 'export' ? ['zip', 'directory', 'json'] : ['png']).includes(result.mode)) throw new McpAccessProtocolError('导出格式无效')
  if (!['skip', 'overwrite'].includes(String(operation.overwrite_policy)) || result.mode === 'directory' && operation.overwrite_policy !== 'skip') throw new McpAccessProtocolError('导出覆盖策略无效')
  result.overwrite_policy = operation.overwrite_policy as 'skip' | 'overwrite'
  if (action === 'export' || operation.script_id !== undefined || operation.script_version !== undefined) {
    result.script_id = requireString(operation.script_id, '导出脚本缺失')
    result.script_version = requireNonNegativeInteger(operation.script_version, '导出版本无效')
    if (result.script_version < 1) throw new McpAccessProtocolError('导出版本无效')
  }
  if (action === 'export_template') result.resource_id = requireString(operation.resource_id, '模板资源缺失')
  result.resource_name = optionalString(operation.resource_name)
  return result
}
