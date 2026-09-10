import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolResultMessage,
} from '@earendil-works/pi-ai'
import { isMCPToolDetails } from './mcpClientAdapter.ts'
import {
  addRuntimeUsage,
  emptyRuntimeUsage,
  projectPiUsage,
  type RuntimeUsage,
} from './runtimeUsage.ts'
import { isSkillResourceToolDetails } from './skillResourceTool.ts'
import { projectToolTimelineValue } from './toolTimelineProjection.ts'
import { runtimeProviderFailure, sanitizeRuntimeProviderError } from './runtimeProviderFailure.ts'
import type { RuntimeEventKind } from './workerCoreClient.ts'

const maximumDeltaBytes = 240 * 1024

export type PiRunOutcome = 'completed' | 'cancelled' | 'failed'

export interface PiEventBridgeOptions {
  writer: RuntimeEventSink
  assistantMessageID: string
  originalToolName: (encodedName: string) => string | null
  now?: () => number
  newPartID?: () => string
  onToolResult?: (partID: string, message: ToolResultMessage) => void
  requestFailure?: () => { code: string; message: string } | undefined
  providerErrorSecrets?: readonly string[]
}

export interface RuntimeEventSink {
  push(kind: RuntimeEventKind, payload: Record<string, unknown>): unknown
}

interface StreamPartRef {
  id: string
  kind: 'text' | 'reasoning' | 'tool_call'
  text: string
}

export class PiEventBridge {
  private readonly writer: RuntimeEventSink
  private readonly assistantMessageID: string
  private readonly originalToolName: (encodedName: string) => string | null
  private readonly now: () => number
  private readonly newPartID: () => string
  private readonly streamParts = new Map<number, StreamPartRef>()
  private readonly toolStartedAt = new Map<string, number>()
  private messagePartSequence = 0
  private persistedAssistantPartID: string | undefined
  private runOutcome: PiRunOutcome = 'completed'
  private usage: RuntimeUsage
  private readonly onToolResult?: PiEventBridgeOptions['onToolResult']
  private readonly requestFailure?: PiEventBridgeOptions['requestFailure']
  private readonly providerErrorSecrets: readonly string[]

  constructor(options: PiEventBridgeOptions) {
    this.writer = options.writer
    this.assistantMessageID = options.assistantMessageID
    this.originalToolName = options.originalToolName
    this.now = options.now ?? Date.now
    this.newPartID = options.newPartID ?? (() => `agp_${randomUUID()}`)
    this.usage = emptyRuntimeUsage()
    this.onToolResult = options.onToolResult
    this.requestFailure = options.requestFailure
    this.providerErrorSecrets = options.providerErrorSecrets ?? []
  }

  handle(event: AgentEvent) {
    switch (event.type) {
      case 'message_start':
        if (event.message.role === 'assistant') {
          this.beginAssistantRequest()
        }
        return
      case 'message_update':
        this.handleMessageUpdate(event.assistantMessageEvent)
        return
      case 'message_end':
        this.handleMessageEnd(event.message)
        return
      case 'tool_execution_start':
        this.handleToolStart(event.toolCallId, event.toolName, event.args)
        return
      case 'tool_execution_end':
        this.handleToolEnd(
          event.toolCallId,
          event.toolName,
          event.result,
          event.isError,
        )
        return
      default:
        return
    }
  }

  outcome() {
    return this.runOutcome
  }

  partSequence() {
    return this.messagePartSequence
  }

  lastAssistantPartID() {
    return this.persistedAssistantPartID
  }

  addUsage(increment: RuntimeUsage) {
    this.usage = addRuntimeUsage(this.usage, increment)
    this.writer.push('usage', { usage: { ...this.usage } })
  }

  beginAssistantRequest() {
    this.streamParts.clear()
    this.persistedAssistantPartID = undefined
  }

  finalizeFailedAttempt(message: AssistantMessage) {
    this.persistAssistantContent(message, this.responseFailure(message))
    this.beginAssistantRequest()
  }

  private handleMessageUpdate(event: AssistantMessageEvent) {
    if (event.type !== 'text_delta' && event.type !== 'thinking_delta') {
      return
    }
    const kind = event.type === 'text_delta' ? 'text' : 'reasoning'
    const part = this.streamPart(event.contentIndex, kind)
    part.text += event.delta
    for (const delta of splitUTF8(event.delta, maximumDeltaBytes)) {
      if (delta.length === 0) {
        continue
      }
      this.writer.push('message_delta', {
        message_delta: {
          message_id: this.assistantMessageID,
          part_id: part.id,
          kind,
          delta,
        },
      })
    }
  }

  private handleMessageEnd(message: AgentMessage) {
    if (message.role === 'assistant') {
      this.persistAssistantMessage(message)
      return
    }
    if (message.role === 'toolResult') {
      this.persistToolResult(message)
    }
  }

  private persistAssistantMessage(message: AssistantMessage) {
    this.persistedAssistantPartID = undefined
    this.persistAssistantContent(message,
      message.stopReason === 'error' || message.stopReason === 'aborted' ? this.responseFailure(message) : undefined)
    const requestFailure = message.stopReason === 'error' || message.stopReason === 'aborted'
      ? this.requestFailure?.() : undefined
    // 门禁阻止触网后 pi 会合成零用量终态，不能据此把已确认的摘要用量降为部分统计。
    if (!requestFailure) this.addUsage(projectPiUsage(message.usage))
    if (message.stopReason === 'error') {
      this.runOutcome = 'failed'
      this.writer.push('error', {
        error: requestFailure
          ? { ...requestFailure, message: sanitizeRuntimeProviderError(requestFailure.message, this.providerErrorSecrets) }
          : runtimeProviderFailure(message.errorMessage, this.providerErrorSecrets),
      })
    } else if (message.stopReason === 'aborted') {
      this.runOutcome = 'cancelled'
    }
  }

  private responseFailure(message: AssistantMessage) {
    return {
      attempt_id: `agrat_${randomUUID()}`,
      // pi 的取消终态仍可能携带断流诊断；保留历史标记，但不将主动停止展示为请求失败。
      error_message: message.stopReason === 'aborted'
        ? '' : sanitizeRuntimeProviderError(message.errorMessage ?? '', this.providerErrorSecrets),
    }
  }

  private persistAssistantContent(message: AssistantMessage, failure?: ReturnType<PiEventBridge['responseFailure']>) {
    const metadata = failure ? { response_failure: failure } : {}
    const indices = new Set(message.content.map((_, index) => index))
    if (failure) for (const index of this.streamParts.keys()) indices.add(index)
    for (const contentIndex of [...indices].sort((left, right) => left - right)) {
      let content = message.content[contentIndex]
      const streamed = this.streamParts.get(contentIndex)
      // 某些断流终态丢失 content，保留此前已经展示的正文，且不能把它恢复成有效模型上下文。
      if (failure && streamed?.text && (!content
        || (content.type === 'text' && content.text.length < streamed.text.length)
        || (content.type === 'thinking' && content.thinking.length < streamed.text.length))) {
        content = streamed.kind === 'reasoning'
          ? { type: 'thinking', thinking: streamed.text }
          : { type: 'text', text: streamed.text }
      }
      if (!content) continue
      if (content.type === 'text') {
        if (failure && content.text.length === 0) continue
        const part = this.streamPart(contentIndex, 'text')
        this.pushMessagePart(part.id, 'text', { text: { text: content.text }, ...metadata })
        this.persistedAssistantPartID = part.id
        continue
      }
      if (content.type === 'thinking') {
        if (failure && content.thinking.length === 0) continue
        const part = this.streamPart(contentIndex, 'reasoning')
        this.pushMessagePart(part.id, 'reasoning', {
          reasoning: {
            text: content.thinking,
            ...(content.thinkingSignature ? { thinking_signature: content.thinkingSignature } : {}),
          },
          ...metadata,
        })
        this.persistedAssistantPartID = part.id
        continue
      }
      // 失败请求中的工具尚未执行；名称或 ID 仍未形成时不能伪造合法工具记录。
      if (failure && (!content.id || !this.originalToolName(content.name))) continue
      const part = this.streamPart(contentIndex, 'tool_call')
      this.pushMessagePart(part.id, 'tool_call', {
        tool_call: {
          tool_call_id: content.id,
          tool_name: this.requireOriginalToolName(content.name),
          arguments: content.arguments,
        },
        ...metadata,
      })
      this.persistedAssistantPartID = part.id
    }
  }

  private persistToolResult(message: ToolResultMessage) {
    const partID = this.newPartID()
    this.pushMessagePart(partID, 'tool_result', {
      tool_result: {
        tool_call_id: message.toolCallId,
        tool_name: this.requireOriginalToolName(message.toolName),
        content: message.content,
        is_error: message.isError,
      },
    })
    this.onToolResult?.(partID, message)
  }

  private handleToolStart(toolCallID: string, encodedName: string, args: unknown) {
    this.toolStartedAt.set(toolCallID, this.now())
    this.writer.push('tool_started', {
      tool: {
        tool_call_id: toolCallID,
        tool_name: this.requireOriginalToolName(encodedName),
        arguments: projectToolTimelineValue(args),
      },
    })
  }

  private handleToolEnd(
    toolCallID: string,
    encodedName: string,
    result: unknown,
    isError: boolean,
  ) {
    const startedAt = this.toolStartedAt.get(toolCallID)
    this.toolStartedAt.delete(toolCallID)
    const duration = startedAt === undefined
      ? 0
      : Math.max(0, Math.round(this.now() - startedAt))
    const projected = projectToolResult(result)
    this.writer.push(isError ? 'tool_failed' : 'tool_completed', {
      tool: {
        tool_call_id: toolCallID,
        tool_name: this.requireOriginalToolName(encodedName),
        result: projected,
        duration_ms: duration,
        ...(isError ? { error_code: 'MCP_TOOL_FAILED' } : {}),
      },
    })
  }

  private pushMessagePart(
    id: string,
    kind: 'text' | 'reasoning' | 'tool_call' | 'tool_result',
    content: Record<string, unknown>,
  ) {
    this.writer.push('message_part', {
      message_part: {
        id,
        message_id: this.assistantMessageID,
        kind,
        sequence: ++this.messagePartSequence,
        content,
      },
    })
  }

  private streamPart(index: number, kind: StreamPartRef['kind']) {
    const current = this.streamParts.get(index)
    if (current) {
      if (current.kind !== kind) {
        throw new Error('AGENT_MODEL_STREAM_INVALID')
      }
      return current
    }
    const created = { id: this.newPartID(), kind, text: '' }
    this.streamParts.set(index, created)
    return created
  }

  private requireOriginalToolName(encodedName: string) {
    const original = this.originalToolName(encodedName)
    if (!original) {
      throw new Error('AGENT_MCP_TOOL_NAME_UNKNOWN')
    }
    return original
  }

}

function projectToolResult(result: unknown) {
  if (typeof result !== 'object' || result === null) {
    return projectToolTimelineValue(result)
  }
  const details = (result as { details?: unknown }).details
  if (isMCPToolDetails(details)) {
    return projectToolTimelineValue({
      content: details.result.content.map(projectMCPContentBlock),
      ...(details.result.structuredContent !== undefined
        ? { structured_content: details.result.structuredContent }
        : {}),
      is_error: details.result.isError === true,
    })
  }
  if (isSkillResourceToolDetails(details)) {
    return {
      uri: details.uri,
      sha256: details.sha256,
      size: details.size,
    }
  }
  return projectToolTimelineValue({
    content: jsonValue((result as { content?: unknown }).content),
  })
}

function projectMCPContentBlock(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const block = value as Record<string, unknown>
  if (block.type === 'image' || block.type === 'audio') {
    return {
      type: block.type,
      mime_type: block.mimeType,
      data: '[二进制内容已省略]',
    }
  }
  if (block.type === 'resource' && typeof block.resource === 'object' && block.resource !== null) {
    const resource = block.resource as Record<string, unknown>
    return {
      type: 'resource',
      resource: {
        uri: resource.uri,
        mime_type: resource.mimeType,
        ...(typeof resource.text === 'string' ? { text: resource.text } : {}),
        ...(resource.blob !== undefined ? { blob: '[二进制内容已省略]' } : {}),
      },
    }
  }
  return block
}

function jsonValue(value: unknown): unknown {
  if (value === undefined) {
    return null
  }
  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return null
  }
}

function splitUTF8(value: string, maximumBytes: number) {
  if (Buffer.byteLength(value, 'utf8') <= maximumBytes) {
    return [value]
  }
  const chunks: string[] = []
  let current = ''
  let bytes = 0
  for (const character of value) {
    const size = Buffer.byteLength(character, 'utf8')
    if (bytes + size > maximumBytes && current !== '') {
      chunks.push(current)
      current = ''
      bytes = 0
    }
    current += character
    bytes += size
  }
  if (current !== '') {
    chunks.push(current)
  }
  return chunks
}
