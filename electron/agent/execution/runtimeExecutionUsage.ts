import { addRuntimeUsage, emptyRuntimeUsage, type RuntimeUsage } from '../provider/runtimeUsage.ts'

// 记录实际请求尝试与已处理用量，不承担停止策略；关闭预算仍保留统计。
export class RuntimeExecutionUsage {
  requests = 0
  private total = emptyRuntimeUsage()
  get tokens() { return this.total.total_tokens }
  get estimated() { return this.total.estimated }
  beginRequest() { return ++this.requests }
  record(usage: RuntimeUsage) { this.total = addRuntimeUsage(this.total, usage) }
}
