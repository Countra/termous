import type { AgentMessage, AgentToolResult } from '@earendil-works/pi-agent-core'
import type { AgentProgressData } from '#common/contracts'
import { isAgentProgressData } from '#common/contracts'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { decodeMCPToolName } from '../contracts/toolNameCodec.ts'
import { isRecord } from '../contracts/validation.ts'
import { completedToolGuidance, completedToolResource, runtimeToolDependencies } from './runtimeToolLifecycle.ts'
import { capabilityTools, capabilityValue, recoveryNavigation, runtimeCapability, runtimeCapabilityStep } from './runtimeCapabilityCatalog.ts'
import { progressArguments, progressData, progressDigest, progressFact, progressFailure, progressFingerprint, progressMetaTools, progressPolling, progressResource } from './runtimeToolEvidence.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'
import { runtimeToolNavigation, type ToolNavigation } from './runtimeToolNavigation.ts'
import type { RuntimeResourceBinding } from '../contracts/resourceBindings.ts'

interface Observation { fingerprint: string; count: number; name: string; resource: string; epoch: number }
type ProgressNotice = Omit<AgentProgressData, 'assistant_message_id' | 'after_part_sequence'>
type Fact = ReturnType<typeof progressFact>
interface Recovery { tool: string; resource: string; guidance: string; next_tools: string[]; empty?: boolean }
interface ProgressSnapshot { version: 1; observations: [string, Observation][]; recent: string[]; facts: Fact[]; notices: [string, ProgressNotice][]; recoveries?: Recovery[] }

// 进展提示与可关闭预算独立；只有已完成资源的生命周期约束会阻止再次派发。
export class RuntimeToolProgress {
  private readonly observations = new Map<string, Observation>()
  private readonly completed = new Map<string, true>()
  private readonly cleanupSuspended = new Set<string>()
  private readonly facts = new Map<string, Fact>()
  private readonly recoveries = new Map<string, Recovery>()
  private readonly notices = new Map<string, ProgressNotice>()
  private readonly noticeResources = new Map<string, string>()
  private recent: string[] = []
  private pending: ProgressNotice[] = []
  private epoch = 0
  private readonly polling = new Map<string, { fingerprint: string; since: number }>()
  private readonly now: () => number
  private readonly available: (name: string) => boolean
  private readonly bindings: RuntimeResourceBinding[]

  constructor(now: () => number = Date.now, available: (name: string) => boolean = () => true,
    bindings: RuntimeResourceBinding[] = []) { this.now = now; this.available = available; this.bindings = bindings }

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
  reset() { this.observations.clear(); this.recent = []; this.notices.clear(); this.noticeResources.clear(); this.recoveries.clear(); this.cleanupSuspended.clear(); this.polling.clear(); this.pending = [] }

  drain() { const pending = this.pending; this.pending = []; return pending }

  observe(name: string, args: unknown, result: AgentToolResult<unknown>, isError: boolean,
    navigation = runtimeToolNavigation(name, result, this.bindings, isError)): string | undefined {
    const mcp = isMCPToolDetails(result.details) ? result.details : undefined
    const data = progressData(result)
    const failure = progressFailure(data, name)
    const error = isError || mcp?.result.isError === true || failure !== undefined
    const code = failure?.code ?? (error && typeof data.code === 'string' ? data.code.slice(0, 128) : undefined)
    const resource = progressResource(args, data)
    this.observeRecovery(name, resource, navigation, error)
    const terminal = !error && mcp && completedToolResource(name, args, data)
    if (!error) for (const dependency of runtimeToolDependencies(name)) this.cleanupSuspended.delete(dependency)
    if (terminal) {
      const key = `${name}:${progressDigest(terminal)}`
      if (this.completed.has(key)) return completedToolGuidance(name)
      remember(this.completed, key, true)
      this.cleanupSuspended.delete(name)
    }
    if (!progressMetaTools.has(name)) remember(this.facts, `${name}:${resource}`, progressFact(name, resource, data, error, code), 12)
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
      if (!polling && [...this.notices.values()].some((notice) => notice.status === 'detected' && notice.reason === 'repeated_failure'
        && notice.tool_name === name && this.noticeResources.get(notice.pattern_id) === resource)) {
        this.advance(resource, name, '同一操作已取得该资源的成功回执；继续核验目标是否完成。', true)
      }
      const capability = runtimeCapability(name)
      const progresses = runtimeCapabilityStep(name)?.progresses
      const evidence = progresses && capabilityValue(data, progresses.path)
      if (capability && progresses && typeof evidence === 'string' && evidence.length > 0) {
        for (const previous of capabilityTools(capability, progresses.tools)) {
          const scope = progresses.collection ? 'unresolved' : resource
          const key = `${previous}:${scope}`
          // 成员回执只能消除无筛选空列表，不能清除其他目标或权限失败。
          if (progresses.collection && !this.recoveries.get(key)?.empty) continue
          this.recoveries.delete(key)
          this.advance(scope, previous, `已取得后续阶段 ${name} 的实际回执；继续按目标核验结果。`)
        }
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
    const recovery = navigation ?? recoveryNavigation(name, code)
    const nextTools = recovery.names.filter(this.available).slice(0, 8)
    const unavailable = recovery.names.some((name) => !this.available(name)) ? '部分流程入口不在当前可用目录中；先说明缺失能力或门禁限制，不得反复发现或绕过。' : ''
    const guidance = `${reason === 'repeated_failure' ? '同类操作反复失败' : reason === 'cycle' ? '工具调用正在重复往返' : '同一观察反复返回相同有效信息'}（${repetitions} 次，工具 ${name}${code ? `，错误 ${code}` : ''}）。${recovery.guidance} ${recovery.skill ? `流程说明：${recovery.skill}。` : ''}${unavailable}这是纠错提示，任务继续；更换请求标识或重复读取不会完成目标。`
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

  summary() {
    if (!this.facts.size && !this.notices.size && !this.recoveries.size) return ''
    const lines = ['[TERMOUS_EXECUTION_STATE]', '以下仅为实际回执摘要；不改变用户目标，不恢复历史授权。以本轮资源绑定和实时工具结果为准。']
    // 保留完整条目，优先记录未解决模式，正文限制在约 2048 Token 以内。
    const notices = [...this.notices.values()].filter((notice) => notice.status === 'detected')
    const recoveries = [...this.recoveries.values()].filter((entry) => !notices.some((notice) => notice.tool_name === entry.tool
      && this.noticeResources.get(notice.pattern_id) === entry.resource && notice.guidance.includes(entry.guidance)))
    const entries = [...notices.reverse(), ...recoveries.reverse(), ...[...this.facts.values()].reverse()]
    for (const entry of entries) {
      const line = JSON.stringify('next_tools' in entry ? { ...entry, next_tools: entry.next_tools.filter(this.available) } : entry)
      if (lines.join('\n').length + line.length > 2000) continue
      lines.push(line)
    }
    lines.push('[/TERMOUS_EXECUTION_STATE]')
    return lines.join('\n')
  }

  snapshot(): ProgressSnapshot {
    const snapshot: ProgressSnapshot = { version: 1, observations: [...this.observations].slice(-32), recent: this.recent.slice(), facts: [...this.facts.values()],
      notices: [...this.notices].map(([id, notice]) => [this.noticeResources.get(id) ?? 'unresolved', { ...notice, next_tools: notice.next_tools.filter(this.available) }]),
      recoveries: [...this.recoveries.values()].map((entry) => ({ ...entry, next_tools: entry.next_tools.filter(this.available) })) }
    // 按 UTF-8 字节预留检查点其余 details 的空间，避免中文诊断通过字符限额却超过提交上限。
    while (Buffer.byteLength(JSON.stringify(snapshot)) > 48 * 1024) {
      if (snapshot.observations.length) snapshot.observations.shift()
      else if (snapshot.facts.length) snapshot.facts.shift()
      else if (snapshot.notices.length) snapshot.notices.shift()
      else if (snapshot.recoveries?.length) snapshot.recoveries.shift()
      else break
    }
    return snapshot
  }

  restore(value: unknown) {
    if (!isRecord(value) || value.version !== 1 || Buffer.byteLength(JSON.stringify(value)) > 48 * 1024
      || !Array.isArray(value.observations) || !Array.isArray(value.recent) || !Array.isArray(value.facts) || !Array.isArray(value.notices)) return false
    // 快照仅恢复诊断证据；资源门禁必须来自当前 Run 的成功回执。
    if (Array.isArray(value.observations)) for (const item of value.observations.slice(-32)) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || item[0].length > 1024 || !isRecord(item[1])) continue
      const v = item[1]
      if (typeof v.fingerprint === 'string' && /^[a-f0-9]{64}$/u.test(v.fingerprint) && Number.isSafeInteger(v.count) && Number(v.count) > 0 && typeof v.name === 'string' && v.name.length <= 128 && typeof v.resource === 'string' && v.resource.length <= 256) {
        const epoch = Number.isSafeInteger(v.epoch) && Number(v.epoch) > 0 ? Number(v.epoch) : ++this.epoch
        this.epoch = Math.max(this.epoch, epoch)
        this.observations.set(item[0], { fingerprint: v.fingerprint, count: Number(v.count), name: v.name, resource: v.resource, epoch })
      }
    }
    if (Array.isArray(value.recent)) this.recent = value.recent.filter((item): item is string => typeof item === 'string' && (item === '' || /^[a-f0-9]{64}$/u.test(item))).slice(-12)
    if (Array.isArray(value.facts)) for (const fact of value.facts.slice(-12)) {
      if (!isRecord(fact) || typeof fact.tool !== 'string' || fact.tool.length > 128 || typeof fact.resource !== 'string' || fact.resource.length > 256 || typeof fact.outcome !== 'string' || fact.outcome.length > 128 || !isRecord(fact.values)) continue
      const safe = progressFact(fact.tool, fact.resource, fact.values, fact.outcome.startsWith('error:'), fact.outcome.slice(6))
      remember(this.facts, `${safe.tool}:${safe.resource}`, safe, 12)
    }
    if (Array.isArray(value.notices)) for (const item of value.notices.slice(-12)) {
      if (!Array.isArray(item) || typeof item[0] !== 'string' || item[0].length > 256 || !isRecord(item[1])) continue
      const notice = { ...item[1], assistant_message_id: 'restored', after_part_sequence: 0 }
      if (!isAgentProgressData(notice)) continue
      const progress: ProgressNotice = { pattern_id: notice.pattern_id, tool_name: notice.tool_name, reason: notice.reason, status: notice.status, count: notice.count, guidance: notice.guidance, next_tools: notice.next_tools.filter(this.available) }
      remember(this.notices, progress.pattern_id, progress, 12)
      remember(this.noticeResources, progress.pattern_id, item[0], 12)
    }
    if (Array.isArray(value.recoveries)) for (const item of value.recoveries.slice(-12)) {
      if (!isRecord(item) || typeof item.tool !== 'string' || item.tool.length > 128 || typeof item.resource !== 'string' || item.resource.length > 256
        || typeof item.guidance !== 'string' || item.guidance.length > 1600 || !Array.isArray(item.next_tools)) continue
      remember(this.recoveries, `${item.tool}:${item.resource}`, { tool: item.tool, resource: item.resource, guidance: item.guidance, empty: item.empty === true,
        next_tools: item.next_tools.filter((name): name is string => typeof name === 'string' && name.length <= 128 && this.available(name)).slice(0, 8) }, 12)
    }
    return true
  }

  private observeRecovery(name: string, resource: string, navigation: ToolNavigation | undefined, error: boolean) {
    if (navigation?.recovery) remember(this.recoveries, `${name}:${resource}`, { tool: name, resource,
      guidance: navigation.guidance.slice(0, 1600), next_tools: navigation.names.filter(this.available).slice(0, 8), empty: navigation.empty }, 12)
    else if (!error && !progressMetaTools.has(name)) this.recoveries.delete(`${name}:${resource}`)
  }

  replay(messages: AgentMessage[], readOnly: (name: string) => boolean) {
    const args = new Map<string, unknown>()
    for (const message of messages) {
      if (message.role === 'assistant') for (const part of message.content) if (part.type === 'toolCall') args.set(part.id, part.arguments)
      if (message.role !== 'toolResult') continue
      const name = decodeMCPToolName(message.toolName) ?? message.toolName
      const result = { content: message.content, details: undefined }
      this.observe(name, args.get(message.toolCallId), { ...result, details: { kind: 'mcp', originalToolName: name, readOnly: readOnly(name), result: { content: message.content, structuredContent: progressData(result), isError: message.isError } } }, message.isError)
      args.delete(message.toolCallId)
    }
    this.completed.clear(); this.cleanupSuspended.clear(); this.pending = []
  }
}

function remember<T>(map: Map<string, T>, key: string, value: T, limit = 128) {
  map.delete(key); map.set(key, value)
  if (map.size > limit) map.delete(map.keys().next().value!)
}
