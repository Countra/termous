import type { AgentSession } from './types.ts'

type SessionOrder = Pick<AgentSession, 'id' | 'sort_order' | 'last_activity_at' | 'updated_at'>

export function compareAgentSessionOrder(left: SessionOrder, right: SessionOrder) {
  const order = (right.sort_order ?? 0) - (left.sort_order ?? 0)
  if (order) return order
  // 已持久化的位置只按 ID 打破平局；聊天活动不会重新排列手动位置。
  if (left.sort_order !== undefined && right.sort_order !== undefined) return right.id.localeCompare(left.id)
  return activityTime(right) - activityTime(left) || right.id.localeCompare(left.id)
}

function activityTime(session: SessionOrder) {
  const value = Date.parse(session.last_activity_at ?? session.updated_at)
  return Number.isFinite(value) ? value : 0
}
