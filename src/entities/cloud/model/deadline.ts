export interface CloudTimeValue { server_time: string }

const observed = new WeakMap<object, number>()

export function observeCloudTime<T extends object>(value: T): T {
  observed.set(value, performance.now())
  return value
}

// 截止时间始终与同一响应的云端时间比较，本机日期调整不改变操作资格。
export function cloudDeadlineRemaining(value: CloudTimeValue | undefined, deadline: string | undefined, now = performance.now()): number {
  if (!value || !deadline) return 0
  let started = observed.get(value)
  if (started === undefined) { started = now; observed.set(value, started) }
  const remaining = Date.parse(deadline) - Date.parse(value.server_time) - Math.max(0, now - started)
  return Number.isFinite(remaining) ? Math.max(0, remaining) : 0
}
