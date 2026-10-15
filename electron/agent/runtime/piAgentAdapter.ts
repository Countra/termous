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
import { runtimePrerequisiteTools } from '../tools/runtimeToolNavigation.ts'
import { RuntimeExecutionBudget } from '../execution/runtimeExecutionBudget.ts'
import { RuntimeInputSafety } from '../execution/runtimeInputSafety.ts'
import { measuredRuntimeStream } from './runtimeRequestMetrics.ts'
import { RuntimeImageWorkingSet, pendingPreviewCall } from '../context/runtimeImageWorkingSet.ts'
import { bindWorkflowPreparation, createWorkflowWaitTool } from '../tools/runtimeWorkflowWait.ts'
import { RuntimeToolProgress } from '../tools/runtimeToolProgress.ts'
import { RuntimeSkillContext, skillResourcePresent } from '../tools/runtimeSkillContext.ts'
import { progressData, progressDigest } from '../tools/runtimeToolEvidence.ts'
import { estimateRuntimeMessageTokens } from '../context/runtimeContextTokens.ts'
import { clearRuntimeCompactionUsage } from '../context/compaction/runtimeCompactionPolicy.ts'
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
  const toolProgress = new RuntimeToolProgress(options.now, (name) => discovery.available(name))
  const skillContext = new RuntimeSkillContext(options.skills)
  let supplementalFingerprint = progressDigest([])
  let supplementalTokens = 0
  let requestSupplementalTokens = 0
  const requestSupplements = new WeakMap<AgentMessage, number>()
  let aborted = false
  const executionFailure = () => aborted ? undefined : inputSafety.failure() ?? budget.failure()
  const imageWorkingSet = new RuntimeImageWorkingSet(images)
  const boundTools = bindWorkflowPreparation(bindRuntimeResourceTools(options.mcp, options.bootstrap.session.resource_bindings), options.mcp.originalName).map((tool) => {
    const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties
    if (options.mcp.originalName(tool.name) !== 'termous.desktop_workflows.templates.preview' || !properties?.compact) return tool
    return { ...tool, execute: (id, args, signal, update) => tool.execute(id, { compact: true, ...(args as Record<string, unknown>) }, signal, update) } as typeof tool
  })
  let modelMessages: AgentMessage[] = []
  const hasSkill = (content: string, uri: string, sha256: string) => skillResourcePresent(modelMessages, content, uri, sha256)
  const skillTool = createSkillResourceTool(options.skills, hasSkill, (content, uri) => discovery.loadReferencedTools(content, uri))
  const historyTool = createHistoryImageTool(async (reference, signal) => {
    if (!model.input.includes('image')) throw new Error('AGENT_RUNTIME_MODEL_IMAGE_UNSUPPORTED')
    if (!options.readHistoryImage) throw new Error('AGENT_RUNTIME_IMAGE_UNAVAILABLE')
    await options.events.flush()
    return options.readHistoryImage(reference, signal)
  })
  const discovery = new RuntimeToolDiscovery([...boundTools, ...createWorkflowWaitTool(boundTools, options.mcp.originalName)], options.mcp.originalName, [skillTool, historyTool],
    (name) => inputSafety.blockedTool(name, name === 'termous.desktop_workflows.runs.control' ? { action: 'cancel' } : undefined),
    (name) => { toolProgress.rediscover(name); skillContext.activateTool(name) })
  let tools = discovery.active()
  let toolDeclarations = tools.map(toToolDeclaration)
  const fingerprint = () => runtimeContextFingerprint(model, systemPrompt + imageWorkingSet.key() + supplementalFingerprint, tools.map(({ name, description, parameters }) => ({ name, description, parameters })), options.bootstrap.run.provider_id, options.bootstrap.run.model_id)
  let contextFingerprint = fingerprint()
  const baseStream = createRuntimeStreamFunction(options.bootstrap.model.api_key, providerFetch)
  const secrets = options.bootstrap.model.api_key ? [options.bootstrap.model.api_key] : []
  const diagnostics = options.bootstrap.context.progress_supported ? () => ({ context_fingerprint: contextFingerprint, execution_summary_tokens: estimateRuntimeMessageTokens({ role: 'user', content: toolProgress.summary(), timestamp: 0 }) }) : undefined
  const streamFn = measuredRuntimeStream(baseStream, budget, options.events, options.bootstrap.context.request_usage_supported === true, 'response', secrets, diagnostics)
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
    projectMessages: (messages, commit) => projectContext(messages, commit),
    supplementalMessages: (messages, commit) => supplementContext(messages, commit),
    retainToolCall: pendingPreviewCall,
    captureDetails: () => ({ execution_progress: toolProgress.snapshot() }),
  })
  const projectImages = (messages: AgentMessage[], commit: boolean) => {
    const projected = imageWorkingSet.project(standardMessages(messages), commit)
    if (commit && projected.changed) {
      compaction.invalidateUsage(messages)
      contextFingerprint = fingerprint()
      // 图片变化会使原生用量失效；在后续复制消息前清除，避免对象身份变化绕过失效标记。
      return { ...projected, messages: projected.messages.map(clearRuntimeCompactionUsage) }
    }
    return projected
  }
  const projectContext = (messages: AgentMessage[], commit: boolean) => {
    const projected = projectImages(messages, commit).messages.map((message) => {
      const tokens = requestSupplements.get(message)
      if (message.role !== 'assistant' || !tokens || !message.usage.totalTokens) return message
      // Provider 用量已包含上次注入；扣除该投影后再计入当前投影，避免逐轮重复估算占用。
      const usage = { ...message.usage }
      let remaining = tokens
      for (const key of ['input', 'cacheRead', 'cacheWrite'] as const) {
        const removed = Math.min(usage[key], remaining)
        usage[key] -= removed; usage.totalTokens -= removed; remaining -= removed
      }
      return { ...message, usage }
    })
    if (commit) modelMessages = projected
    return projected
  }
  const supplementContext = (messages: AgentMessage[], commit: boolean): AgentMessage[] => {
    const knowledge = skillContext.content(messages)
    const summary = toolProgress.summary()
    const content = [...knowledge, ...(summary ? [{ type: 'text' as const, text: summary }] : [])]
    const key = progressDigest(content)
    if (commit && supplementalFingerprint !== key) {
      supplementalFingerprint = key
      contextFingerprint = fingerprint()
    }
    if (commit) supplementalTokens = content.length ? estimateRuntimeMessageTokens({ role: 'user', content, timestamp: 0 }) : 0
    return content.length ? [{ role: 'user', content, timestamp: 0 }] : []
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
    const prerequisite = isError ? progressData(result) : undefined
    // 本地门禁明确尚未派发时，仅补齐其只读核验入口，不代替模型执行或恢复历史授权。
    if (prerequisite) discovery.loadNames(runtimePrerequisiteTools(result, prerequisite))
    inputSafety.observe(options.mcp.originalName(name) ?? name, result, isError)
    budget.evaluate({ type: 'tool_result', name: options.mcp.originalName(name) ?? name, args, result, isError })
    const guidance = toolProgress.observe(options.mcp.originalName(name) ?? name, args, result, isError)
    for (const progress of toolProgress.drain()) {
      if (progress.status === 'detected') discovery.loadNames(progress.next_tools)
      if (options.bootstrap.context.progress_supported) options.events.push('progress', { progress: {
        ...progress, assistant_message_id: options.bootstrap.run.assistant_message_id, after_part_sequence: bridge.partSequence(),
      } })
    }
    return guidance
  }
  const initialMessages = hydrateRuntimeMessages(options.bootstrap, model, contextFingerprint)
  const restoredProgress = toolProgress.restore(options.bootstrap.context.checkpoint?.details?.execution_progress)
  // 旧检查点没有执行状态时，从其保留历史重建；只有已恢复的快照才跳过该段，避免重复计数。
  toolProgress.replay(initialMessages.slice(options.bootstrap.context.checkpoint ? 1 + (restoredProgress ? options.bootstrap.context.checkpoint.retained_tail?.length ?? 0 : 0) : 0),
    (name) => options.mcp.readOnly?.(name) ?? /\.(?:get|list|capture|view|match)$/u.test(name))
  const steerSources = new WeakMap<AgentMessage, Pick<RuntimeSteerResult, 'message_id' | 'part_id'>>()
  const agent = new Agent({
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: options.bootstrap.run.reasoning_level,
      tools,
      messages: initialMessages,
    },
    // 系统提示和工具只来自本轮可信配置；压缩与 Core 快照仍只处理业务历史。
    convertToLlm: (messages) => normalizeContext({
      systemPrompt, tools: toolDeclarations, messages: standardMessages(messages),
    }).messages,
    transformContext: (messages, signal) => compaction.transformContext(standardMessages(messages), signal),
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
      requestSupplementalTokens = supplementalTokens
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
        return { isError: true, ...(guidance ? { content: [...result.content, { type: 'text' as const, text: guidance }] } : {}) }
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
          requestSupplements.set(value.message, requestSupplementalTokens)
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
