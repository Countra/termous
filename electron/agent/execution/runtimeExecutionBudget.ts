import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { defaultExecutionBudget, isExecutionBudget, type ExecutionBudget, type ExecutionLimits } from '#common/contracts'
import { isRecord } from '../contracts/validation.ts'
import { runtimeToolOutcome, type RuntimeStopReason } from './runtimeInputSafety.ts'
import { RuntimeExecutionUsage } from './runtimeExecutionUsage.ts'

export { defaultExecutionBudget, type ExecutionBudget, type ExecutionLimits } from '#common/contracts'

type BudgetKind = keyof ExecutionLimits
export type BudgetCheckpoint =
  | { type: 'before_request'; estimatedInput: number }
  | { type: 'before_tool'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; args: unknown; result: AgentToolResult<unknown>; isError: boolean }

interface BudgetFailure extends RuntimeStopReason { kind: BudgetKind; value: number; limit: number }
export type BudgetDecision = { allowed: true } | { allowed: false; reason: BudgetFailure }
interface Measurement { kind: BudgetKind; value: number }

const rules: Record<BudgetKind, { code: string; message: string }> = {
  model_requests: { code: 'REQUEST_LIMIT', message: '已达到本轮模型请求上限' },
  total_tokens: { code: 'TOKEN_LIMIT', message: '本轮累计 Token 已达到上限，或剩余额度不足以发送下一次请求' },
  consecutive_failures: { code: 'NO_PROGRESS', message: '同一资源的同类操作连续失败已达到上限，自动纠错已停止' },
  selection_attempts: { code: 'SELECTION_LIMIT', message: '本桌面选区流程的尝试已达到上限' },
}

export class RuntimeExecutionBudget {
  readonly policy: Readonly<{ enabled: boolean; limits: Readonly<ExecutionLimits> }>
  readonly usage = new RuntimeExecutionUsage()
  private stopped?: BudgetFailure
  private readonly selections = new Map<string, number>()
  private readonly failures = new Map<string, { reason: string; count: number }>()
  private readonly resources = new Map<string, string>()
  private readonly confirmedPreviews = new Set<string>()

  constructor(policy: ExecutionBudget = defaultExecutionBudget) {
    if (!isExecutionBudget(policy)) throw new Error('AGENT_RUNTIME_BUDGET_INVALID')
    this.policy = Object.freeze({ enabled: policy.enabled, limits: Object.freeze({ ...policy.limits }) })
  }

  failure() { return this.stopped }

  // 所有循环检查点只调用此入口；开关、阈值比较、首个终止原因统一处理。
  evaluate(checkpoint: BudgetCheckpoint): BudgetDecision {
    if (!this.policy.enabled) return { allowed: true }
    if (!this.stopped) {
      for (const measurement of this.measure(checkpoint)) {
        const limit = this.policy.limits[measurement.kind]
        if (measurement.value < limit) continue
        const rule = rules[measurement.kind]
        this.stopped = { ...measurement, limit, code: `AGENT_RUNTIME_${rule.code}`, message: `${rule.message}。已保留当前成果和调用诊断；可在设置中调整执行预算后发起后续任务。所属运行与控制将按生命周期清理。请求 ${this.usage.requests} 次，累计${this.usage.estimated ? '估算 ' : ' '}${Math.round(this.usage.tokens)} Token。` }
        break
      }
    }
    if (this.stopped) return { allowed: false, reason: this.stopped }
    if (checkpoint.type === 'before_tool' && checkpoint.name.endsWith('templates.preview')) {
      const key = this.resource(checkpoint.args)
      this.selections.set(key, (this.selections.get(key) ?? 0) + 1)
    }
    return { allowed: true }
  }

  private measure(checkpoint: BudgetCheckpoint): Measurement[] {
    switch (checkpoint.type) {
      case 'before_request':
        return [{ kind: 'model_requests', value: this.usage.requests }, { kind: 'total_tokens', value: this.usage.tokens + checkpoint.estimatedInput }]
      case 'before_tool':
        // 用量达到限额只阻止后续工作，已经完成的最终回答仍应正常结束。
        return [{ kind: 'total_tokens', value: this.usage.tokens }, ...(checkpoint.name.endsWith('templates.preview')
          ? [{ kind: 'selection_attempts' as const, value: this.selections.get(this.resource(checkpoint.args)) ?? 0 }] : [])]
      case 'tool_result':
        return this.observe(checkpoint)
    }
  }

  private observe({ name, args, result, isError }: Extract<BudgetCheckpoint, { type: 'tool_result' }>): Measurement[] {
    const outcome = runtimeToolOutcome(result, isError)
    const input = isRecord(args) ? args : {}
    const visual = /desktop_workflows\.(templates|captures)\./u.test(name)
    const resource = this.resource(args)
    const key = `${visual ? 'desktop_visual' : name}:${resource}`
    if (outcome.error) {
      const previous = this.failures.get(key)
      const count = previous?.reason === outcome.reason ? previous.count + 1 : 1
      this.failures.set(key, { reason: outcome.reason, count })
      return [{ kind: 'consecutive_failures', value: count }]
    }
    this.rememberResources(outcome.data, resource)
    if (!visual) this.failures.delete(key)
    if (name.endsWith('templates.confirm') && typeof input.preview_id === 'string' && this.resources.has(`preview_id:${input.preview_id}`) && !this.confirmedPreviews.has(input.preview_id)) {
      // 只以已观察到的预览完成结束当前流程，重复确认旧预览不能清空新一轮计数。
      this.confirmedPreviews.add(input.preview_id)
      this.failures.delete(key)
      this.selections.delete(resource)
    }
    return []
  }

  private resource(args: unknown): string {
    if (!isRecord(args)) return 'unresolved'
    for (const field of ['attachment_id', 'snapshot_id', 'view_id', 'preview_id']) {
      const id = args[field]
      if (typeof id !== 'string' || !id) continue
      const known = this.resources.get(`${field}:${id}`)
      if (known) return known
    }
    for (const field of ['run_id', 'script_id', 'session_id', 'file_session_id', 'ssh_profile_id', 'profile_id']) {
      if (typeof args[field] === 'string' && args[field]) return `${field}:${args[field]}`
    }
    // 未知快照不能靠换标识绕过失败次数；成功工具结果才建立资源关系。
    return 'unresolved'
  }

  private rememberResources(data: Record<string, unknown>, resource: string) {
    const attachment = isRecord(data.attachment) ? data.attachment : undefined
    if (attachment && typeof attachment.id === 'string' && typeof attachment.session_id === 'string') {
      const key = `desktop:${attachment.session_id}:${attachment.connection_generation}:${attachment.execution_generation}`
      this.resources.set(`attachment_id:${attachment.id}`, key)
    }
    for (const [branch, field] of [['snapshot', 'snapshot_id'], ['preview', 'preview_id']] as const) {
      const value = data[branch]
      if (isRecord(value) && typeof value[field] === 'string') this.resources.set(`${field}:${value[field]}`, resource)
    }
    const view = isRecord(data.view) && isRecord(data.view.image_view) ? data.view.image_view : undefined
    if (typeof view?.view_id === 'string') this.resources.set(`view_id:${view.view_id}`, resource)
  }
}
