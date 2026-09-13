import type { AgentTool } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails, type AgentMCPConnection } from './mcpClientAdapter.ts'
import { isRecord } from './protocol.ts'
import type { RuntimeResourceBinding, RuntimeSSHProfileBinding } from './workerCoreClient.ts'

export function runtimeResourceIdentity(binding: RuntimeResourceBinding) {
  // 只投影经过 Core 校验的路由身份，不把展示名称或历史内容提升为系统指令。
  return {
    binding_mode: 'exact', host_id: binding.host_id, kind: binding.kind,
    ...(binding.kind === 'ssh_session' ? { platform: binding.platform, session_id: binding.session_id, state: 'ready' }
      : binding.kind === 'ssh_profile' ? { platform: binding.platform, state: 'available' }
        : { engine: binding.engine, file_access_profile_id: binding.file_access_profile_id, state: 'ready' }),
    ssh_profile_id: binding.ssh_profile_id,
  } as const
}

interface SSHSelector {
  field: 'session_id' | 'session_ids'
  optional?: boolean
}

interface ProfileSessionState {
  ready: boolean
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
  const binding = bindings.find((resource) => resource.kind === 'ssh_session' || resource.kind === 'ssh_profile')
  if (!binding) return mcp.tools
  if (binding.kind === 'ssh_profile') return bindRuntimeSSHProfileTools(mcp, binding)
  return bindRuntimeSSHSessionTools(mcp, binding)
}

function bindRuntimeSSHSessionTools(
  mcp: AgentMCPConnection,
  binding: Extract<RuntimeResourceBinding, { kind: 'ssh_session' }>,
): AgentTool[] {
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

function bindRuntimeSSHProfileTools(mcp: AgentMCPConnection, binding: RuntimeSSHProfileBinding): AgentTool[] {
  const sessions = new Map<string, ProfileSessionState>()
  const resource = runtimeResourceIdentity(binding)
  return mcp.tools.map((tool) => {
    const name = mcp.originalName(tool.name) ?? ''
    if (name === 'termous.sessions.connect') {
      return bindProfileConnectTool(tool, binding, resource, sessions)
    }
    const selector = sshSelector(name)
    if (!selector) {
      if (name !== 'termous.sessions.list') return tool
      return observeProfileSessionTool(tool, name, binding, sessions)
    }
    const needsReady = name !== 'termous.sessions.get' && name !== 'termous.sessions.close'
    const description = selector.optional
      ? `使用 session_id 复用 SSH 时，只能选择本轮绑定 Profile ${binding.ssh_profile_id} 的已就绪会话；使用 ssh_profile_id 时只能使用该 Profile。`
      : needsReady
        ? `本轮 SSH 目标必须是通过绑定 Profile ${binding.ssh_profile_id} 解析出的一个已就绪会话。`
        : `仅可查询或关闭通过本轮绑定 Profile ${binding.ssh_profile_id} 解析出的会话。`
    const validate = (args: unknown) => validateProfileSessionSelector(
      args,
      selector,
      sessions,
      needsReady,
      resource,
    )
    const parameters = restrictProfileForwardingSchema(tool.parameters, name, binding.ssh_profile_id)
    return {
      ...tool,
      parameters,
      description: `${tool.description}\n${description}`,
      prepareArguments: (args) => {
        const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args
        validateProfileForwardingSelector(prepared, name, binding.ssh_profile_id, resource)
        validate(prepared)
        return prepared
      },
      execute: async (toolCallID, args, signal, onUpdate) => {
        validateProfileForwardingSelector(args, name, binding.ssh_profile_id, resource)
        validate(args)
        const result = await tool.execute(toolCallID, args, signal, onUpdate)
        observeProfileSessionResult(name, args, result, binding, sessions)
        return result
      },
    }
  })
}

function bindProfileConnectTool(
  tool: AgentTool,
  binding: RuntimeSSHProfileBinding,
  resource: ReturnType<typeof runtimeResourceIdentity>,
  sessions: Map<string, ProfileSessionState>,
) {
  const validate = (args: unknown) => {
    if (!isRecord(args) || args.ssh_profile_id !== binding.ssh_profile_id || 'host_id' in args) {
      throwProfileRoutingError(
        resource,
        '连接请求只能使用本轮绑定的精确 SSH Profile，且不能改用 host_id。',
        { ssh_profile_id: binding.ssh_profile_id },
      )
    }
  }
  const parameters = restrictProfileConnectSchema(tool.parameters, binding.ssh_profile_id)
  return {
    ...tool,
    parameters,
    description: `${tool.description}\n本轮只能使用 ssh_profile_id=${binding.ssh_profile_id}，不得改用 host_id 或其他 Profile。`,
    prepareArguments: (args) => {
      const prepared = tool.prepareArguments ? tool.prepareArguments(args) : args
      validate(prepared)
      return prepared
    },
    execute: async (toolCallID, args, signal, onUpdate) => {
      validate(args)
      const result = await tool.execute(toolCallID, args, signal, onUpdate)
      observeProfileSessionResult('termous.sessions.connect', args, result, binding, sessions)
      return result
    },
  } satisfies AgentTool
}

function observeProfileSessionTool(
  tool: AgentTool,
  name: string,
  binding: RuntimeSSHProfileBinding,
  sessions: Map<string, ProfileSessionState>,
) {
  return {
    ...tool,
    description: `${tool.description}\n本轮只可将 host_id 与 ssh_profile_id 均匹配绑定 Profile 的结果用于后续 SSH 操作。`,
    execute: async (toolCallID, args, signal, onUpdate) => {
      const result = await tool.execute(toolCallID, args, signal, onUpdate)
      observeProfileSessionResult(name, args, result, binding, sessions)
      return result
    },
  } satisfies AgentTool
}

function validateProfileSessionSelector(
  args: unknown,
  selector: SSHSelector,
  sessions: Map<string, ProfileSessionState>,
  needsReady: boolean,
  resource: ReturnType<typeof runtimeResourceIdentity>,
) {
  const selected = isRecord(args) ? args[selector.field] : undefined
  if (selector.optional && (selected === undefined || typeof selected === 'string' && selected.trim() === '')) return
  const sessionID = selector.field === 'session_ids'
    ? Array.isArray(selected) && selected.length === 1 && typeof selected[0] === 'string' ? selected[0] : ''
    : typeof selected === 'string' ? selected : ''
  const state = sessions.get(sessionID)
  if (state && (!needsReady || state.ready)) return
  const placeholder = needsReady ? '<matching_ready_session_id>' : '<matching_profile_session_id>'
  throwProfileRoutingError(
    resource,
    needsReady
      ? '调用参数不是本轮绑定 Profile 已解析并确认就绪的 SSH 会话。请先列出或连接该 Profile，并等待会话就绪。'
      : '调用参数不是本轮绑定 Profile 已解析的 SSH 会话。请先列出或连接该 Profile。',
    { [selector.field]: selector.field === 'session_ids' ? [placeholder] : placeholder },
  )
}

function validateProfileForwardingSelector(
  args: unknown,
  name: string,
  sshProfileID: string,
  resource: ReturnType<typeof runtimeResourceIdentity>,
) {
  if (name !== 'termous.forwarding.instances.start') return
  if (!isRecord(args) || 'host_id' in args || 'profile_id' in args) {
    throwProfileRoutingError(
      resource,
      '转发请求只能复用本轮已确认就绪的会话，或使用本轮绑定的精确 SSH Profile。',
      { ssh_profile_id: sshProfileID },
    )
  }
  const sessionID = typeof args.session_id === 'string' ? args.session_id.trim() : ''
  const selectedProfileID = typeof args.ssh_profile_id === 'string' ? args.ssh_profile_id.trim() : ''
  if ((sessionID && selectedProfileID) || (!sessionID && selectedProfileID !== sshProfileID)) {
    throwProfileRoutingError(
      resource,
      '转发请求只能复用本轮已确认就绪的会话，或使用本轮绑定的精确 SSH Profile。',
      { ssh_profile_id: sshProfileID },
    )
  }
}

function observeProfileSessionResult(
  name: string,
  args: unknown,
  result: unknown,
  binding: RuntimeSSHProfileBinding,
  sessions: Map<string, ProfileSessionState>,
) {
  const requestedSessionID = (name === 'termous.sessions.get' || name === 'termous.sessions.close')
    && isRecord(args) && typeof args.session_id === 'string'
    ? args.session_id
    : undefined
  if (!isRecord(result) || !isMCPToolDetails(result.details) || result.details.result.isError === true) {
    // 查询或关闭结果无法证明目标仍可用时淘汰旧快照，后续 SSH 操作必须重新发现并确认。
    if (requestedSessionID) sessions.delete(requestedSessionID)
    return
  }
  const structured = result.details.result.structuredContent
  if (name === 'termous.sessions.list') {
    // sessions.list 是完整快照；先清除旧条目，避免已关闭或失去授权的会话继续保持 ready。
    sessions.clear()
    if (!isRecord(structured) || !Array.isArray(structured.sessions)) return
    for (const session of structured.sessions) registerProfileSession(session, binding, sessions)
    return
  }
  if (name === 'termous.sessions.connect' || name === 'termous.sessions.get') {
    const session = isRecord(structured) ? structured.session : undefined
    const expectedSessionID = name === 'termous.sessions.get' ? requestedSessionID : undefined
    if (!registerProfileSession(session, binding, sessions, expectedSessionID, name === 'termous.sessions.get')) {
      throwProfileResultMismatch(binding, expectedSessionID
        ? { session: { id: expectedSessionID, host_id: binding.host_id, ssh_profile_id: binding.ssh_profile_id } }
        : { session: { host_id: binding.host_id, ssh_profile_id: binding.ssh_profile_id } })
    }
    return
  }
  if (name === 'termous.sessions.close' && isRecord(args) && typeof args.session_id === 'string') {
    const sessionID = args.session_id
    if (!isRecord(structured) || structured.session_id !== sessionID || structured.closed !== true) {
      sessions.delete(sessionID)
      if (isRecord(structured) && validSessionIdentifier(structured.session_id)) sessions.delete(structured.session_id)
      throwProfileResultMismatch(binding, { session_id: sessionID, closed: true })
    }
    sessions.delete(sessionID)
  }
}

function registerProfileSession(
  value: unknown,
  binding: RuntimeSSHProfileBinding,
  sessions: Map<string, ProfileSessionState>,
  expectedSessionID?: string,
  readyConfirmed = false,
) {
  if (!isRecord(value) || !validSessionIdentifier(value.id)
    || expectedSessionID !== undefined && value.id !== expectedSessionID
    || value.host_id !== binding.host_id || value.ssh_profile_id !== binding.ssh_profile_id
    || typeof value.status !== 'string') {
    if (expectedSessionID) sessions.delete(expectedSessionID)
    if (isRecord(value) && validSessionIdentifier(value.id)) sessions.delete(value.id)
    return false
  }
  // 清单和建连结果只登记候选；执行 SSH 操作前必须再以 sessions.get 确认实时就绪状态。
  sessions.set(value.id, { ready: readyConfirmed && value.status === 'connected' && value.phase === 'ready' })
  return true
}

function restrictProfileConnectSchema(schema: AgentTool['parameters'], sshProfileID: string) {
  if (!isRecord(schema) || !isRecord(schema.properties)) return schema
  const properties = Object.fromEntries(Object.entries(schema.properties).filter(([name]) => name !== 'host_id'))
  if (!isRecord(properties.ssh_profile_id)) return schema
  const profile = restrictID(properties.ssh_profile_id, sshProfileID)
  const required = Array.isArray(schema.required)
    ? [...new Set([...schema.required.filter((name) => name !== 'host_id'), 'ssh_profile_id'])]
    : ['ssh_profile_id']
  return { ...schema, properties: { ...properties, ssh_profile_id: profile }, required }
}

function restrictProfileForwardingSchema(schema: AgentTool['parameters'], name: string, sshProfileID: string) {
  if (name !== 'termous.forwarding.instances.start' || !isRecord(schema) || !isRecord(schema.properties)
    || !isRecord(schema.properties.ssh_profile_id)) return schema
  const properties = Object.fromEntries(
    Object.entries(schema.properties).filter(([field]) => field !== 'host_id' && field !== 'profile_id'),
  )
  const required = Array.isArray(schema.required)
    ? schema.required.filter((field) => field !== 'host_id' && field !== 'profile_id')
    : schema.required
  return {
    ...schema,
    required,
    properties: {
      ...properties,
      ssh_profile_id: restrictID(schema.properties.ssh_profile_id, sshProfileID),
    },
  }
}

function throwProfileResultMismatch(
  binding: RuntimeSSHProfileBinding,
  expectedResult: Record<string, unknown>,
): never {
  throw new Error(JSON.stringify({
    code: 'AGENT_RESOURCE_BINDING_RESULT_MISMATCH',
    dispatched: true,
    message: 'MCP 返回的 SSH 会话身份与本轮 Profile 绑定不一致。不得使用该会话或自动重试；请刷新后重新发起请求。',
    resource: runtimeResourceIdentity(binding),
    expected_result: expectedResult,
  }))
}

function throwProfileRoutingError(
  resource: ReturnType<typeof runtimeResourceIdentity>,
  message: string,
  expectedArguments: Record<string, unknown>,
): never {
  throw new Error(JSON.stringify({
    code: 'AGENT_RESOURCE_BINDING_MISMATCH',
    dispatched: false,
    message,
    resource,
    expected_arguments: expectedArguments,
  }))
}

function validSessionIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

function restrictSSHSelector(schema: Record<string, unknown>, selector: SSHSelector, sessionID: string) {
  // 新约束只取交集，保留 Core 的枚举、数组上下限和子项规则，不能放宽原工具合同。
  if (selector.field === 'session_id') return restrictID(schema, sessionID)
  const items = isRecord(schema.items) ? restrictID(schema.items, sessionID)
    : schema.items === undefined || schema.items === true ? restrictID({}, sessionID) : schema.items
  return {
    ...schema, items,
    minItems: Math.max(1, typeof schema.minItems === 'number' ? schema.minItems : 1),
    maxItems: Math.min(1, typeof schema.maxItems === 'number' ? schema.maxItems : 1),
  }
}

function restrictID(value: Record<string, unknown>, id: string) {
  return {
    ...value,
    enum: Array.isArray(value.enum) ? value.enum.filter((item) => item === id) : [id],
  }
}
