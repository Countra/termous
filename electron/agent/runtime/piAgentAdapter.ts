import { createRuntimeSystemPrompt } from './runtimeSystemPrompt.ts'
import { hydrateRuntimeMessages, standardMessages } from '../context/runtimeMessages.ts'
import { createHistoryImageTool } from '../tools/historyImageTool.ts'
import { createProviderModel, createRestrictedProviderFetch, createRuntimeStreamFunction, type RuntimeModel } from '../provider/runtimeProviderAdapter.ts'
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentToolResult,
} from '@earendil-works/pi-agent-core'
import { normalizeContext, toToolDeclaration } from '@earendil-works/pi-ai/utils/transcript'
import type { AgentMCPConnection } from '../contracts/mcpTools.ts'
import { isMCPToolDetails, requiresDesktopImages } from '../contracts/mcpTools.ts'
import { PiEventBridge, type PiRunOutcome } from './piEventBridge.ts'
import type { AgentSkillBundleSnapshot } from '../contracts/skillBundle.ts'
import { createSkillResourceTool } from '../tools/skillResourceTool.ts'
import { localToolNames } from '../contracts/toolNames.ts'
import { RuntimeToolDiscovery } from '../tools/runtimeToolDiscovery.ts'
import { RuntimeExecutionBudget } from '../execution/runtimeExecutionBudget.ts'
import { RuntimeInputSafety } from '../execution/runtimeInputSafety.ts'
import { measuredRuntimeStream } from './runtimeRequestMetrics.ts'
import { RuntimeImageWorkingSet, pendingPreviewCall } from '../context/runtimeImageWorkingSet.ts'
import { bindWorkflowPreparation, createWorkflowWaitTool } from '../tools/runtimeWorkflowWait.ts'
import { RuntimeToolProgress } from '../tools/runtimeToolProgress.ts'
import type { RuntimeContextImageReference } from '../contracts/runtimeCheckpoint.ts'
import type { RuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'
import type { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { RuntimeContextImages } from '../context/runtimeContextImages.ts'
import { createRuntimeContextGate, runtimeContextFailureMessage } from './runtimeContextGate.ts'
import { createRuntimeRetryStreamFunction } from '../provider/runtimeProviderRetry.ts'
import { bindRuntimeResourceTools } from '../tools/runtimeResourceRouting.ts'
import type { RuntimeCheckpointInput, RuntimeCheckpointResult } from '../contracts/runtimeCheckpoint.ts'
import type { RuntimeSteerResult } from '../contracts/runtimeEvents.ts'
import { runtimeContextFingerprint, runtimeProviderUsage } from '../provider/runtimeProviderUsage.ts'

export interface PiAgentController {
  continue(): Promise<PiRunOutcome>
  abort(): void
  waitForIdle(): Promise<void>
  steer(message: string, source: Pick<RuntimeSteerResult, 'message_id' | 'part_id'>): void
  hasQueuedMessages(): boolean
  close(): void
}

export interface CreatePiAgentOptions {
  audit?: { capture(event: AgentEvent): void }
  bootstrap: RuntimeBootstrap
  mcp: AgentMCPConnection
  events: RuntimeEventWriter
  skills: AgentSkillBundleSnapshot
  fetch?: typeof globalThis.fetch
  now?: () => number
  newPartID?: () => string
  readHistoryImage?(reference: RuntimeContextImageReference, signal?: AbortSignal): Promise<{ data: string; mime_type: string }>
  commitCheckpoint(input: RuntimeCheckpointInput, signal?: AbortSignal): Promise<RuntimeCheckpointResult>
  onFailure?: (error: unknown) => void
}

export function createRuntimeModel(bootstrap: RuntimeBootstrap): RuntimeModel {
  return createProviderModel(bootstrap.model.snapshot)
}

export function createPiAgent(options: CreatePiAgentOptions): PiAgentController {
  const model = createRuntimeModel(options.bootstrap)
  const providerFetch = createRestrictedProviderFetch(
    model.baseUrl,
    options.bootstrap.model.api_key === undefined,
    options.fetch,
  )
  const images = new RuntimeContextImages(options.bootstrap)
  const systemPrompt = createRuntimeSystemPrompt(options.bootstrap, options.skills)
  const budget = new RuntimeExecutionBudget(options.bootstrap.model.snapshot.execution_budget)
  const inputSafety = new RuntimeInputSafety()
  const toolProgress = new RuntimeToolProgress()
  let aborted = false
  const executionFailure = () => aborted ? undefined : inputSafety.failure() ?? budget.failure()
  const imageWorkingSet = new RuntimeImageWorkingSet(images)
  const boundTools = bindWorkflowPreparation(bindRuntimeResourceTools(options.mcp, options.bootstrap.session.resource_bindings), options.mcp.originalName).map((tool) => {
    const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties
    if (options.mcp.originalName(tool.name) !== 'termous.desktop_workflows.templates.preview' || !properties?.compact) return tool
    return { ...tool, execute: (id, args, signal, update) => tool.execute(id, { compact: true, ...(args as Record<string, unknown>) }, signal, update) } as typeof tool
  })
  let modelMessages: AgentMessage[] = []
  const hasSkill = (content: string) => modelMessages.some((message) => message.role === 'toolResult' && message.content.some((part) => part.type === 'text' && part.text === content))
  const skillTool = createSkillResourceTool(options.skills, hasSkill, (content) => discovery.loadReferencedTools(content))
  const historyTool = createHistoryImageTool(async (reference, signal) => {
    if (!model.input.includes('image')) throw new Error('AGENT_RUNTIME_MODEL_IMAGE_UNSUPPORTED')
    if (!options.readHistoryImage) throw new Error('AGENT_RUNTIME_IMAGE_UNAVAILABLE')
    await options.events.flush()
    return options.readHistoryImage(reference, signal)
  })
  const discovery = new RuntimeToolDiscovery([...boundTools, ...createWorkflowWaitTool(boundTools, options.mcp.originalName)], options.mcp.originalName, [skillTool, historyTool],
    (name) => inputSafety.blockedTool(name, name === 'termous.desktop_workflows.runs.control' ? { action: 'cancel' } : undefined),
    (name) => toolProgress.rediscover(name))
  let tools = discovery.active()
  let toolDeclarations = tools.map(toToolDeclaration)
  const fingerprint = () => runtimeContextFingerprint(model, systemPrompt + imageWorkingSet.key(), tools.map(({ name, description, parameters }) => ({ name, description, parameters })), options.bootstrap.run.provider_id, options.bootstrap.run.model_id)
  let contextFingerprint = fingerprint()
  const baseStream = createRuntimeStreamFunction(options.bootstrap.model.api_key, providerFetch)
  const secrets = options.bootstrap.model.api_key ? [options.bootstrap.model.api_key] : []
  const streamFn = measuredRuntimeStream(baseStream, budget, options.events, options.bootstrap.context.request_usage_supported === true, 'response', secrets)
  const summaryStream = measuredRuntimeStream(baseStream, budget, options.events, options.bootstrap.context.request_usage_supported === true, 'compaction', secrets)
  const bridge = new PiEventBridge({
    writer: options.events,
    assistantMessageID: options.bootstrap.run.assistant_message_id,
    originalToolName: (name) => localToolNames.has(name)
      ? name
      : options.mcp.originalName(name),
    now: options.now,
    newPartID: options.newPartID,
    providerErrorSecrets: options.bootstrap.model.api_key ? [options.bootstrap.model.api_key] : [],
    onToolResult: (partID, message) => images.registerToolResult(partID, message),
    requestFailure: () => {
      if (executionFailure()) return executionFailure()
      const failure = compaction.failure()
      return failure ? { code: failure.code, message: runtimeContextFailureMessage(failure.code, failure.detail) } : undefined
    },
  })
  const compaction = createRuntimeContextGate({
    bootstrap: options.bootstrap, model, systemPrompt, tools, streamFn: summaryStream, bridge, images,
    events: options.events, commitCheckpoint: options.commitCheckpoint, now: options.now,
    projectMessages: (messages, commit) => projectImages(messages, commit).messages,
    retainToolCall: pendingPreviewCall,
  })
  const projectImages = (messages: AgentMessage[], commit: boolean) => {
    const projected = imageWorkingSet.project(standardMessages(messages), commit)
    if (commit && projected.changed) {
      compaction.invalidateUsage(messages)
      contextFingerprint = fingerprint()
    }
    return projected
  }
  const retryPositions = new Map<string, number>()
  const retryStreamFn = createRuntimeRetryStreamFunction(streamFn, {
    providerErrorSecrets: options.bootstrap.model.api_key ? [options.bootstrap.model.api_key] : [],
    onDiscardedUsage: (usage) => bridge.addUsage(usage),
    onFailedAttempt: (message) => bridge.finalizeFailedAttempt(message),
    onActivity: async (activity) => {
      const position = retryPositions.get(activity.retry_id) ?? bridge.partSequence()
      retryPositions.set(activity.retry_id, position)
      options.events.push('retry', { retry: {
        ...activity, assistant_message_id: options.bootstrap.run.assistant_message_id,
        purpose: 'response', after_part_sequence: position,
      } })
      await options.events.flush()
      if (activity.status === 'completed' || activity.status === 'failed' || activity.status === 'cancelled') {
        retryPositions.delete(activity.retry_id)
      }
    },
  })
  const observedCalls = new Set<string>()
  const callArguments = new Map<string, unknown>()
  const observeToolResult = (id: string, name: string, args: unknown, result: AgentToolResult<unknown>, isError: boolean) => {
    if (observedCalls.has(id)) return
    observedCalls.add(id)
    inputSafety.observe(options.mcp.originalName(name) ?? name, result, isError)
    budget.evaluate({ type: 'tool_result', name: options.mcp.originalName(name) ?? name, args, result, isError })
    return toolProgress.observe(options.mcp.originalName(name) ?? name, args, result, isError)
  }
  const steerSources = new WeakMap<AgentMessage, Pick<RuntimeSteerResult, 'message_id' | 'part_id'>>()
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: options.bootstrap.run.reasoning_level,
      tools,
      messages: hydrateRuntimeMessages(options.bootstrap, model, contextFingerprint),
    },
    // 系统提示和工具只来自本轮可信配置；压缩与 Core 快照仍只处理业务历史。
    convertToLlm: (messages) => normalizeContext({
      systemPrompt, tools: toolDeclarations, messages: standardMessages(messages),
    }).messages,
    transformContext: async (messages, signal) => {
      modelMessages = await compaction.transformContext(standardMessages(messages), signal)
      toolProgress.contextChanged((uri) => options.skills.resources.some((resource) => resource.uri === uri && hasSkill(resource.content)))
      return modelMessages
    },
    prepareNextTurnWithContext: ({ context }) => {
      const next = discovery.publish().filter((tool) => !toolProgress.hidden(options.mcp.originalName(tool.name) ?? tool.name))
      if (next.map((tool) => tool.name).join() !== tools.map((tool) => tool.name).join()) {
        tools = next
        toolDeclarations = tools.map(toToolDeclaration)
        contextFingerprint = fingerprint()
        compaction.updateTools(tools, context.messages)
      }
      return { context: { ...context, tools } }
    },
    finishTurn: async ({ toolResults }, signal) => {
      if (signal?.aborted) { aborted = true; return { action: 'end' } }
      for (const result of toolResults) {
        observeToolResult(result.toolCallId, result.toolName, callArguments.get(result.toolCallId), { content: result.content, details: result.details }, result.isError)
        observedCalls.delete(result.toolCallId)
        callArguments.delete(result.toolCallId)
      }
      const failure = executionFailure()
      if (failure) { bridge.stopLocally(failure); return { action: 'end' } }
      return undefined
    },
    streamFn: (requestModel, context, streamOptions) => {
      compaction.beforeProviderRequest()
      // HTTP 失败可能没有 start，必须先隔离上一工具轮已完成的消息片段。
      bridge.beginAssistantRequest()
      return retryStreamFn(requestModel, context, streamOptions)
    },
    sessionId: options.bootstrap.session.id,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'sequential',
    beforeToolCall: async ({ toolCall }, signal) => {
      if (signal?.aborted) { aborted = true; return { block: true, terminate: true, reason: '任务已取消' } }
      const name = options.mcp.originalName(toolCall.name) ?? toolCall.name
      const decision = inputSafety.failure() ? undefined : budget.evaluate({ type: 'before_tool', name, args: toolCall.arguments })
      const failure = inputSafety.failure() ?? (decision && !decision.allowed ? decision.reason : undefined)
      if (failure) return { block: true, terminate: true, reason: failure.message }
      const safetyBlock = inputSafety.blockedTool(name, toolCall.arguments)
      if (safetyBlock) return { block: true, reason: safetyBlock }
      const progressBlock = toolProgress.beforeCall(name, toolCall.arguments)
      if (progressBlock) return { block: true, reason: progressBlock }
      discovery.touch(toolCall.name)
      if (!model.input.includes('image') && requiresDesktopImages(options.mcp.originalName(toolCall.name))) {
        return { block: true, reason: 'AGENT_RUNTIME_MODEL_IMAGE_UNSUPPORTED：当前模型不支持图片，可管理已有脚本；请切换支持图片的模型后截图、查看或确认图像模板。' }
      }
      return undefined
    },
    afterToolCall: async ({ result, toolCall, isError }) => {
      const guidance = observeToolResult(toolCall.id, toolCall.name, toolCall.arguments, result, isError)
      if (isMCPToolDetails(result.details) && result.details.result.isError === true) {
        return { isError: true }
      }
      if (guidance) return { content: [...result.content, { type: 'text', text: guidance }] }
      return undefined
    },
  })
  const unsubscribe = agent.subscribe((event) =>
    handlePiEvent(event, {
      handle: async (value) => {
        options.audit?.capture(value)
        if (value.type === 'message_end' && value.message.role === 'user') {
          const source = steerSources.get(value.message)
          if (source) {
            options.events.push('steer_applied', { steer_applied: { message_id: source.message_id, part_id: source.part_id } })
            steerSources.delete(value.message)
          }
        }
        bridge.handle(value)
        if (value.type === 'message_end' && value.message.role === 'assistant') {
          for (const part of value.message.content) if (part.type === 'toolCall') callArguments.set(part.id, part.arguments)
        }
        if (value.type === 'message_end' && value.message.role === 'toolResult') {
          const result = value.message
          observeToolResult(result.toolCallId, result.toolName, callArguments.get(result.toolCallId), { content: result.content, details: result.details }, result.isError)
        }
        if (value.type === 'message_end' && value.message.role === 'assistant') {
          // 旧 Core 严格拒绝未知事件字段，只有启动时明确声明支持才发送可恢复的单次用量。
          const providerUsage = options.bootstrap.context.provider_usage_supported === true
            ? runtimeProviderUsage(value.message, bridge.lastAssistantPartID(), contextFingerprint)
            : undefined
          // 最终失败片段保留在历史中，但下次请求会排除它；即时占用使用同一活动上下文。
          const contextMessages = value.message.stopReason === 'error' || value.message.stopReason === 'aborted'
            ? agent.state.messages.slice(0, -1)
            : agent.state.messages
          await compaction.observeContext(standardMessages(contextMessages), providerUsage)
        }
      },
    }, options.onFailure, () => { aborted = true; agent.abort() })
  )
  let closed = false

  return {
    continue: async () => {
      await agent.continue()
      await agent.waitForIdle()
      if (executionFailure() && bridge.outcome() !== 'cancelled') bridge.stopLocally(executionFailure()!)
      return aborted ? 'cancelled' : bridge.outcome()
    },
    abort: () => { aborted = true; agent.abort() },
    waitForIdle: () => agent.waitForIdle(),
    steer: (message, source) => {
      toolProgress.reset()
      const user: AgentMessage = { role: 'user', content: message, timestamp: (options.now ?? Date.now)() }
      steerSources.set(user, { message_id: source.message_id, part_id: source.part_id })
      agent.steer(user)
    },
    hasQueuedMessages: () => agent.hasQueuedMessages(),
    close: () => {
      if (closed) {
        return
      }
      closed = true
      unsubscribe()
      agent.clearAllQueues()
    },
  }
}

export async function handlePiEvent(
  event: AgentEvent,
  bridge: { handle(event: AgentEvent): void | Promise<void> },
  onFailure: ((error: unknown) => void) | undefined,
  abort: () => void,
) {
  try {
    await bridge.handle(event)
  } catch (error) {
    try {
      onFailure?.(error)
    } catch {
      // 失败通知不能阻断 Agent 的本地取消与资源回收。
    }
    try {
      abort()
    } catch {
      // pi 监听器不得把异常反向抛回事件分发链路。
    }
  }
}
