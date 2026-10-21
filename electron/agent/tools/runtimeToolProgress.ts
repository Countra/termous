import type { AgentMessage, AgentToolResult } from '@earendil-works/pi-agent-core'
import { isDeepStrictEqual } from 'node:util'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { decodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { completedToolGuidance, completedToolResource, runtimeToolDependencies } from './runtimeToolLifecycle.ts'
import { capabilityTools, capabilityValue, recoveryNavigation, runtimeCapability, runtimeCapabilityStep } from './runtimeCapabilityCatalog.ts'
import { progressArguments, progressData, progressDigest, progressFailure, progressFingerprint, progressMetaTools, progressPolling, progressResource } from './runtimeToolEvidence.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'
import { runtimeToolNavigation, type ToolNavigation } from './runtimeToolNavigation.ts'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'
import { RuntimeExecutionState, type ProgressNotice, type ExecutionRecovery as Recovery } from './runtimeExecutionState.ts'
import { desktopControlUnconfirmed } from './runtimeDesktopObservation.ts'
import { isRecord } from '../contracts/validation.ts'

interface Observation { fingerprint: string; count: number; name: string; resource: string; epoch: number }
// 进展提示与可关闭预算独立；只有已完成资源的生命周期约束会阻止再次派发。
export class RuntimeToolProgress {
  private readonly observations = new Map<string, Observation>()
  private readonly completed = new Map<string, true>()
  private readonly cleanupSuspended = new Set<string>()
  private readonly state: RuntimeExecutionState
  private readonly recoveries = new Map<string, Recovery>()
  // 只跟踪本轮本地校验建议的查询；不持久化为授权或下轮必须执行的动作。
  private readonly prerequisites = new Map<string, { tool: string; resource: string; query: NonNullable<ToolNavigation['prerequisite']> }>()
  private readonly notices = new Map<string, ProgressNotice>()
  private readonly noticeResources = new Map<string, string>()
  private recent: string[] = []
  private pending: ProgressNotice[] = []
  private epoch = 0
  private previousFailure?: { name: string; resource: string }
  private readonly polling = new Map<string, { fingerprint: string; since: number }>()
  private readonly now: () => number
  private readonly available: (name: string) => boolean
  private readonly bindings: RuntimeResourceBinding[]

  constructor(now: () => number = Date.now, available: (name: string) => boolean = () => true,
    bindings: RuntimeResourceBinding[] = []) { this.now = now; this.available = available; this.bindings = bindings; this.state = new RuntimeExecutionState(now, available) }

  hidden(name: string) { return this.cleanupSuspended.has(name) }

  beforeCall(name: string, args: unknown) {
    const resource = completedToolResource(name, args)
    if (resource && this.completed.has(`${name}:${progressDigest(resource)}`)) {
      this.cleanupSuspended.add(name)
      return completedToolGuidance(name)
    }
    return undefined
  }

  rediscover(name: string) { this.cleanupSuspended.delete(name) }

  // 新用户指令开启新的诊断窗口；已确认的资源终态不会恢复为有效授权。
  reset() { this.observations.clear(); this.recent = []; this.notices.clear(); this.noticeResources.clear(); this.recoveries.clear(); this.prerequisites.clear(); this.cleanupSuspended.clear(); this.polling.clear(); this.pending = []; this.previousFailure = undefined }

  drain() { const pending = this.pending; this.pending = []; return pending }

  observe(name: string, args: unknown, result: AgentToolResult<unknown>, isError: boolean,
    navigation = runtimeToolNavigation(name, result, this.bindings, isError)): string | undefined {
    const mcp = isMCPToolDetails(result.details) ? result.details : undefined
    const data = progressData(result)
    const failure = progressFailure(data, name)
    const error = isError || mcp?.result.isError === true || failure !== undefined
    const code = failure?.code ?? (error && typeof data.code === 'string' ? data.code.slice(0, 128) : undefined)
    const resource = progressResource(args, data)
    const previousFailure = this.previousFailure
    this.previousFailure = error ? { name, resource } : undefined
    const unresolved = error || ['pending', 'waiting'].includes(runtimeToolOutcome(name, data)) || desktopControlUnconfirmed(name, data, this.now())
    this.observeRecovery(name, resource, navigation, unresolved)
    const terminal = !error && mcp && completedToolResource(name, args, data)
    if (!error) for (const dependency of runtimeToolDependencies(name)) this.cleanupSuspended.delete(dependency)
    if (terminal) {
      const key = `${name}:${progressDigest(terminal)}`
      if (this.completed.has(key)) return completedToolGuidance(name)
      remember(this.completed, key, true)
      this.cleanupSuspended.delete(name)
    }
    const grantChanged = !progressMetaTools.has(name) && this.state.observe(name, resource, data, args, error, code) === true
    const readOnly = progressMetaTools.has(name) || mcp?.readOnly === true
    const role = runtimeCapabilityStep(name)?.role
    // 连续输入可以是合法任务；协议接收本身不能消除尚未解决的观察诊断。
    let polling = progressPolling(name, args, data)
    if (polling && runtimeToolOutcome(name, data) === 'pending') {
      const key = `${name}:${resource}`
      const fingerprint = progressFingerprint(name, data, result)
      const previous = this.polling.get(key)
      const since = previous?.fingerprint === fingerprint ? previous.since : this.now()
      if (previous && previous.fingerprint !== fingerprint) this.advance(resource, name)
      remember(this.polling, key, { fingerprint, since })
      // 合法长轮询有宽限期；状态、进度均不变时恢复诊断，wait_ms 不能造成永久豁免。
      polling = this.now() - since < 60_000
    }
    if (!error) {
      if (mcp) this.confirmPrerequisite(name, args)
      this.confirmRecovery(name, resource, data, false, this.now(), grantChanged)
      if (!unresolved && !polling && [...this.notices.values()].some((notice) => notice.status === 'detected' && notice.reason === 'repeated_failure'
        && notice.tool_name === name && this.noticeResources.get(notice.pattern_id) === resource)) {
        this.advance(resource, name, '同一操作已取得该资源的成功回执；继续核验目标是否完成。', true)
      }
    }
    if (!error && (polling || !readOnly && (!role || role === 'input'))) {
      this.recent = [...this.recent, ''].slice(-12)
      return undefined
    }
    const key = `${name}:${resource}:${error ? `error:${code ?? 'tool_failed'}` : progressDigest(progressArguments(args))}`
    const fingerprint = error ? progressDigest(code ?? 'tool_failed')
      : role === 'submit' || role === 'cancel' ? progressDigest({ role }) : progressFingerprint(name, data, result)
    const previous = this.observations.get(key)
    if (previous && previous.fingerprint !== fingerprint && !progressMetaTools.has(name)) this.advance(resource, name)
    const count = previous?.fingerprint === fingerprint ? previous.count + 1 : 1
    const epoch = previous?.fingerprint === fingerprint ? previous.epoch : ++this.epoch
    remember(this.observations, key, { fingerprint, count, name, resource, epoch })
    const token = progressDigest([key, fingerprint, epoch])
    this.recent = [...this.recent, token].slice(-12)
    let reason: ProgressNotice['reason'] = error ? 'repeated_failure' : 'repeated_observation'
    let pattern = token
    let repetitions = count
    for (let length = 2; length <= 4; length++) {
      if (this.recent.length < length * 3) continue
      const tail = this.recent.slice(-length)
      if (tail.includes('') || new Set(tail).size < 2) continue
      if ([2, 3].every((n) => tail.every((item, index) => item === this.recent[this.recent.length - length * n + index]))) {
        pattern = progressDigest(tail.slice().sort())
        repetitions = (this.notices.get(pattern)?.count ?? 2) + 1
        reason = 'cycle'
        break
      }
    }
    if (repetitions < 3) return undefined
    // 只合并紧随同一附着申请失败的前置查询；持续单独查询仍按原节奏提示。
    const prerequisite = this.state.prerequisiteRecovery(name, data)
    if (!error && prerequisite && previousFailure?.name === prerequisite.tool && previousFailure.resource === prerequisite.resource
      && this.recoveries.has(`${prerequisite.tool}:${prerequisite.resource}`)) return undefined
    const recovery = navigation ?? recoveryNavigation(name, code)
    const nextTools = recovery.names.filter(this.available).slice(0, 8)
    const unavailable = recovery.names.some((name) => !this.available(name)) ? '部分流程入口不在当前可用目录中；先说明缺失能力或门禁限制，不得反复发现或绕过。' : ''
    const guidance = `${reason === 'repeated_failure' ? '同类操作反复失败' : reason === 'cycle' ? '工具调用正在重复往返' : role === 'submit' ? '重复取得相同前置状态或提交回执' : '同一观察反复返回相同有效信息'}（${repetitions} 次，工具 ${name}${code ? `，错误 ${code}` : ''}）。${recovery.guidance} ${recovery.skill ? `流程说明：${recovery.skill}。` : ''}${unavailable}任务继续；让下一次实际工具及参数对应纠正后的动作，缺少准确声明时 discover_tools。口头改计划、更换请求标识或重复发现不等于进展；有新依据可重试。`
    const notice: ProgressNotice = { pattern_id: pattern, tool_name: name, reason, status: 'detected', count: repetitions, guidance, next_tools: nextTools }
    const old = this.notices.get(pattern)
    remember(this.notices, pattern, notice, 12)
    remember(this.noticeResources, pattern, resource, 12)
    // 同一模式按 3、6、12…退避发布；每次请求仍能看到更新后的有界状态摘要。
    if (!old || Number.isInteger(Math.log2(repetitions / 3))) {
      this.pending.push(notice)
      return guidance
    }
    return undefined
  }

  private advance(resource: string, name: string, guidance = '同一工具已观察到该资源的有效结果变化；继续核验目标是否完成。', failuresOnly = false) {
    for (const [key, observation] of this.observations) if (observation.resource === resource && observation.name === name
      && (!failuresOnly || key.startsWith(`${name}:${resource}:error:`))) this.observations.delete(key)
    for (const [id, notice] of this.notices) {
      if (notice.status !== 'detected' || this.noticeResources.get(id) !== resource || notice.tool_name !== name
        || failuresOnly && notice.reason !== 'repeated_failure') continue
      const progressed = { ...notice, status: 'progressed' as const, guidance }
      this.notices.set(id, progressed)
      this.pending.push(progressed)
    }
  }

  private confirmRecovery(name: string, resource: string, data: Record<string, unknown>, historical = false, timestamp = this.now(), grantChanged = false) {
    const resolve = (tool: string, scope: string, guidance: string) => {
      this.state.resolveRecovery(tool, scope)
      if (historical) return
      this.recoveries.delete(`${tool}:${scope}`)
      this.prerequisites.delete(`${tool}:${scope}`)
      this.advance(scope, tool, guidance)
    }
    for (const previous of this.state.confirmedRecoveries(name, data, timestamp, grantChanged)) {
      resolve(previous.tool, previous.resource, name === 'termous.desktops.get' && previous.tool === name
        ? '已查询确认同一附着恢复就绪；继续核验目标是否完成。'
        : '已确认同一附着持有有效授权；若目标需要操作应用，可选择实际输入工具。')
    }
    const capability = runtimeCapability(name)
    const progresses = runtimeCapabilityStep(name)?.progresses
    const evidence = progresses && capabilityValue(data, progresses.path)
    if (capability && progresses && typeof evidence === 'string' && evidence.length > 0) {
      for (const previous of capabilityTools(capability, progresses.tools)) {
        const scope = progresses.collection ? 'unresolved' : resource
        // 成员回执只能消除无筛选空列表，不能清除其他目标或权限失败。
        if (progresses.collection && !this.recoveries.get(`${previous}:${scope}`)?.empty && !this.state.historicalEmpty(previous, scope)) continue
        resolve(previous, scope, `已取得后续阶段 ${name} 的实际回执；继续按目标核验结果。`)
      }
    }
  }

  private diagnosticNotices(): [string, ProgressNotice][] {
    return [...this.notices].map(([id, notice]) => [this.noticeResources.get(id) ?? 'unresolved', notice])
  }

  summary() { return this.state.summary(this.diagnosticNotices(), [...this.recoveries.values()]) }
  snapshot() { return this.state.snapshot(this.diagnosticNotices(), [...this.recoveries.values()]) }
  restore(value: unknown) { return this.state.restore(value) }

  private confirmPrerequisite(name: string, args: unknown) {
    if (!isRecord(args)) return
    for (const [key, pending] of this.prerequisites) {
      if (name !== pending.query.tool || !Object.entries(pending.query.arguments)
        .every(([field, value]) => isDeepStrictEqual(args[field], value))) continue
      this.prerequisites.delete(key)
      this.recoveries.delete(key)
      this.state.resolveRecovery(pending.tool, pending.resource)
      this.advance(pending.resource, pending.tool, '已实际执行本地校验建议的查询；按新回执处理后续条件，此查询不代表已取得控制权。')
    }
  }

  private observeRecovery(name: string, resource: string, navigation: ToolNavigation | undefined, unresolved: boolean) {
    const key = `${name}:${resource}`
    if (navigation?.prerequisite) remember(this.prerequisites, key, { tool: name, resource, query: navigation.prerequisite }, 12)
    else this.prerequisites.delete(key)
    if (navigation?.recovery) remember(this.recoveries, `${name}:${resource}`, { tool: name, resource,
      guidance: navigation.guidance.slice(0, 1600), next_tools: navigation.names.filter(this.available).slice(0, 8), empty: navigation.empty }, 12)
    else if (!unresolved && !progressMetaTools.has(name)) this.recoveries.delete(`${name}:${resource}`)
  }

  replay(messages: AgentMessage[], readOnly: (name: string) => boolean) {
    const args = new Map<string, unknown>()
    for (const message of messages) {
      if (message.role === 'assistant') for (const part of message.content) if (part.type === 'toolCall') args.set(part.id, part.arguments)
      if (message.role !== 'toolResult') continue
      const name = decodeMCPToolName(message.toolName) ?? message.toolName
      const result = { content: message.content, details: undefined }
      const data = progressData(result)
      const parameters = args.get(message.toolCallId)
      const resource = progressResource(parameters, data)
      const code = progressFailure(data, name)?.code
      const failed = message.isError || code !== undefined
      const grantChanged = !progressMetaTools.has(name) && this.state.observe(name, resource, data, parameters, failed, code, 'historical', message.timestamp) === true
      const navigation = runtimeToolNavigation(name, { ...result, details: { kind: 'mcp', originalToolName: name,
        readOnly: readOnly(name), result: { content: message.content, structuredContent: data, isError: failed } } }, this.bindings, failed)
      if (navigation?.recovery) this.state.historicalRecovery({ tool: name, resource, guidance: navigation.guidance,
        next_tools: navigation.names.filter(this.available), empty: navigation.empty })
      if (!failed) this.confirmRecovery(name, resource, data, true, message.timestamp, grantChanged)
      args.delete(message.toolCallId)
    }
    this.completed.clear(); this.cleanupSuspended.clear(); this.prerequisites.clear(); this.pending = []; this.previousFailure = undefined
  }
}

function remember<T>(map: Map<string, T>, key: string, value: T, limit = 128) {
  map.delete(key); map.set(key, value)
  if (map.size > limit) map.delete(map.keys().next().value!)
}
