import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { AgentMCPConnection } from './mcpClientAdapter.ts'
import { isRecord } from './protocol.ts'
import type { RuntimeResourceBinding } from './workerCoreClient.ts'

export function runtimeResourceIdentity(binding: RuntimeResourceBinding) {
  // 只投影经过 Core 校验的路由身份，不把展示名称或历史内容提升为系统指令。
  return {
    binding_mode: 'exact', host_id: binding.host_id, kind: binding.kind,
    ...(binding.kind === 'ssh_session' ? { platform: binding.platform, session_id: binding.session_id }
      : { engine: binding.engine, file_access_profile_id: binding.file_access_profile_id }),
    ssh_profile_id: binding.ssh_profile_id, state: 'ready',
  } as const
}

interface SSHSelector {
  field: 'session_id' | 'session_ids'
  optional?: boolean
}

function sshSelector(name: string): SSHSelector | undefined {
  if (name === 'termous.commands.dispatch') return { field: 'session_ids' }
  // 任务结果属于创建时的目标，不能将旧 task_id／operation_id 重定向到新连接。
  if (name === 'termous.remoteops.services.operations.get') return undefined
  if (name === 'termous.sessions.get' || name === 'termous.sessions.close' || name.startsWith('termous.remoteops.')) {
    return { field: 'session_id' }
  }
  if (name === 'termous.forwarding.instances.start') return { field: 'session_id', optional: true }
  return undefined
}

export function bindRuntimeResourceTools(mcp: AgentMCPConnection, bindings: RuntimeResourceBinding[] = []): AgentTool[] {
  const binding = bindings.find((resource) => resource.kind === 'ssh_session')
  if (!binding) return mcp.tools
  // 一个 Worker 只执行一轮；捕获本轮身份，下一轮必须从新 Bootstrap 重建工具。
  const sessionID = binding.session_id
  const resource = runtimeResourceIdentity(binding)
  return mcp.tools.map((tool) => {
    const selector = sshSelector(mcp.originalName(tool.name) ?? '')
    const originalSchema: unknown = tool.parameters
    const properties: unknown = isRecord(originalSchema) ? originalSchema.properties : undefined
    if (!selector || !isRecord(properties)) return tool
    const schema = properties[selector.field]
    if (!isRecord(schema)) return tool
    const description = selector.optional
      ? `使用 session_id 复用 SSH 时，本轮目标为 ${sessionID}；用户明确选择 profile_id、host_id 或 ssh_profile_id 时保留该来源，不要补入 session_id。`
      : `本轮新操作的 SSH 目标为 ${sessionID}；历史消息及摘要中的其他会话 ID 不是当前绑定。`
    const validate = (args: unknown) => {
      const selected = isRecord(args) ? args[selector.field] : undefined
      // 转发的空选择器沿用 Core 的未选择语义，其他来源及其合法性仍由原合同处理。
      if (selector.optional && (selected === undefined || typeof selected === 'string' && selected.trim() === '')) return
      const matches = selector.field === 'session_ids'
        ? Array.isArray(selected) && selected.length === 1 && selected[0] === sessionID
        : selected === sessionID
      if (!matches) {
        throw new Error(JSON.stringify({
          code: 'AGENT_RESOURCE_BINDING_MISMATCH', dispatched: false,
          message: '调用参数与本轮 SSH 绑定不一致，此次调用尚未发送到 MCP。请按当前绑定修正参数；这不是当前连接失效，不需要用户再次绑定。不得重放历史已执行或结果未知的操作。',
          resource,
          expected_arguments: { [selector.field]: selector.field === 'session_ids' ? [sessionID] : sessionID },
        }))
      }
    }
    const parameters = {
      ...tool.parameters,
      properties: {
        ...properties,
        [selector.field]: {
          ...(selector.optional ? schema : restrictSSHSelector(schema, selector, sessionID)),
          description: [schema.description, description].filter((value) => typeof value === 'string' && value).join('\n'),
        },
      },
    }
    return {
      ...tool, parameters, description: `${tool.description}\n${description}`,
      prepareArguments: (args) => {
        const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args
        // 在通用 Schema 校验前返回可纠正的路由错误，不能将其误报为远端 Session 失效。
        validate(prepared)
        return prepared
      },
      execute: async (toolCallID, args, signal, onUpdate) => {
        // 执行入口同样复验，避免直接调用工具适配器时绕过绑定；不改写命令或审批载荷。
        validate(args)
        return await tool.execute(toolCallID, args, signal, onUpdate)
      },
    }
  })
}

function restrictSSHSelector(schema: Record<string, unknown>, selector: SSHSelector, sessionID: string) {
  // 新约束只取交集，保留 Core 的枚举、数组上下限和子项规则，不能放宽原工具合同。
  const restrictID = (value: Record<string, unknown>) => ({
    ...value, enum: Array.isArray(value.enum) ? value.enum.filter((item) => item === sessionID) : [sessionID],
  })
  if (selector.field === 'session_id') return restrictID(schema)
  const items = isRecord(schema.items) ? restrictID(schema.items)
    : schema.items === undefined || schema.items === true ? restrictID({}) : schema.items
  return {
    ...schema, items,
    minItems: Math.max(1, typeof schema.minItems === 'number' ? schema.minItems : 1),
    maxItems: Math.min(1, typeof schema.maxItems === 'number' ? schema.maxItems : 1),
  }
}
