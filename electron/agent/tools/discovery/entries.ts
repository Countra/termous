import type { ToolCapability } from '../../contracts/toolCapabilities.ts'

// 公平合并不同能力入口；顺序仅影响声明展示，不代表必须依次执行。
export function mergeEntryQueues(queues: readonly (readonly string[])[], maximum = Number.POSITIVE_INFINITY): string[] {
  const result = new Set<string>()
  const length = Math.max(0, ...queues.map(queue => queue.length))
  for (let index = 0; index < length && result.size < maximum; index++) {
    for (const queue of queues) {
      if (queue[index]) result.add(queue[index])
      if (result.size >= maximum) break
    }
  }
  return [...result]
}

export function capabilityEntries(capability: ToolCapability, resolve: (capability: ToolCapability, name: string) => string) {
  return [...new Set(capability.discovery.entry.map(name => resolve(capability, name)))]
}
