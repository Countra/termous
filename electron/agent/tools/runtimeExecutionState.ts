import { isAgentProgressData, type AgentProgressData } from '#common/contracts'
import { isRecord } from '../contracts/validation.ts'
import { confirmedDesktopAttachment, desktopAttachment, desktopControlUnconfirmed, desktopGrantCurrent, desktopObservation, projectDesktopEvidence } from './runtimeDesktopObservation.ts'
import { progressFact, progressResource } from './runtimeToolEvidence.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'

export type ProgressNotice = Omit<AgentProgressData, 'assistant_message_id' | 'after_part_sequence'> & { origin?: 'current' | 'historical' }
export interface ExecutionRecovery { tool: string; resource: string; guidance: string; next_tools: string[]; empty?: boolean; origin?: 'current' | 'historical' }
type Fact = ReturnType<typeof progressFact> & { origin: 'current' | 'historical'; observed_at?: number }
export interface ProgressSnapshot { version: 2; facts: Fact[]; notices: [string, ProgressNotice][]; recoveries: ExecutionRecovery[] }

// 当前事实与历史经验分开保存；此投影不保存可执行授权，也不参与调用门禁。
export class RuntimeExecutionState {
  private readonly facts = new Map<string, Fact>()
  private readonly historicalNotices = new Map<string, [string, ProgressNotice]>()
  private readonly historicalRecoveries = new Map<string, ExecutionRecovery>()
  private readonly now: () => number
  private readonly available: (name: string) => boolean
  constructor(now: () => number, available: (name: string) => boolean) { this.now = now; this.available = available }

  observe(name: string, resource: string, data: Record<string, unknown>, args: unknown, failed: boolean, code?: string,
    origin: Fact['origin'] = 'current', timestamp = this.now()) {
    failed ||= runtimeToolOutcome(name, data) === 'failed'
    const fact: Fact = { ...progressFact(name, resource, data, failed, code), origin, observed_at: timestamp }
    const desktop = desktopObservation(name, data, args, failed, timestamp)
    if (desktop) fact.values = { ...fact.values, ...desktop }
    const key = factKey(fact)
    // 旧 grant 的失败回执不能把同一附着的新授权覆盖为失效。
    const previous = this.facts.get(key)
    const grantChanged = desktop?.grant_status === 'held' && (previous?.origin !== origin
      || projectDesktopEvidence(previous.values, false, timestamp).grant_status !== 'held' || previous.values.grant_id !== desktop.grant_id)
    if (desktop && previous?.origin === 'current' && previous.values.grant_id && desktop.grant_id && !desktop.grant_expires_at
      && previous.values.grant_id !== desktop.grant_id) return
    if (origin === 'historical' && previous?.origin === 'current') return
    if (desktop?.attachment_id && previous?.origin === origin && !desktop.grant_expires_at && !desktopAttachment(data)) {
      fact.values = { ...previous.values, ...fact.values }
    }
    // 关闭会话或代次变更使旧附着的授权提示失效，不影响其他会话。
    if (origin === 'current') for (const existing of this.facts.values()) {
      const session = existing.values.session_id
      const closed = !failed && name === 'termous.desktops.close' && data.completed === true && isRecord(args) && session === args.session_id
        && (args.connection_generation === undefined || existing.values.connection_generation === undefined || args.connection_generation === existing.values.connection_generation)
      const unavailable = desktop?.session_id === session && !desktop?.attachment_id
        && (desktop?.desktop_available === false || ['failed', 'stopping', 'closed', 'reconnecting', 'reattach_wait', 'not_found'].includes(String(desktop?.status)))
      const changed = desktop?.session_id && desktop.session_id === session && ['connection_generation', 'execution_generation']
        .some((field) => desktop[field] !== undefined && existing.values[field] !== undefined && desktop[field] !== existing.values[field])
      if (closed || changed || unavailable) {
        if (['held', 'not_held'].includes(String(existing.values.grant_status))) existing.values.grant_status = 'needs_verification'
        if (existing.values.control_status) existing.values.control_status = 'needs_verification'
      }
    }
    remember(this.facts, key, fact)
    if (!failed && !['pending', 'waiting'].includes(runtimeToolOutcome(name, data)) && !desktopControlUnconfirmed(name, data, timestamp)) this.resolveRecovery(name, resource)
    return grantChanged
  }

  resolveRecovery(name: string, resource: string) {
    for (const [id, [scope, notice]] of this.historicalNotices) if (notice.tool_name === name && scope === resource) this.historicalNotices.delete(id)
    this.historicalRecoveries.delete(`${name}:${resource}`)
    // 成功回执可能按附着保存；同一请求键下的旧错误不能继续占据摘要。
    const key = `${name}:${resource}`
    if (this.facts.get(key)?.outcome.startsWith('error:')) this.facts.delete(key)
  }

  historicalEmpty(name: string, resource: string) { return this.historicalRecoveries.get(`${name}:${resource}`)?.empty === true }

  confirmedRecoveries(name: string, data: Record<string, unknown>, timestamp = this.now(), grantChanged = false) {
    const attachment = confirmedDesktopAttachment(name, data)
    if (!attachment) return []
    const resource = progressResource({ attachment_id: attachment.id })
    const held = desktopGrantCurrent(attachment, timestamp)
    if (name !== 'termous.desktops.get' && (!held || !grantChanged)) return []
    return [{ tool: 'termous.desktops.get', resource },
      ...(held ? [{ tool: 'termous.desktops.control.acquire', resource }] : []),
      ...(held && grantChanged ? [{ tool: 'termous.desktops.get', resource: progressResource({}, { attachment }) }] : [])]
  }

  prerequisiteRecovery(name: string, data: Record<string, unknown>) {
    const attachment = name === 'termous.desktops.get' ? confirmedDesktopAttachment(name, data) : undefined
    return attachment && attachment.grant == null
      ? { tool: 'termous.desktops.control.acquire', resource: progressResource({ attachment_id: attachment.id }) } : undefined
  }

  historicalRecovery(recovery: ExecutionRecovery) {
    remember(this.historicalRecoveries, `${recovery.tool}:${recovery.resource}`, { ...recovery, origin: 'historical' })
  }

  private projectedFacts() {
    return [...this.facts.values()].map((fact) => ({ ...fact, values: projectDesktopEvidence(fact.values, fact.origin === 'historical', this.now()) }))
  }

  summary(notices: [string, ProgressNotice][], recoveries: ExecutionRecovery[]) {
    const facts = this.projectedFacts().reverse()
    const detected = notices.filter(([, notice]) => notice.status === 'detected')
    const pending = recoveries.filter((entry) => !detected.some(([resource, notice]) => notice.tool_name === entry.tool && resource === entry.resource && notice.guidance.includes(entry.guidance)))
    const current = facts.filter((fact) => fact.origin === 'current')
    const entries = [
      ...current.slice(0, 1), ...detected.reverse().map(([, notice]) => ({ ...notice, origin: 'current' })),
      ...pending.reverse().map((entry) => ({ ...entry, origin: 'current' })), ...current.slice(1),
      ...[...this.historicalNotices.values()].reverse().map(([, notice]) => notice),
      ...[...this.historicalRecoveries.values()].reverse(), ...facts.filter((fact) => fact.origin === 'historical'),
    ]
    if (!entries.length) return ''
    const lines = ['[TERMOUS_EXECUTION_STATE]', 'current 是本轮实际回执；historical 仅供参考，旧附着、授权和截图需重新核验。not_held 表示最近查询未返回授权；needs_verification 表示尚待核验，均不代表应立即重新申请。先处理原错误或审批状态。已登记任务保留原标识查询，不重新执行。']
    for (const entry of entries) {
      // 完整反馈仍在原回执中；摘要给当前事实与未解决诊断各留空间。
      const line = JSON.stringify('next_tools' in entry ? { ...entry, guidance: entry.guidance.slice(0, 500), next_tools: entry.next_tools.filter(this.available).slice(0, 3) } : entry)
      if (lines.join('\n').length + line.length <= 2000) lines.push(line)
    }
    lines.push('[/TERMOUS_EXECUTION_STATE]')
    return lines.join('\n')
  }

  snapshot(notices: [string, ProgressNotice][], recoveries: ExecutionRecovery[]): ProgressSnapshot {
    const snapshot: ProgressSnapshot = { version: 2, facts: this.projectedFacts(),
      notices: [...this.historicalNotices.values(), ...notices].slice(-12).map(([scope, notice]) => [scope, { ...notice, next_tools: notice.next_tools.filter(this.available) }]),
      recoveries: [...this.historicalRecoveries.values(), ...recoveries].slice(-12).map((entry) => ({ ...entry, next_tools: entry.next_tools.filter(this.available) })) }
    while (Buffer.byteLength(JSON.stringify(snapshot)) > 48 * 1024) {
      if (snapshot.facts.length) snapshot.facts.shift()
      else if (snapshot.notices.length) snapshot.notices.shift()
      else if (snapshot.recoveries.length) snapshot.recoveries.shift()
      else break
    }
    return snapshot
  }

  restore(value: unknown) {
    if (!isRecord(value) || (value.version !== 1 && value.version !== 2) || Buffer.byteLength(JSON.stringify(value)) > 48 * 1024
      || !Array.isArray(value.facts) || !Array.isArray(value.notices)
      || value.version === 1 && (!Array.isArray(value.observations) || !Array.isArray(value.recent))) return false
    // 不恢复 observations/recent，防止上一运行的重复次数污染本轮。
    for (const fact of value.facts.slice(-12)) {
      if (!isRecord(fact) || !shortString(fact.tool, 128) || !shortString(fact.resource, 256) || !shortString(fact.outcome, 128) || !isRecord(fact.values)) continue
      const safe = progressFact(fact.tool, fact.resource, fact.values, fact.outcome.startsWith('error:'), fact.outcome.slice(6))
      const restored: Fact = { ...safe, outcome: fact.outcome, origin: 'historical',
        values: projectDesktopEvidence(safe.values, true, this.now()),
        ...(typeof fact.observed_at === 'number' && Number.isFinite(fact.observed_at) ? { observed_at: fact.observed_at } : {}) }
      remember(this.facts, factKey(restored), restored)
    }
    for (const item of value.notices.slice(-12)) {
      if (!Array.isArray(item) || !shortString(item[0], 256) || !isRecord(item[1])) continue
      const notice = { ...item[1], assistant_message_id: 'restored', after_part_sequence: 0 }
      if (!isAgentProgressData(notice)) continue
      const safe: ProgressNotice = { pattern_id: notice.pattern_id, tool_name: notice.tool_name, reason: notice.reason, status: notice.status,
        count: notice.count, guidance: notice.guidance, next_tools: notice.next_tools.filter(this.available), origin: 'historical' }
      if (safe.status === 'detected') remember(this.historicalNotices, safe.pattern_id, [item[0], safe])
    }
    if (Array.isArray(value.recoveries)) for (const entry of value.recoveries.slice(-12)) {
      if (!isRecord(entry) || !shortString(entry.tool, 128) || !shortString(entry.resource, 256) || !shortString(entry.guidance, 1600) || !Array.isArray(entry.next_tools)) continue
      this.historicalRecovery({ tool: entry.tool, resource: entry.resource, guidance: entry.guidance, empty: entry.empty === true,
        next_tools: entry.next_tools.filter((name): name is string => shortString(name, 128) && this.available(name)).slice(0, 8) })
    }
    return true
  }
}

function shortString(value: unknown, max: number): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max }
function factKey(fact: Pick<Fact, 'tool' | 'resource' | 'values'>) {
  return fact.tool.startsWith('termous.desktops.') && fact.values.attachment_id ? `desktop:${fact.values.attachment_id}` : `${fact.tool}:${fact.resource}`
}
function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key); map.set(key, value)
  if (map.size > 12) map.delete(map.keys().next().value!)
}
