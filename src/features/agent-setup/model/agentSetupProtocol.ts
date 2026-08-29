import {
  agentApiModes,
  agentModelAvailabilities,
  agentModelRefreshStatuses,
  agentReadinessComponentStates,
  agentReadinessStates,
  agentReasoningLevels,
  type AgentApiMode,
  type AgentMcpPolicy,
  type AgentModel,
  type AgentModelAvailability,
  type AgentModelPage,
  type AgentModelProvider,
  type AgentModelProviderPage,
  type AgentModelRefreshStatus,
  type AgentModelTestResult,
  type AgentProviderTestResult,
  type AgentReadiness,
  type AgentReadinessComponent,
  type AgentReadinessComponentState,
  type AgentReadinessState,
  type AgentReasoningLevel,
  type AgentSettings,
} from '#entities/agent'

export class AgentSetupProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentSetupProtocolError'
  }
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentSetupProtocolError(message)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, message: string, allowEmpty = false, maxLength = 4096) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maxLength) {
    throw new AgentSetupProtocolError(message)
  }
  return value
}

function utf8String(value: unknown, message: string, maxBytes: number) {
  const result = string(value, message, false, maxBytes)
  if (new TextEncoder().encode(result).byteLength > maxBytes || containsASCIIControlText(result)) {
    throw new AgentSetupProtocolError(message)
  }
  return result
}

function containsASCIIControlText(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

function boolean(value: unknown, message: string) {
  if (typeof value !== 'boolean') throw new AgentSetupProtocolError(message)
  return value
}

function integer(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AgentSetupProtocolError(message)
  return Number(value)
}

function positiveInteger(value: unknown, message: string) {
  const result = integer(value, message)
  if (result === 0) throw new AgentSetupProtocolError(message)
  return result
}

function timestamp(value: unknown, message: string) {
  const result = string(value, message, false, 64)
  if (!Number.isFinite(Date.parse(result))) throw new AgentSetupProtocolError(message)
  return result
}

function enumValue<T extends string>(value: unknown, values: readonly T[], message: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new AgentSetupProtocolError(message)
  }
  return value as T
}

export function decodeAgentSettings(value: unknown): AgentSettings {
  const source = record(value, 'Agent 设置响应无效')
  return {
    default_model_id: source.default_model_id === undefined
      ? undefined
      : string(source.default_model_id, 'Agent 默认模型无效', false, 128),
    default_reasoning_level: enumValue<AgentReasoningLevel>(source.default_reasoning_level, agentReasoningLevels, 'Agent 默认推理级别无效'),
    revision: positiveInteger(source.revision, 'Agent 设置 revision 无效'),
    created_at: timestamp(source.created_at, 'Agent 设置创建时间缺失'),
    updated_at: timestamp(source.updated_at, 'Agent 设置更新时间缺失'),
  }
}

function decodeComponent(value: unknown): AgentReadinessComponent {
  const source = record(value, 'Agent 准备项无效')
  return {
    status: enumValue<AgentReadinessComponentState>(source.status, agentReadinessComponentStates, 'Agent 准备项状态无效'),
    message: string(source.message, 'Agent 准备项说明无效', true, 1024),
  }
}

export function decodeAgentMcpPolicy(value: unknown): AgentMcpPolicy {
  const source = record(value, 'Agent MCP 策略响应无效')
  return {
    client_id: string(source.client_id, 'Agent MCP 客户端 ID 缺失', false, 128),
    approval_bypass: boolean(source.approval_bypass, 'Agent MCP 审批策略无效'),
    scope_count: integer(source.scope_count, 'Agent MCP 权限数量无效'),
    required_scope_count: integer(source.required_scope_count, 'Agent MCP 所需权限数量无效'),
    scope_sync_required: boolean(source.scope_sync_required, 'Agent MCP 权限同步状态无效'),
    revision: positiveInteger(source.revision, 'Agent MCP 策略 revision 无效'),
  }
}

export function decodeAgentReadiness(value: unknown): AgentReadiness {
  const source = record(value, 'Agent 准备状态响应无效')
  return {
    status: enumValue<AgentReadinessState>(source.status, agentReadinessStates, 'Agent 准备状态无效'),
    mcp_runtime: decodeComponent(source.mcp_runtime),
    mcp_client: decodeComponent(source.mcp_client),
    skills_bundle: decodeComponent(source.skills_bundle),
    default_model: decodeComponent(source.default_model),
    mcp_policy: source.mcp_policy === undefined ? undefined : decodeAgentMcpPolicy(source.mcp_policy),
    settings: decodeAgentSettings(source.settings),
  }
}

export function decodeAgentSetupResult(value: unknown): AgentReadiness {
  return decodeAgentReadiness(record(value, 'Agent 初始化响应无效').readiness)
}

export function decodeAgentModelProvider(value: unknown): AgentModelProvider {
  const source = record(value, 'Agent Provider 响应无效')
  return {
    id: string(source.id, 'Agent Provider ID 缺失', false, 128),
    name: utf8String(source.name, 'Agent Provider 名称缺失', 80),
    api_mode: enumValue<AgentApiMode>(source.api_mode, agentApiModes, 'Agent Provider API 模式无效'),
    base_url: decodeBaseUrl(source.base_url),
    enabled: boolean(source.enabled, 'Agent Provider 启用状态无效'),
    api_key_configured: boolean(source.api_key_configured, 'Agent Provider 密钥状态无效'),
    refresh_status: enumValue<AgentModelRefreshStatus>(source.refresh_status, agentModelRefreshStatuses, 'Agent Provider 刷新状态无效'),
    last_refresh_attempt_at: source.last_refresh_attempt_at === undefined ? undefined : timestamp(source.last_refresh_attempt_at, 'Agent Provider 刷新时间无效'),
    last_refresh_success_at: source.last_refresh_success_at === undefined ? undefined : timestamp(source.last_refresh_success_at, 'Agent Provider 成功刷新时间无效'),
    last_refresh_error_code: source.last_refresh_error_code === undefined ? undefined : string(source.last_refresh_error_code, 'Agent Provider 刷新错误无效', false, 128),
    revision: positiveInteger(source.revision, 'Agent Provider revision 无效'),
    created_at: timestamp(source.created_at, 'Agent Provider 创建时间缺失'),
    updated_at: timestamp(source.updated_at, 'Agent Provider 更新时间缺失'),
  }
}

export function decodeAgentModel(value: unknown): AgentModel {
  const source = record(value, 'Agent 模型响应无效')
  const contextWindowTokens = positiveInteger(source.context_window_tokens, 'Agent 模型上下文窗口无效')
  const maxOutputTokens = positiveInteger(source.max_output_tokens, 'Agent 模型最大输出无效')
  if (contextWindowTokens < 1024 || contextWindowTokens > 2_000_000 || maxOutputTokens > contextWindowTokens) {
    throw new AgentSetupProtocolError('Agent 模型 token 配置无效')
  }
  return {
    id: string(source.id, 'Agent 模型 ID 缺失', false, 128),
    provider_id: string(source.provider_id, 'Agent 模型 Provider ID 缺失', false, 128),
    remote_model_id: utf8String(source.remote_model_id, 'Agent 远端模型 ID 缺失', 200),
    display_name: utf8String(source.display_name, 'Agent 模型显示名称缺失', 200),
    owned_by: source.owned_by === undefined ? undefined : utf8String(source.owned_by, 'Agent 模型所有者无效', 200),
    availability: enumValue<AgentModelAvailability>(source.availability, agentModelAvailabilities, 'Agent 模型可用状态无效'),
    context_window_tokens: contextWindowTokens,
    max_output_tokens: maxOutputTokens,
    supports_images: boolean(source.supports_images, 'Agent 模型图片能力无效'),
    supports_reasoning: boolean(source.supports_reasoning, 'Agent 模型推理能力无效'),
    capabilities_confirmed: boolean(source.capabilities_confirmed, 'Agent 模型能力确认状态无效'),
    revision: positiveInteger(source.revision, 'Agent 模型 revision 无效'),
    created_at: timestamp(source.created_at, 'Agent 模型创建时间缺失'),
    updated_at: timestamp(source.updated_at, 'Agent 模型更新时间缺失'),
  }
}

export function decodeAgentModelProviderPage(value: unknown): AgentModelProviderPage {
  const source = record(value, 'Agent Provider 列表响应无效')
  if (!Array.isArray(source.items) || source.items.length > 16) throw new AgentSetupProtocolError('Agent Provider 列表无效')
  const items = source.items.map(decodeAgentModelProvider)
  ensureUnique(items.map(({ id }) => id), 'Agent Provider 列表包含重复 ID')
  return {
    items,
    next_cursor: source.next_cursor === undefined ? undefined : string(source.next_cursor, 'Agent Provider 列表游标无效', false, 4096),
  }
}

export function decodeAgentModelPage(value: unknown): AgentModelPage {
  const source = record(value, 'Agent 模型列表响应无效')
  if (!Array.isArray(source.items) || source.items.length > 100) throw new AgentSetupProtocolError('Agent 模型列表无效')
  const items = source.items.map(decodeAgentModel)
  ensureUnique(items.map(({ id }) => id), 'Agent 模型列表包含重复 ID')
  return { items, next_cursor: source.next_cursor === undefined ? undefined : string(source.next_cursor, 'Agent 模型列表游标无效', false, 4096) }
}

export function decodeAgentProviderTestResult(value: unknown): AgentProviderTestResult {
  const source = record(value, 'Agent Provider 测试响应无效')
  return { status: enumValue(source.status, ['ready', 'failed'] as const, 'Agent Provider 测试状态无效'), latency_ms: integer(source.latency_ms, 'Agent Provider 测试延迟无效'), model_count: integer(source.model_count, 'Agent Provider 模型数量无效'), message: string(source.message, 'Agent Provider 测试说明无效', true, 1024) }
}

export function decodeAgentModelTestResult(value: unknown): AgentModelTestResult {
  const source = record(value, 'Agent 模型测试响应无效')
  return {
    status: enumValue(source.status, ['ready', 'failed'] as const, 'Agent 模型测试状态无效'),
    latency_ms: integer(source.latency_ms, 'Agent 模型测试延迟无效'),
    model_id: utf8String(source.model_id, 'Agent 模型测试模型 ID 缺失', 200),
    message: string(source.message, 'Agent 模型测试说明无效', true, 1024),
  }
}

function decodeBaseUrl(value: unknown) {
  const result = string(value, 'Agent 模型地址缺失', false, 2048)
  try {
    const parsed = new URL(result)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error('invalid')
    }
  } catch {
    throw new AgentSetupProtocolError('Agent 模型地址无效')
  }
  return result
}

function ensureUnique(values: string[], message: string) {
  if (new Set(values).size !== values.length) throw new AgentSetupProtocolError(message)
}
