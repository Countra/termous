import type { CloudAuthorization } from '#common/contracts'

const snapshots = new WeakMap<CloudAuthorization, { remaining: number; started: number }>()

// 授权快照只用单调时钟递减；恢复流程保留自己的期限合同。
export function cloudAuthorizationRemaining(value: CloudAuthorization, now = performance.now()): number {
  let snapshot = snapshots.get(value)
  if (!snapshot) {
    const remaining = value.remaining_ms ?? Date.parse(value.expires_at) - Date.parse(value.server_time)
    snapshot = { remaining: Number.isFinite(remaining) ? Math.max(0, remaining) : 0, started: now }
    snapshots.set(value, snapshot)
  }
  return Math.max(0, snapshot.remaining - Math.max(0, now - snapshot.started))
}
