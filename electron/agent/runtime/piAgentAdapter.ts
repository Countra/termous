import { createRuntimeSystemPrompt } from './runtimeSystemPrompt.ts'
import { hydrateRuntimeMessages, standardMessages } from '../context/runtimeMessages.ts'
import { createHistoryImageTool } from '../tools/historyImageTool.ts'
import { createProviderModel, createRestrictedProviderFetch, createRuntimeStreamFunction, type RuntimeModel } from '../provider/runtimeProviderAdapter.ts'
import {
  Agent,
  type AgentTool,
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
import { runtimeToolNavigation } from '../tools/runtimeToolNavigation.ts'
import { RuntimeExecutionBudget } from '../execution/runtimeExecutionBudget.ts'
import { RuntimeInputSafety } from '../execution/runtimeInputSafety.ts'
import { measuredRuntimeStream } from './runtimeRequestMetrics.ts'
import { RuntimeImageWorkingSet, pendingPreviewCall } from '../context/runtimeImageWorkingSet.ts'
import { bindWorkflowPreparation, createWorkflowWaitTool } from '../tools/runtimeWorkflowWait.ts'
import { createAnalysisWaitTool } from '../tools/runtimeAnalysisWait.ts'
import { RuntimeToolProgress } from '../tools/runtimeToolProgress.ts'
import { RuntimeSkillContext, skillResourcePresent } from '../tools/runtimeSkillContext.ts'
import { progressData, progressDigest } from '../tools/runtimeToolEvidence.ts'
import { runtimeToolOutcome } from '../tools/runtimeToolOutcome.ts'
import { estimateRuntimeMessageTokens } from '../context/runtimeContextTokens.ts'
import { clearRuntimeCompactionUsage } from '../context/compaction/runtimeCompactionPolicy.ts'
import type { RuntimeContextImageReference } from '../contracts/runtimeCheckpoint.ts'
import type { RuntimeBootstrap } from '../contracts/runtimeBootstrap.ts'
import type { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { RuntimeContextImages } from '../context/runtimeContextImages.ts'
import { ownRuntimeImageMessages } from '../context/runtimeImageLifetime.ts'
import type { ImageResourceReference } from '#common/contracts'
import { runtimeResourceStream } from '../provider/runtimeResourceStream.ts'
import { runtimeBootstrapConfiguration } from '../contracts/runtimeBootstrap.ts'
import { createRuntimeContextGate, runtimeContextFailureMessage } from './runtimeContextGate.ts'
import { createRuntimeRetryStreamFunction } from '../provider/runtimeProviderRetry.ts'
import { bindRuntimeResourceTools } from '../tools/runtimeResourceRouting.ts'
import { prepareBuiltinTools } from '../tools/preparation/index.ts'
import { builtinName, identifyTool, isolateToolNames, localToolSource, termousToolSource, trustedTool } from '../contracts/toolSources.ts'
import { RuntimeSkillDirectory, type SkillSourceSnapshot, type LazySkillSource } from '../tools/runtimeSkillDirectory.ts'
import type { PreparedCall } from '../contracts/toolPreparation.ts'
import type { RuntimeCheckpointInput, RuntimeCheckpointResult } from '../contracts/runtimeCheckpoint.ts'
import type { RuntimeSteerResult } from '../contracts/runtimeEvents.ts'
import { runtimeContextFingerprint, runtimeProviderUsage } from '../provider/runtimeProviderUsage.ts'
import { restoreDesktopObservation } from '../context/desktop/history.ts'
import type { ReadDesktopTasks } from '../contracts/desktopTasks.ts'
import { DesktopTaskCoordinator } from './desktopTasks/coordinator.ts'
import { desktopTaskMessage, desktopTaskToolResult } from '../contracts/desktopTaskResult.ts'
import { desktopWaitTool } from './desktopTasks/waitTool.ts'
import { runtimeClientIdentity } from '../provider/runtimeClientIdentity.ts'
import { RuntimeWait } from './runtimeWait.ts'

export interface PiAgentController {
  continue(): Promise<PiRunOutcome>
  abort(): void
  waitForIdle(): Promise<void>
  steer(message: string, source: Pick<RuntimeSteerResult, 'message_id' | 'part_id'>): void
  hasQueuedMessages(): boolean
  close(): void
}

export interface CreatePiAgentOptions {
  readDesktopTasks?: ReadDesktopTasks
  lookupPreparedCall?(toolCallID: string, step: string, signal?: AbortSignal): Promise<PreparedCall | undefined>
  reserveImageBytes?(bytes: number, signal?: AbortSignal): Promise<() => void>
  audit?: { capture(event: AgentEvent): void }
  bootstrap: RuntimeBootstrap
  mcp: AgentMCPConnection
  events: RuntimeEventWriter
  skills: AgentSkillBundleSnapshot
  skillSources?: SkillSourceSnapshot[]
  lazySkills?: LazySkillSource[]
  fetch?: typeof globalThis.fetch
  now?: () => number
  newPartID?: () => string
  readHistoryImage?(reference: RuntimeContextImageReference, signal?: AbortSignal): Promise<import('../contracts/runtimeResourceImages.ts').RuntimeHistoryImage>
  readResourceImage?(reference: ImageResourceReference, signal?: AbortSignal): Promise<string>
  commitCheckpoint(input: RuntimeCheckpointInput, signal?: AbortSignal): Promise<RuntimeCheckpointResult>
  onFailure?: (error: unknown) => void
}

export function createRuntimeModel(bootstrap: RuntimeBootstrap): RuntimeModel {
  return createProviderModel(bootstrap.model.snapshot)
}

export function createPiAgent(options: CreatePiAgentOptions): PiAgentController {
  options = { ...options, mcp: isolateToolNames(options.mcp) }
  const restoredCheckpoint = options.bootstrap.context.checkpoint
  if (restoredCheckpoint?.retained_tail) options = { ...options, bootstrap: { ...options.bootstrap,
    context: { ...options.bootstrap.context, checkpoint: { ...restoredCheckpoint,
      retained_tail: ownRuntimeImageMessages(restoredCheckpoint.retained_tail) } } } }
  const model = createRuntimeModel(options.bootstrap)
  const providerFetch = createRestrictedProviderFetch(
    model.baseUrl,
    options.bootstrap.model.api_key === undefined,
    options.fetch,
  )
  const images = new RuntimeContextImages(options.bootstrap)
  const budget = new RuntimeExecutionBudget(options.bootstrap.model.snapshot.execution_budget)
  const inputSafety = new RuntimeInputSafety()
  const runtimeWait = new RuntimeWait()
  const toolProgress = new RuntimeToolProgress(options.now, (name) => discovery.available(name), options.bootstrap.session.resource_bindings)
  const skillContext = new RuntimeSkillContext(options.skills)
  const skillDirectory = new RuntimeSkillDirectory([{ source: termousToolSource, snapshot: options.skills }, ...options.skillSources ?? []], options.lazySkills)
  skillDirectory.restore(options.bootstrap.context.checkpoint?.details?.external_skills)
  let supplementalFingerprint = progressDigest([])
  let supplementalTokens = 0
  let requestSupplementalTokens = 0
  let requestDesktopReceipts: Array<{ execution_id: string; revision: number }> = []
  const requestSupplements = new WeakMap<AgentMessage, number>()
  let aborted = false
  const executionFailure = () => aborted ? undefined : inputSafety.failure() ?? budget.failure()
  const imageWorkingSet = new RuntimeImageWorkingSet(images)
  const desktopContext = restoreDesktopObservation(options.bootstrap)
  let observeBatch: ((output: Record<string, unknown>) => void) | undefined
  const desktopTasks = options.readDesktopTasks ? new DesktopTaskCoordinator(options.readDesktopTasks, receipt => {
    inputSafety.observe('termous.desktops.executions.get', desktopTaskToolResult(receipt), receipt.result.run.state !== 'completed')
    runtimeWait.wake('task_update')
  }, error => { options.onFailure?.(error); agent.abort() }) : undefined
  const resourceTools = bindRuntimeResourceTools(options.mcp, options.bootstrap.session.resource_bindings)
  const managedTools = options.lookupPreparedCall ? prepareBuiltinTools({ ...options.mcp, tools: resourceTools }, {
    runID: options.bootstrap.run.id, generation: options.bootstrap.run.generation, bindings: options.bootstrap.session.resource_bindings,
    desktop: desktopContext,
    registerBatchObserver: observe => { observeBatch = observe },
    lookup: options.lookupPreparedCall,
    progress: (tool_call_id, _tool_name, phase) => bridge.toolProgress(tool_call_id, phase),
    blocked: (name, args) => inputSafety.blockedTool(name, args) ?? desktopTasks?.blocked(name, args, desktopContext.current()),
    persist: async (call) => {
      options.events.push('tool_prepared', { tool: { tool_call_id: call.tool_call_id, tool_name: call.tool_name, preparation: call } })
      await options.events.flush()
    },
  }) : resourceTools
  const originalBuiltin = (name: string) => builtinName(options.mcp, name)
  const boundTools = bindWorkflowPreparation(managedTools, originalBuiltin).map((tool) => {
    const properties = (tool.parameters as { properties?: Record<string, unknown> }).properties
    if (options.mcp.originalName(tool.name) !== 'termous.desktop_workflows.templates.preview' || !properties?.compact) return tool
    return { ...tool, execute: (id, args, signal, update) => tool.execute(id, { compact: true, ...(args as Record<string, unknown>) }, signal, update) } as typeof tool
  })
  let modelMessages: AgentMessage[] = []
  const hasSkill = (content: string, uri: string, sha256: string) => skillResourcePresent(modelMessages, content, uri, sha256)
  const skillTool = identifyTool(createSkillResourceTool(skillDirectory, hasSkill, (content, uri) => discovery.loadReferencedTools(content, uri)), localToolSource)
  const historyTool = createHistoryImageTool(async (reference, signal) => {
    if (!model.input.includes('image')) throw new Error('AGENT_RUNTIME_MODEL_IMAGE_UNSUPPORTED')
    if (!options.readHistoryImage) throw new Error('AGENT_RUNTIME_IMAGE_UNAVAILABLE')
    await options.events.flush()
    return options.readHistoryImage(reference, signal)
  })
  const waits = [...createWorkflowWaitTool(boundTools, originalBuiltin), ...createAnalysisWaitTool(boundTools, originalBuiltin), ...(desktopTasks ? [desktopWaitTool(desktopTasks, output => observeBatch?.(output))] : [])].map((tool) => identifyTool(tool, localToolSource))
  const waitTool = runtimeWait.tool(() => agent.hasQueuedMessages() ? 'steer' : desktopTasks?.ready().length ? 'task_update' : undefined,
    id => bridge.toolProgress(id, 'waiting'))
  const permanent=[skillTool,identifyTool(historyTool,localToolSource),identifyTool(waitTool,localToolSource)]
  const createDiscovery=(entries:AgentTool[])=>new RuntimeToolDiscovery(entries, options.mcp.originalName, permanent,
    (name) => inputSafety.blockedTool(name, name === 'termous.desktop_workflows.runs.control' ? { action: 'cancel' } : undefined),
    (name) => { toolProgress.rediscover(name); skillContext.activateTool(name) }, skillDirectory, options.mcp.loadTool)
  let discovery = createDiscovery([...boundTools,...waits])
  let tools = options.lookupPreparedCall ? discovery.preload(options.bootstrap.session.resource_bindings ?? [], desktopContext.selected()) : discovery.active()
  let systemPrompt = createRuntimeSystemPrompt(options.bootstrap, options.skills, Boolean(options.lookupPreparedCall), discovery.index())
  let toolDeclarations = tools.map(toToolDeclaration)
  const executionSummary = () => toolProgress.summary(name => discovery.declaration(name, tools))
  const fingerprint = () => runtimeContextFingerprint(model, systemPrompt + imageWorkingSet.key() + supplementalFingerprint, tools.map(({ name, description, parameters }) => ({ name, description, parameters })), options.bootstrap.run.provider_id, options.bootstrap.run.model_id)
  let contextFingerprint = fingerprint()
  const baseStream = runtimeResourceStream(createRuntimeStreamFunction(options.bootstrap.model.api_key, providerFetch), options.readResourceImage, options.reserveImageBytes)
  const secrets = options.bootstrap.model.api_key ? [options.bootstrap.model.api_key] : []
  const diagnostics = options.bootstrap.context.progress_supported ? () => ({ context_fingerprint: contextFingerprint, execution_summary_tokens: estimateRuntimeMessageTokens({ role: 'user', content: executionSummary(), timestamp: 0 }), ...(requestDesktopReceipts.length ? { desktop_task_receipts: requestDesktopReceipts } : {}) }) : undefined
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
    retainMessage: message => desktopTasks?.retainMessage(message) ?? false,
    captureDetails: () => ({ execution_progress: toolProgress.snapshot(), desktop_context: desktopContext.snapshot(), external_skills: skillDirectory.snapshot() }),
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
    const summary = executionSummary()
    const desktopSummary = options.lookupPreparedCall ? desktopContext.summary(!discovery.available('termous.desktops.capture') ? 'unavailable'
      : tools.some(tool => options.mcp.originalName(tool.name) === 'termous.desktops.capture') ? 'available' : 'deferred') : ''
    const content = [...knowledge, ...[summary, desktopSummary, skillDirectory.recoveryHint()].filter(Boolean).map(text => ({ type: 'text' as const, text }))]
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
  const validatedCalls = new Set<string>()
  const callArguments = new Map<string, unknown>()
  const observeToolResult = (id: string, name: string, args: unknown, result: AgentToolResult<unknown>, isError: boolean) => {
    if (observedCalls.has(id)) return
    observedCalls.add(id)
    discovery.complete(name)
    const original = options.mcp.originalName(name) ?? name
    for (const replaced of desktopContext.takeReplacedAttachments()) toolProgress.resolveDesktopObservation(replaced)
    const entry = discovery.registry.entries.find((candidate) => candidate.tool.name === name)
    if (entry && !trustedTool(entry.tool)) {
      budget.evaluate({ type: 'tool_result', name: original, args, result, isError })
      return undefined
    }
    if (isMCPToolDetails(result.details) && !['failed', 'waiting'].includes(runtimeToolOutcome(original, progressData(result), isError || result.details.result.isError === true))) discovery.used(original)
    inputSafety.observe(original, result, isError)
    desktopTasks?.observe(original, result)
    budget.evaluate({ type: 'tool_result', name: original, args, result, isError })
    // pi 在参数准备失败时跳过 before/afterToolCall；用实际阶段区分本地失败，不解析错误文案。
    const preparationCode = isError && !validatedCalls.has(id) && !isMCPToolDetails(result.details)
      ? tools.some((tool) => tool.name === name) ? 'AGENT_TOOL_ARGUMENTS_INVALID' : 'AGENT_TOOL_UNAVAILABLE' : undefined
    const suggested = runtimeToolNavigation(original, result, options.bootstrap.session.resource_bindings, isError, preparationCode, args)
    const navigation = suggested ? discovery.resolveNavigation(suggested) : undefined
    const guidance = toolProgress.observe(original, args, result, isError, navigation)
    const navigationText = navigation ? discovery.navigate(navigation, Boolean(options.lookupPreparedCall && !isError && !navigation.recovery && runtimeToolOutcome(original, progressData(result), false) === 'settled')) : undefined
    for (const progress of toolProgress.drain()) {
      if (progress.status === 'detected') discovery.loadNames(progress.next_tools)
      if (options.bootstrap.context.progress_supported) options.events.push('progress', { progress: {
        ...progress, assistant_message_id: options.bootstrap.run.assistant_message_id, after_part_sequence: bridge.partSequence(),
      } })
    }
    return [navigationText, guidance].filter(Boolean).join('\n') || undefined
  }
  const initialMessages = hydrateRuntimeMessages(options.bootstrap, model, contextFingerprint)
  const restoredProgress = toolProgress.restore(options.bootstrap.context.checkpoint?.details?.execution_progress)
  // 旧检查点没有执行状态时，从其保留历史重建；只有已恢复的快照才跳过该段，避免重复计数。
  toolProgress.replay(initialMessages.slice(options.bootstrap.context.checkpoint ? 1 + (restoredProgress ? options.bootstrap.context.checkpoint.retained_tail?.length ?? 0 : 0) : 0),
    (name) => options.mcp.readOnly?.(name) ?? /\.(?:get|list|capture|view|match)$/u.test(name))
  // 启动历史已在 Core 落盘；移交给运行工作集后不再让配置闭包保留整份图片正文。
  imageWorkingSet.releasePersisted(initialMessages)
  options = { ...options, bootstrap: runtimeBootstrapConfiguration(options.bootstrap) }
  const steerSources = new WeakMap<AgentMessage, Pick<RuntimeSteerResult, 'message_id' | 'part_id'>>()
  let segmentTurns = 0
  let rotateSegment = false
  let checkpointBoundary = compaction.checkpoint()?.timestamp
  const desktopObservations: AgentMessage[] = []
  let pendingLocalReminder: string | undefined
  const prepareTools = async (messages: AgentMessage[], signal?:AbortSignal) => {
    const change=await options.mcp.refreshTools?.(signal)
    if (change) {
      const removed=new Set([...change.removed,...permanent.map(tool=>tool.name)])
      const activeNames=discovery.retainedNames()
      const retained=discovery.catalogTools().filter(tool=>!removed.has(tool.name))
      discovery=createDiscovery([...retained,...change.tools])
      await discovery.restoreNames(activeNames,signal)
    }
    const next = discovery.publish().filter((tool) => !toolProgress.hidden(options.mcp.originalName(tool.name) ?? tool.name))
    const nextPrompt = createRuntimeSystemPrompt(options.bootstrap, options.skills, Boolean(options.lookupPreparedCall), discovery.index(next))
    if (nextPrompt !== systemPrompt || next.length !== tools.length || next.some((tool,index) => tool !== tools[index])) {
      tools = next
      systemPrompt = nextPrompt
      toolDeclarations = tools.map(toToolDeclaration)
      contextFingerprint = fingerprint()
      compaction.updateTools(tools, messages, systemPrompt)
    }
  }
  const agent = new Agent({
    identity: runtimeClientIdentity,
    initialState: {
      systemPrompt,
      model,
      thinkingLevel: options.bootstrap.run.reasoning_level,
      tools,
      messages: initialMessages,
    },
    // 系统提示和工具只来自本轮可信配置；压缩与 Core 快照仍只处理业务历史。
    convertToLlm: (messages) => normalizeContext({ systemPrompt, tools: toolDeclarations, messages: standardMessages(messages) }).messages,
    transformContext: (messages, signal) => compaction.transformContext(standardMessages(messages), signal),
    prepareRequest: async ({ context },signal) => {
      await prepareTools(context.messages,signal)
      return { context: { ...context, tools,systemPrompt } }
    },
    prepareNextTurnWithContext: () => ({ messages: desktopObservations.splice(0) }),
    finishTurn: async ({ toolResults, context }, signal) => {
      if (signal?.aborted) { aborted = true; return { action: 'end' } }
      for (const result of toolResults) {
        observeToolResult(result.toolCallId, result.toolName, callArguments.get(result.toolCallId), { content: result.content, details: result.details }, result.isError)
        observedCalls.delete(result.toolCallId)
        validatedCalls.delete(result.toolCallId)
        callArguments.delete(result.toolCallId)
      }
      if (toolResults.length) {
        pendingLocalReminder = undefined
        await options.events.flush()
        imageWorkingSet.releasePersisted(context.messages)
      }
      const failure = executionFailure()
      if (desktopTasks) {
        await desktopTasks.reconcile()
        while (!toolResults.length && desktopTasks.pending() && !desktopTasks.ready().length && !agent.hasQueuedMessages()) {
          await desktopTasks.waitForChange(signal)
          if (signal?.aborted) return { action: 'end' }
        }
        for (const receipt of desktopTasks.ready()) {
          const partID = bridge.desktopTaskResult(receipt)
          await options.events.flush()
          images.registerTaskResult(partID, receipt)
          observeBatch?.(receipt.result)
          desktopTasks.recorded(receipt)
          desktopObservations.push(desktopTaskMessage(receipt))
        }
        const nextFailure = executionFailure()
        if (nextFailure) { bridge.stopLocally(nextFailure); return { action: 'end' } }
        if (desktopObservations.length) return { action: 'continue' }
      }
      if (failure) { bridge.stopLocally(failure); return { action: 'end' } }
      const pendingLocal = !toolResults.length && !compaction.failure() && bridge.outcome() === 'completed' && options.mcp.pendingWork?.()
      if (pendingLocal) {
        // 模型必须实际查询任务；重复结束回答不能无限触发同一提示和模型请求。
        if (pendingLocalReminder === pendingLocal) {
          bridge.stopLocally({ code: 'AGENT_RUNTIME_LOCAL_COMMAND_PENDING', message: '本地命令尚未确认完成，助手未继续查询原任务。本轮已停止，仍在运行的命令将按生命周期取消；请先查询原任务结果，勿直接重新执行。' })
          return { action: 'end' }
        }
        pendingLocalReminder = pendingLocal
        desktopObservations.push({ role: 'user', content: pendingLocal, timestamp: (options.now ?? Date.now)() })
        return { action: 'continue' }
      }
      if (toolResults.length && !compaction.failure()) {
        segmentTurns += 1
        const boundary = compaction.checkpoint()?.timestamp
        if (segmentTurns >= 10 || boundary !== checkpointBoundary) {
          checkpointBoundary = boundary
          rotateSegment = true
          return { action: 'end' }
        }
      }
      return undefined
    },
    streamFn: (requestModel, context, streamOptions) => {
      requestDesktopReceipts = desktopTasks?.beforeRequest(context.messages) ?? []
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
    beforeToolCall: async ({ toolCall, args }, signal) => {
      validatedCalls.add(toolCall.id)
      // 拦截与结果关联使用实际执行参数；模型原始参数仍留在对话中。
      callArguments.set(toolCall.id, args)
      if (signal?.aborted) { aborted = true; return { block: true, terminate: true, reason: '任务已取消' } }
      const name = options.mcp.originalName(toolCall.name) ?? toolCall.name
      const decision = inputSafety.failure() ? undefined : budget.evaluate({ type: 'before_tool', name, args })
      const failure = inputSafety.failure() ?? (decision && !decision.allowed ? decision.reason : undefined)
      if (failure) return { block: true, terminate: true, reason: failure.message }
      const safetyBlock = inputSafety.blockedTool(name, args)
      if (safetyBlock) return { block: true, reason: safetyBlock }
      const progressBlock = toolProgress.beforeCall(name, args)
      if (progressBlock) return { block: true, reason: progressBlock }
      discovery.touch(toolCall.name)
      if (!model.input.includes('image') && requiresDesktopImages(options.mcp.originalName(toolCall.name))) {
        return { block: true, reason: 'AGENT_RUNTIME_MODEL_IMAGE_UNSUPPORTED：当前模型不支持图片，可管理已有脚本；请切换支持图片的模型后截图、查看或确认图像模板。' }
      }
      return undefined
    },
    afterToolCall: async ({ result, toolCall, args, isError }) => {
      const original = options.mcp.originalName(toolCall.name) ?? toolCall.name
      const failed = isError || isMCPToolDetails(result.details)
        && runtimeToolOutcome(original, progressData(result), result.details.result.isError === true) === 'failed'
      const guidance = observeToolResult(toolCall.id, toolCall.name, args, result, failed)
      if (failed) {
        return { isError: true, ...(guidance ? { content: [...result.content, { type: 'text' as const, text: guidance }] } : {}) }
      }
      if (guidance) return { content: [...result.content, { type: 'text', text: guidance }] }
      return undefined
    },
  })
  const unsubscribe = agent.subscribe((event) =>
    handlePiEvent(event, {
      handle: async (value) => {
        if (value.type === 'agent_end') {
          observedCalls.clear()
          validatedCalls.clear()
          callArguments.clear()
        }
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
        await options.events.waitForCapacity()
      },
    }, options.onFailure, () => { aborted = true; agent.abort() })
  )
  let closed = false

  return {
    continue: async () => {
      do {
        rotateSegment = false
        await agent.continue()
        await agent.waitForIdle()
        if (rotateSegment && !aborted && !executionFailure()) {
          // 保留当前系统与工具基线，切换仅释放 SDK 循环，不产生新的业务 Run。
          agent.state.messages = normalizeContext({ systemPrompt, tools: toolDeclarations,
            messages: standardMessages(compaction.rebase(standardMessages(agent.state.messages))) }).messages
          images.retain(agent.state.messages)
          segmentTurns = 0
        }
      } while (rotateSegment && !aborted && !executionFailure())
      if (executionFailure() && bridge.outcome() !== 'cancelled') bridge.stopLocally(executionFailure()!)
      return aborted ? 'cancelled' : bridge.outcome()
    },
    abort: () => { aborted = true; runtimeWait.close(); desktopTasks?.close(); agent.abort() },
    waitForIdle: () => agent.waitForIdle(),
    steer: (message, source) => {
      toolProgress.reset()
      const user: AgentMessage = { role: 'user', content: message, timestamp: (options.now ?? Date.now)() }
      steerSources.set(user, { message_id: source.message_id, part_id: source.part_id })
      agent.steer(user)
      runtimeWait.wake('steer')
      desktopTasks?.wake()
    },
    hasQueuedMessages: () => agent.hasQueuedMessages(),
    close: () => {
      if (closed) {
        return
      }
      closed = true
      runtimeWait.close()
      desktopTasks?.close()
      unsubscribe()
      agent.clearAllQueues()
      observedCalls.clear()
      validatedCalls.clear()
      callArguments.clear()
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
