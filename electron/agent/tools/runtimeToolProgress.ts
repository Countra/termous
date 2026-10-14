import { createHash } from 'node:crypto'
import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { isMCPToolDetails } from '../contracts/mcpTools.ts'
import { isSkillResourceToolDetails } from './skillResourceTool.ts'
import { isRecord } from '../contracts/validation.ts'
import { runtimeToolOutcome } from '../execution/runtimeInputSafety.ts'
import { completedToolGuidance, completedToolResource } from './runtimeToolLifecycle.ts'

interface Observation { fingerprint: string; count: number }
const metaTools = new Set(['read_skill_resource', 'discover_tools', 'read_history_image'])
const guidance = '同一读取已多次返回相同信息，继续重复不会推进任务。请使用已取得的信息执行准确操作；工具未加载时用 discover_tools 搜索，不要用读取文档或相似工具代替。确实缺少能力时直接说明。'

// 纠正重复读取和已完成资源的清理，不限制任务总长度；可选预算仍由预算中心裁定。
export class RuntimeToolProgress {
  private readonly observations = new Map<string, Observation>()
  private readonly suspended = new Set<string>()
  private readonly skills = new Map<string, string>()
  private readonly completed = new Map<string, true>()
  private readonly cleanupSuspended = new Set<string>()
  private readonly mutations = new Map<string, string>()

  blocked(name: string) { return this.suspended.has(name) ? guidance : undefined }
  hidden(name: string) { return Boolean(this.blocked(name)) || this.cleanupSuspended.has(name) }

  beforeCall(name: string, args: unknown) {
    const resource = completedToolResource(name, args)
    if (resource && this.completed.has(`${name}:${digest(resource)}`)) {
      this.cleanupSuspended.add(name)
      return completedToolGuidance(name)
    }
    if (name !== 'discover_tools' && (this.observations.get(observationKey(name, args))?.count ?? 0) >= 3) {
      this.suspended.add(name)
      return guidance
    }
    return undefined
  }

  // 显式发现或新业务进展可恢复工具声明；已确认的旧资源仍受执行门禁保护。
  rediscover(name: string) { this.cleanupSuspended.delete(name); this.suspended.delete(name) }

  reset() { this.observations.clear(); this.suspended.clear(); this.skills.clear(); this.cleanupSuspended.clear() }

  contextChanged(hasSkill: (uri: string) => boolean) {
    // 全文退出上下文后允许按需重读；不能因为历史上读过就永久封锁资源。
    for (const [key, uri] of this.skills) if (!hasSkill(uri)) {
      this.skills.delete(key)
      this.observations.delete(key)
      this.suspended.delete('read_skill_resource')
    }
  }

  observe(name: string, args: unknown, result: AgentToolResult<unknown>, isError: boolean): string | undefined {
    const mcp = isMCPToolDetails(result.details) ? result.details : undefined
    if (isError || mcp?.result.isError) return undefined
    const data = runtimeToolOutcome(result, isError).data
    const resource = mcp && completedToolResource(name, args, data)
    if (resource) {
      const key = `${name}:${digest(resource)}`
      if (this.completed.has(key)) return completedToolGuidance(name)
      this.reset()
      remember(this.completed, key, true)
      return undefined
    }
    const skill = isSkillResourceToolDetails(result.details) ? result.details : undefined
    const readOnly = metaTools.has(name) || mcp?.readOnly === true
    if (!readOnly) {
      // 相同写入回执不再无条件重置纠正状态；键鼠等普通操作仍可合法重复，不按幂等提示推断终态。
      const key = `${name}:${digest(args)}`
      const fingerprint = digest(mcp?.result.structuredContent ?? result.content)
      if (this.mutations.get(key) !== fingerprint) this.reset()
      remember(this.mutations, key, fingerprint)
      return undefined
    }
    if (polling(args, data)) return undefined
    const key = observationKey(name, skill ? { uri: isRecord(args) && typeof args.uri === 'string' ? args.uri : skill.uri } : args)
    const fingerprint = skill?.sha256 ?? digest(mcp?.result.structuredContent ?? result.content)
    const previous = this.observations.get(key)
    if ((!previous || previous.fingerprint !== fingerprint) && !metaTools.has(name)) {
      this.reset()
    }
    const count = previous?.fingerprint === fingerprint ? previous.count + 1 : 1
    this.observations.delete(key)
    this.observations.set(key, { fingerprint, count })
    if (skill) this.skills.set(key, skill.uri)
    // 只保存哈希和有限窗口，工具正文及输入不形成第二份长期缓存。
    while (this.observations.size > 128) {
      const oldest = this.observations.keys().next().value!
      this.observations.delete(oldest)
      this.skills.delete(oldest)
    }
    if (count < 2) return undefined
    if (count >= 3 && name !== 'discover_tools') this.suspended.add(name)
    return this.suspended.has(name) ? `${guidance} 此工具暂时撤下；需要读取其他资源时可显式发现恢复。同一重复请求仍受保护，实际业务推进或正文退出上下文后可恢复。` : guidance
  }
}

function observationKey(name: string, args: unknown) {
  const input = isRecord(args) ? name === 'read_skill_resource' ? { uri: args.uri } : { ...args, wait_ms: undefined, after_revision: undefined } : args
  return `${name}:${digest(input)}`
}

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key)
  map.set(key, value)
  // 这是有界纠错窗口，不替代 Core 的操作去重账本或授权检查。
  if (map.size > 128) map.delete(map.keys().next().value!)
}

function polling(args: unknown, data: unknown) {
  const report = isRecord(data) && isRecord(data.report) ? data.report : data
  const states = isRecord(report) ? ['run', 'task', 'operation', 'session', 'attachment'].map((key) => report[key])
    .filter((value) => isRecord(value) && typeof value.state === 'string') : []
  // 已有明确终态时，长轮询参数不能让相同结果永久免于重复检测。
  if (states.length) return states.some((value) => /^(?:preparing|queued|running|pending|connecting|waiting.*|paused)$/u.test(String((value as Record<string, unknown>).state)))
  return isRecord(args) && (typeof args.wait_ms === 'number' && args.wait_ms > 0 || typeof args.after_revision === 'number')
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => {
    if (!isRecord(item)) return item
    return Object.fromEntries(Object.keys(item).sort().filter((key) => key !== 'client_request_id' && key !== 'refresh').map((key) => [key, item[key]]))
  }) ?? 'null').digest('hex')
}
