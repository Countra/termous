import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolResultMessage,
  Usage,
} from '@earendil-works/pi-ai'
import { isMCPToolDetails } from './mcpClientAdapter.ts'
import { isSkillResourceToolDetails } from './skillResourceTool.ts'
import { projectToolTimelineValue } from './toolTimelineProjection.ts'
import type { RuntimeEventKind } from './workerCoreClient.ts'

const maximumDeltaBytes = 240 * 1024

export type PiRunOutcome = 'completed' | 'cancelled' | 'failed'

export interface PiEventBridgeOptions {
  writer: RuntimeEventSink
  assistantMessageID: string
  originalToolName: (encodedName: string) => string | null
  now?: () => number
  newPartID?: () => string
}

export interface RuntimeEventSink {
  push(kind: RuntimeEventKind, payload: Record<string, unknown>): unknown
}

interface StreamPartRef {
  id: string
  kind: 'text' | 'reasoning' | 'tool_call'
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
  private runOutcome: PiRunOutcome = 'completed'
  private usage = emptyRuntimeUsage()

  constructor(options: PiEventBridgeOptions) {
    this.writer = options.writer
    this.assistantMessageID = options.assistantMessageID
    this.originalToolName = options.originalToolName
    this.now = options.now ?? Date.now
    this.newPartID = options.newPartID ?? (() => `agp_${randomUUID()}`)
  }

  handle(event: AgentEvent) {
    switch (event.type) {
      case 'message_start':
        if (event.message.role === 'assistant') {
          this.streamParts.clear()
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

  private handleMessageUpdate(event: AssistantMessageEvent) {
    if (event.type !== 'text_delta' && event.type !== 'thinking_delta') {
      return
    }
    const kind = event.type === 'text_delta' ? 'text' : 'reasoning'
    const part = this.streamPart(event.contentIndex, kind)
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
    message.content.forEach((content, contentIndex) => {
      if (content.type === 'text') {
        const part = this.streamPart(contentIndex, 'text')
        this.pushMessagePart(part.id, 'text', { text: { text: content.text } })
        return
      }
      if (content.type === 'thinking') {
        const part = this.streamPart(contentIndex, 'reasoning')
        this.pushMessagePart(part.id, 'reasoning', {
          reasoning: {
            text: content.thinking,
            ...(content.thinkingSignature
              ? { thinking_signature: content.thinkingSignature }
              : {}),
          },
        })
        return
      }
      const part = this.streamPart(contentIndex, 'tool_call')
      this.pushMessagePart(part.id, 'tool_call', {
        tool_call: {
          tool_call_id: content.id,
          tool_name: this.requireOriginalToolName(content.name),
          arguments: content.arguments,
        },
      })
    })
    this.addUsage(message.usage)
    this.writer.push('usage', { usage: { ...this.usage } })
    if (message.stopReason === 'error') {
      this.runOutcome = 'failed'
      this.writer.push('error', {
        error: {
          code: 'AGENT_MODEL_REQUEST_FAILED',
          message: '模型请求失败',
        },
      })
    } else if (message.stopReason === 'aborted') {
      this.runOutcome = 'cancelled'
    }
  }

  private persistToolResult(message: ToolResultMessage) {
    this.pushMessagePart(this.newPartID(), 'tool_result', {
      tool_result: {
        tool_call_id: message.toolCallId,
        tool_name: this.requireOriginalToolName(message.toolName),
        content: message.content,
        is_error: message.isError,
      },
    })
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
    const created = { id: this.newPartID(), kind }
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

  private addUsage(usage: Usage) {
    const input = safeTokenCount(usage.input)
      + safeTokenCount(usage.cacheRead)
      + safeTokenCount(usage.cacheWrite)
    const output = safeTokenCount(usage.output)
    const total = Math.max(safeTokenCount(usage.totalTokens), input + output)
    this.usage.input_tokens += input
    this.usage.output_tokens += output
    this.usage.reasoning_tokens += Math.min(output, safeTokenCount(usage.reasoning ?? 0))
    this.usage.total_tokens += total
    this.usage.estimated ||= total === 0
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

function emptyRuntimeUsage() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    estimated: false,
  }
}

function safeTokenCount(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
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
