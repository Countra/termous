import {
  agentApiModes,
  agentAttachmentStates,
  agentMessagePartKinds,
  agentMessageRoles,
  agentMessageStatuses,
  agentReasoningLevels,
  agentRunEventKinds,
  agentRunStatuses,
  agentSourceContextKinds,
  isAgentRunActive,
  type AgentApiMode,
  type AgentAttachment,
  type AgentAttachmentState,
  type AgentJsonValue,
  type AgentMessage,
  type AgentMessagePage,
  type AgentMessagePart,
  type AgentMessagePartKind,
  type AgentMessageRole,
  type AgentMessageStatus,
  type AgentReasoningLevel,
  type AgentRun,
  type AgentRunEvent,
  type AgentRunEventKind,
  type AgentRunEventPage,
  type AgentRunModelSnapshot,
  type AgentRunStatus,
  type AgentSourceContext,
  type AgentSession,
  type AgentSessionContext,
  type AgentSessionPage,
  type AgentUsage,
} from '#entities/agent'

export type AgentWorkspaceEvent =
  | { type: 'snapshot'; revision: number; sessions: AgentSession[]; active_runs: AgentRun[] }
  | {
      type: 'upsert'
      revision: number
      session?: AgentSession
      run?: AgentRun
      message?: AgentMessage
      run_event?: AgentRunEvent
    }
  | { type: 'removed'; revision: number; entity: 'session' | 'run' | 'message'; id: string }

export class AgentRuntimeProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentRuntimeProtocolError'
  }
}

export function decodeAgentSession(value: unknown): AgentSession {
  const source = record(value, 'Agent 会话响应无效')
  return {
    id: identifier(source.id, 'Agent 会话 ID 无效'),
    title: utf8(source.title, 'Agent 会话标题无效', 200, true),
    model_profile_id: identifier(source.model_profile_id, 'Agent 会话模型 ID 无效'),
    reasoning_level: enumValue<AgentReasoningLevel>(source.reasoning_level, agentReasoningLevels, 'Agent 会话推理级别无效'),
    archived_at: optionalTimestamp(source.archived_at, 'Agent 会话归档时间无效'),
    revision: positiveInteger(source.revision, 'Agent 会话 revision 无效'),
    created_at: timestamp(source.created_at, 'Agent 会话创建时间无效'),
    updated_at: timestamp(source.updated_at, 'Agent 会话更新时间无效'),
  }
}

export function decodeAgentSessionPage(value: unknown): AgentSessionPage {
  const source = record(value, 'Agent 会话列表响应无效')
  const items = array(source.items, 'Agent 会话列表无效', 200).map(decodeAgentSession)
  unique(items.map(({ id }) => id), 'Agent 会话列表包含重复 ID')
  return { items, next_cursor: optionalString(source.next_cursor, 'Agent 会话 cursor 无效', 4096) }
}

export function decodeAgentSessionContext(
  value: unknown,
  expectedSessionId?: string,
): AgentSessionContext {
  const source = record(value, 'Agent 会话上下文响应无效')
  const sessionId = identifier(source.session_id, 'Agent 会话上下文 Session ID 无效')
  if (expectedSessionId !== undefined && sessionId !== expectedSessionId) {
    throw new AgentRuntimeProtocolError('Agent 会话上下文归属无效')
  }
  const checkpoint = source.checkpoint === undefined
    ? undefined
    : decodeAgentContextCheckpoint(source.checkpoint)
  return {
    session_id: sessionId,
    estimated_tokens: nonNegativeInteger(source.estimated_tokens, 'Agent 会话上下文 Token 估算无效'),
    context_window_tokens: positiveInteger(source.context_window_tokens, 'Agent 会话上下文窗口无效'),
    estimated: bool(source.estimated, 'Agent 会话上下文估算状态无效'),
    warning: bool(source.warning, 'Agent 会话上下文预警状态无效'),
    compression_available: bool(source.compression_available, 'Agent 会话上下文整理能力无效'),
    ...(checkpoint ? { checkpoint } : {}),
  }
}

export function decodeAgentMessagePart(value: unknown): AgentMessagePart {
  const source = record(value, 'Agent 消息片段响应无效')
  const kind = enumValue<AgentMessagePartKind>(source.kind, agentMessagePartKinds, 'Agent 消息片段类型无效')
  const base = {
    id: identifier(source.id, 'Agent 消息片段 ID 无效'),
    message_id: identifier(source.message_id, 'Agent 消息片段 Message ID 无效'),
    sequence: positiveInteger(source.sequence, 'Agent 消息片段 sequence 无效'),
    revision: positiveInteger(source.revision, 'Agent 消息片段 revision 无效'),
    created_at: timestamp(source.created_at, 'Agent 消息片段创建时间无效'),
    updated_at: timestamp(source.updated_at, 'Agent 消息片段更新时间无效'),
  }
  const content = record(source.content, 'Agent 消息片段内容无效')
  const branches = ['text', 'reasoning', 'tool_call', 'tool_result'].filter((key) => content[key] !== undefined)
  if (branches.length !== 1 || branches[0] !== kind) {
    throw new AgentRuntimeProtocolError('Agent 消息片段判别分支无效')
  }
  if (kind === 'text' || kind === 'reasoning') {
    const body = record(content[kind], `Agent ${kind} 片段无效`)
    if (kind === 'reasoning' && body.thinking_signature !== undefined) {
      throw new AgentRuntimeProtocolError('Agent 公开 reasoning 不得包含 thinking signature')
    }
    return {
      ...base,
      kind,
      text: utf8(body.text, `Agent ${kind} 文本无效`, 256 * 1024, true),
      ...(kind === 'text' && body.source_context !== undefined
        ? { source_context: decodeAgentSourceContext(body.source_context) }
        : {}),
    }
  }
  const body = record(content[kind], `Agent ${kind} 片段无效`)
  if (kind === 'tool_call') {
    return { ...base, kind, tool_call: {
      tool_call_id: identifier(body.tool_call_id, 'Agent Tool Call ID 无效', 256),
      tool_name: utf8(body.tool_name, 'Agent Tool 名称无效', 256),
      arguments: jsonValue(body.arguments),
    } }
  }
  return { ...base, kind, tool_result: {
    tool_call_id: identifier(body.tool_call_id, 'Agent Tool Call ID 无效', 256),
    tool_name: utf8(body.tool_name, 'Agent Tool 名称无效', 256),
    content: jsonValue(body.content),
    is_error: bool(body.is_error, 'Agent Tool 结果状态无效'),
  } }
}

export function decodeAgentMessage(value: unknown): AgentMessage {
  const source = record(value, 'Agent 消息响应无效')
  const parts = array(source.parts, 'Agent 消息片段列表无效').map(decodeAgentMessagePart)
  unique(parts.map(({ id }) => id), 'Agent 消息包含重复片段 ID')
  ascending(parts.map(({ sequence }) => sequence), 'Agent 消息片段 sequence 无序')
  const id = identifier(source.id, 'Agent 消息 ID 无效')
  const sessionId = identifier(source.session_id, 'Agent 消息 Session ID 无效')
  const attachments = array(source.attachments ?? [], 'Agent 消息附件列表无效', 8)
    .map(decodeAgentAttachment)
  unique(attachments.map(({ id: attachmentId }) => attachmentId), 'Agent 消息包含重复附件 ID')
  if (parts.some(({ message_id }) => message_id !== id)) {
    throw new AgentRuntimeProtocolError('Agent 消息片段归属无效')
  }
  if (attachments.some(({ session_id }) => session_id !== sessionId)) {
    throw new AgentRuntimeProtocolError('Agent 消息附件归属无效')
  }
  return {
    id,
    session_id: sessionId,
    role: enumValue<AgentMessageRole>(source.role, agentMessageRoles, 'Agent 消息角色无效'),
    status: enumValue<AgentMessageStatus>(source.status, agentMessageStatuses, 'Agent 消息状态无效'),
    sequence: positiveInteger(source.sequence, 'Agent 消息 sequence 无效'),
    revision: positiveInteger(source.revision, 'Agent 消息 revision 无效'),
    created_at: timestamp(source.created_at, 'Agent 消息创建时间无效'),
    updated_at: timestamp(source.updated_at, 'Agent 消息更新时间无效'),
    parts,
    attachments,
  }
}

export function decodeAgentAttachment(value: unknown): AgentAttachment {
  const source = record(value, 'Agent 附件响应无效')
  return {
    id: identifier(source.id, 'Agent 附件 ID 无效'),
    session_id: identifier(source.session_id, 'Agent 附件 Session ID 无效'),
    original_name: utf8(source.original_name, 'Agent 附件名称无效', 255),
    mime_type: utf8(source.mime_type, 'Agent 附件 MIME 无效', 128),
    kind: enumValue(source.kind, ['text', 'image'] as const, 'Agent 附件类型无效'),
    size_bytes: positiveInteger(source.size_bytes, 'Agent 附件大小无效'),
    state: enumValue<AgentAttachmentState>(source.state, agentAttachmentStates, 'Agent 附件状态无效'),
    expires_at: optionalTimestamp(source.expires_at, 'Agent 附件过期时间无效'),
    revision: positiveInteger(source.revision, 'Agent 附件 revision 无效'),
    created_at: timestamp(source.created_at, 'Agent 附件创建时间无效'),
    updated_at: timestamp(source.updated_at, 'Agent 附件更新时间无效'),
  }
}

export function decodeAgentSourceContext(value: unknown): AgentSourceContext {
  const source = record(value, 'Agent 来源上下文无效')
  return {
    kind: enumValue(source.kind, agentSourceContextKinds, 'Agent 来源上下文类型无效'),
    entity_id: identifier(source.entity_id, 'Agent 来源实体 ID 无效'),
    title: utf8(source.title, 'Agent 来源标题无效', 200),
    summary: utf8(source.summary, 'Agent 来源摘要无效', 2_000, true),
  }
}

export function decodeAgentMessagePage(value: unknown): AgentMessagePage {
  const source = record(value, 'Agent 消息列表响应无效')
  const items = array(source.items, 'Agent 消息列表无效', 200).map(decodeAgentMessage)
  unique(items.map(({ id }) => id), 'Agent 消息列表包含重复 ID')
  ascending(items.map(({ sequence }) => sequence), 'Agent 消息 sequence 无序')
  return {
    items,
    next_after_sequence: optionalPositiveInteger(source.next_after_sequence, 'Agent 消息增量游标无效'),
  }
}

export function decodeAgentRun(value: unknown): AgentRun {
  const source = record(value, 'Agent Run 响应无效')
  return {
    id: identifier(source.id, 'Agent Run ID 无效'),
    client_request_id: identifier(source.client_request_id, 'Agent Run 请求 ID 无效'),
    session_id: identifier(source.session_id, 'Agent Run Session ID 无效'),
    generation: positiveInteger(source.generation, 'Agent Run generation 无效'),
    event_sequence: nonNegativeInteger(source.event_sequence, 'Agent Run event sequence 无效'),
    status: enumValue<AgentRunStatus>(source.status, agentRunStatuses, 'Agent Run 状态无效'),
    user_message_id: identifier(source.user_message_id, 'Agent Run 用户消息 ID 无效'),
    assistant_message_id: identifier(source.assistant_message_id, 'Agent Run 回复消息 ID 无效'),
    model_profile_id: identifier(source.model_profile_id, 'Agent Run 模型 ID 无效'),
    model_snapshot: decodeModelSnapshot(source.model_snapshot),
    reasoning_level: enumValue<AgentReasoningLevel>(source.reasoning_level, agentReasoningLevels, 'Agent Run 推理级别无效'),
    usage: decodeUsage(source.usage),
    error_code: optionalString(source.error_code, 'Agent Run 错误码无效', 256),
    error_message: optionalString(source.error_message, 'Agent Run 错误说明无效', 4096),
    revision: positiveInteger(source.revision, 'Agent Run revision 无效'),
    queued_at: timestamp(source.queued_at, 'Agent Run 排队时间无效'),
    started_at: optionalTimestamp(source.started_at, 'Agent Run 开始时间无效'),
    completed_at: optionalTimestamp(source.completed_at, 'Agent Run 完成时间无效'),
    updated_at: timestamp(source.updated_at, 'Agent Run 更新时间无效'),
  }
}

export function decodeAgentRunEvent(value: unknown): AgentRunEvent {
  const source = record(value, 'Agent Run Event 响应无效')
  const kind = enumValue<AgentRunEventKind>(source.kind, agentRunEventKinds, 'Agent Run Event 类型无效')
  const base = {
    id: identifier(source.id, 'Agent Run Event ID 无效'),
    run_id: identifier(source.run_id, 'Agent Run Event Run ID 无效'),
    generation: positiveInteger(source.generation, 'Agent Run Event generation 无效'),
    sequence: positiveInteger(source.sequence, 'Agent Run Event sequence 无效'),
    created_at: timestamp(source.created_at, 'Agent Run Event 创建时间无效'),
  }
  const payload = record(source.payload, 'Agent Run Event payload 无效')
  const branch = eventPayloadBranch(kind)
  const present = ['status', 'message_delta', 'message_part', 'tool', 'approval', 'steer', 'usage', 'error']
    .filter((key) => payload[key] !== undefined)
  if (present.length !== 1 || present[0] !== branch) {
    throw new AgentRuntimeProtocolError('Agent Run Event 判别分支无效')
  }
  switch (kind) {
    case 'status': {
      const status = record(payload.status, 'Agent status 事件无效')
      return { ...base, kind, payload: { status: { status: enumValue<AgentRunStatus>(status.status, agentRunStatuses, 'Agent status 事件状态无效') } } }
    }
    case 'message_delta': {
      const delta = record(payload.message_delta, 'Agent message delta 事件无效')
      return { ...base, kind, payload: { message_delta: {
        message_id: identifier(delta.message_id, 'Agent delta Message ID 无效'),
        part_id: identifier(delta.part_id, 'Agent delta Part ID 无效'),
        kind: enumValue(delta.kind, ['text', 'reasoning'] as const, 'Agent delta 片段类型无效'),
        delta: utf8(delta.delta, 'Agent delta 文本无效', 256 * 1024, true),
      } } }
    }
    case 'message_part':
      return { ...base, kind, payload: { message_part: decodeAgentMessagePart(payload.message_part) } }
    case 'tool_started':
    case 'tool_completed':
    case 'tool_failed': {
      const tool = record(payload.tool, 'Agent Tool 事件无效')
      return { ...base, kind, payload: { tool: {
        tool_call_id: identifier(tool.tool_call_id, 'Agent Tool Call ID 无效', 256),
        tool_name: utf8(tool.tool_name, 'Agent Tool 名称无效', 256),
        arguments: tool.arguments === undefined ? undefined : jsonValue(tool.arguments),
        result: tool.result === undefined ? undefined : jsonValue(tool.result),
        duration_ms: optionalNonNegativeInteger(tool.duration_ms, 'Agent Tool 耗时无效'),
        error_code: optionalString(tool.error_code, 'Agent Tool 错误码无效', 256),
      } } }
    }
    case 'approval_waiting':
    case 'approval_resolved': {
      const approval = record(payload.approval, 'Agent 审批事件无效')
      return { ...base, kind, payload: { approval: {
        approval_id: identifier(approval.approval_id, 'Agent 审批 ID 无效'),
        decision: optionalString(approval.decision, 'Agent 审批决定无效', 64),
      } } }
    }
    case 'steer': {
      const steer = record(payload.steer, 'Agent steer 事件无效')
      return { ...base, kind, payload: { steer: {
        client_request_id: identifier(steer.client_request_id, 'Agent steer 请求 ID 无效'),
        message_id: identifier(steer.message_id, 'Agent steer Message ID 无效'),
        part_id: identifier(steer.part_id, 'Agent steer Part ID 无效'),
      } } }
    }
    case 'usage':
      return { ...base, kind, payload: { usage: decodeUsage(payload.usage) } }
    case 'error': {
      const error = record(payload.error, 'Agent error 事件无效')
      return { ...base, kind, payload: { error: {
        code: utf8(error.code, 'Agent error code 无效', 256),
        message: utf8(error.message, 'Agent error message 无效', 256 * 1024, true),
      } } }
  }
}
}

export function decodeAgentRunEventPage(value: unknown): AgentRunEventPage {
  const source = record(value, 'Agent Run Event 列表响应无效')
  const items = array(source.items, 'Agent Run Event 列表无效', 200).map(decodeAgentRunEvent)
  unique(items.map(({ id }) => id), 'Agent Run Event 列表包含重复 ID')
  ascending(items.map(({ sequence }) => sequence), 'Agent Run Event sequence 无序')
  contiguous(items.map(({ sequence }) => sequence), 'Agent Run Event sequence 不连续')
  if (items.some((item) => item.run_id !== items[0]?.run_id || item.generation !== items[0]?.generation)) {
    throw new AgentRuntimeProtocolError('Agent Run Event 列表归属无效')
  }
  return {
    items,
    next_after_sequence: optionalPositiveInteger(source.next_after_sequence, 'Agent Run Event 增量游标无效'),
  }
}

export function decodeAgentWorkspaceEvent(value: unknown): AgentWorkspaceEvent {
  const source = record(value, 'Agent Workspace 事件无效')
  const revision = nonNegativeInteger(source.revision, 'Agent Workspace revision 无效')
  if (source.type === 'snapshot') {
    const sessions = array(source.sessions, 'Agent Workspace Session 快照无效').map(decodeAgentSession)
    const activeRuns = array(source.active_runs, 'Agent Workspace Run 快照无效').map(decodeAgentRun)
    unique(sessions.map(({ id }) => id), 'Agent Workspace Session 快照包含重复 ID')
    unique(activeRuns.map(({ id }) => id), 'Agent Workspace Run 快照包含重复 ID')
    if (activeRuns.length > 1 || activeRuns.some(({ status }) => !isAgentRunActive(status))) {
      throw new AgentRuntimeProtocolError('Agent Workspace 活动 Run 快照无效')
    }
    return { type: source.type, revision, sessions, active_runs: activeRuns }
  }
  if (revision === 0) {
    throw new AgentRuntimeProtocolError('Agent Workspace 增量 revision 无效')
  }
  if (source.type === 'upsert') {
    const keys = ['session', 'run', 'message', 'run_event'].filter((key) => source[key] !== undefined)
    if (keys.length !== 1) throw new AgentRuntimeProtocolError('Agent Workspace upsert 必须只包含一个实体')
    if (keys[0] === 'session') return { type: source.type, revision, session: decodeAgentSession(source.session) }
    if (keys[0] === 'run') return { type: source.type, revision, run: decodeAgentRun(source.run) }
    if (keys[0] === 'message') return { type: source.type, revision, message: decodeAgentMessage(source.message) }
    return { type: source.type, revision, run_event: decodeAgentRunEvent(source.run_event) }
  }
  if (source.type === 'removed') {
    return {
      type: source.type,
      revision,
      entity: enumValue(source.entity, ['session', 'run', 'message'] as const, 'Agent Workspace removed 实体无效'),
      id: identifier(source.id, 'Agent Workspace removed ID 无效'),
    }
  }
  throw new AgentRuntimeProtocolError('Agent Workspace 事件类型无效')
}

function decodeModelSnapshot(value: unknown): AgentRunModelSnapshot {
  const source = record(value, 'Agent Run 模型快照无效')
  return {
    api_mode: enumValue<AgentApiMode>(source.api_mode, agentApiModes, 'Agent Run API 模式无效'),
    base_url: utf8(source.base_url, 'Agent Run 模型地址无效', 2048),
    model_id: utf8(source.model_id, 'Agent Run 模型 ID 无效', 200),
    context_window_tokens: positiveInteger(source.context_window_tokens, 'Agent Run 上下文窗口无效'),
    max_output_tokens: positiveInteger(source.max_output_tokens, 'Agent Run 输出上限无效'),
    supports_images: bool(source.supports_images, 'Agent Run 图片能力无效'),
    supports_reasoning: bool(source.supports_reasoning, 'Agent Run reasoning 能力无效'),
  }
}

function decodeAgentContextCheckpoint(value: unknown) {
  const source = record(value, 'Agent 上下文 Checkpoint 无效')
  return {
    boundary_message_sequence: positiveInteger(
      source.boundary_message_sequence,
      'Agent 上下文 Checkpoint 消息边界无效',
    ),
    estimated_tokens: nonNegativeInteger(
      source.estimated_tokens,
      'Agent 上下文 Checkpoint Token 估算无效',
    ),
    created_at: timestamp(source.created_at, 'Agent 上下文 Checkpoint 创建时间无效'),
  }
}

function decodeUsage(value: unknown): AgentUsage {
  const source = record(value, 'Agent usage 无效')
  return {
    input_tokens: nonNegativeInteger(source.input_tokens, 'Agent input token 无效'),
    output_tokens: nonNegativeInteger(source.output_tokens, 'Agent output token 无效'),
    reasoning_tokens: nonNegativeInteger(source.reasoning_tokens, 'Agent reasoning token 无效'),
    total_tokens: nonNegativeInteger(source.total_tokens, 'Agent total token 无效'),
    estimated: bool(source.estimated, 'Agent usage 估算状态无效'),
  }
}

function eventPayloadBranch(kind: AgentRunEventKind) {
  if (kind.startsWith('tool_')) return 'tool'
  if (kind.startsWith('approval_')) return 'approval'
  return kind
}

function jsonValue(value: unknown, depth = 0): AgentJsonValue {
  if (depth > 32) throw new AgentRuntimeProtocolError('Agent JSON 投影嵌套过深')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, depth + 1))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item, depth + 1)]))
  }
  throw new AgentRuntimeProtocolError('Agent JSON 投影无效')
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentRuntimeProtocolError(message)
  return value as Record<string, unknown>
}

function array(value: unknown, message: string, maximumItems?: number) {
  if (!Array.isArray(value) || (maximumItems !== undefined && value.length > maximumItems)) {
    throw new AgentRuntimeProtocolError(message)
  }
  return value
}

function identifier(value: unknown, message: string, maxBytes = 128) {
  return utf8(value, message, maxBytes)
}

function utf8(value: unknown, message: string, maxBytes: number, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || new TextEncoder().encode(value).byteLength > maxBytes) {
    throw new AgentRuntimeProtocolError(message)
  }
  return value
}

function optionalString(value: unknown, message: string, maxBytes: number) {
  return value === undefined ? undefined : utf8(value, message, maxBytes, true)
}

function bool(value: unknown, message: string) {
  if (typeof value !== 'boolean') throw new AgentRuntimeProtocolError(message)
  return value
}

function nonNegativeInteger(value: unknown, message: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new AgentRuntimeProtocolError(message)
  return Number(value)
}

function positiveInteger(value: unknown, message: string) {
  const result = nonNegativeInteger(value, message)
  if (result === 0) throw new AgentRuntimeProtocolError(message)
  return result
}

function optionalPositiveInteger(value: unknown, message: string) {
  return value === undefined ? undefined : positiveInteger(value, message)
}

function optionalNonNegativeInteger(value: unknown, message: string) {
  return value === undefined ? undefined : nonNegativeInteger(value, message)
}

function timestamp(value: unknown, message: string) {
  const result = utf8(value, message, 64)
  if (!Number.isFinite(Date.parse(result))) throw new AgentRuntimeProtocolError(message)
  return result
}

function optionalTimestamp(value: unknown, message: string) {
  return value === undefined ? undefined : timestamp(value, message)
}

function enumValue<T extends string>(value: unknown, values: readonly T[], message: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new AgentRuntimeProtocolError(message)
  return value as T
}

function unique(values: string[], message: string) {
  if (new Set(values).size !== values.length) throw new AgentRuntimeProtocolError(message)
}

function ascending(values: number[], message: string) {
  if (values.some((value, index) => index > 0 && value <= values[index - 1]!)) {
    throw new AgentRuntimeProtocolError(message)
  }
}

function contiguous(values: number[], message: string) {
  if (values.some((value, index) => index > 0 && value !== values[index - 1]! + 1)) {
    throw new AgentRuntimeProtocolError(message)
  }
}
