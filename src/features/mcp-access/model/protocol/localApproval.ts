import type { McpApprovalOperation } from '#entities/mcp-access'
import { McpAccessProtocolError, optionalBoolean, optionalNonNegativeInteger, optionalString, requireRecord, requireString } from './base.ts'

export function decodeLocalApproval(value: unknown): NonNullable<McpApprovalOperation['local']> {
  const local = requireRecord(value, '本地操作审批缺失')
  const tool = requireString(local.tool, '本地工具名称缺失')
  if (!['termous.local.commands.execute', 'termous.local.files.write', 'termous.local.files.edit'].includes(tool)) throw new McpAccessProtocolError('本地操作审批工具无效')
  const command = tool === 'termous.local.commands.execute'
  const before = optionalString(local.before) ?? ''
  const after = optionalString(local.after) ?? ''
  const beforeBytes = optionalNonNegativeInteger(local.before_bytes, '原文件大小无效') ?? 0
  const afterBytes = optionalNonNegativeInteger(local.after_bytes, '新文件大小无效') ?? 0
  if (!command && (beforeBytes > 64 * 1024 || afterBytes > 64 * 1024
    || new TextEncoder().encode(before).length !== beforeBytes || new TextEncoder().encode(after).length !== afterBytes)) throw new McpAccessProtocolError('文件变更内容不完整')
  return { session_id: requireString(local.session_id, '本地操作会话缺失'), tool,
    directory: requireString(local.directory, '工作目录缺失'),
    shell: command ? requireString(local.shell, 'Shell 缺失') : undefined,
    executable: command ? requireString(local.executable, '执行文件缺失') : undefined,
    command: command ? requireString(local.command, '命令缺失') : undefined,
    path: command ? undefined : requireString(local.path, '文件路径缺失'),
    create: optionalBoolean(local.create, '创建标识无效') ?? false,
    before, after, before_bytes: beforeBytes, after_bytes: afterBytes,
    remember_allowed: command && (optionalBoolean(local.remember_allowed, '记住授权标识无效') ?? false),
  }
}
