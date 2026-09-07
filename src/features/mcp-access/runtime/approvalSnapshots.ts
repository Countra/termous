import type { McpApproval, McpApprovalSnapshot } from '#entities/mcp-access'

export function emptyApprovalSnapshot(): McpApprovalSnapshot {
  return { instance_id: '', revision: 0, items: [] }
}

export function mergeApprovalSnapshot(
  current: McpApprovalSnapshot,
  incoming: McpApprovalSnapshot,
): McpApprovalSnapshot {
  if (current.instance_id === incoming.instance_id && incoming.revision <= current.revision) {
    return current
  }
  return {
    ...incoming,
    items: sortPendingApprovals(incoming.items),
  }
}

export function mergeApprovalDecision(
  current: McpApprovalSnapshot,
  approval: McpApproval,
): McpApprovalSnapshot {
  return {
    ...current,
    items: approval.state === 'pending'
      ? current.items.map((item) => item.id === approval.id ? approval : item)
      : current.items.filter((item) => item.id !== approval.id),
  }
}

function sortPendingApprovals(approvals: McpApproval[]) {
  return [...approvals]
    .filter((approval) => approval.state === 'pending')
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at) || left.id.localeCompare(right.id))
}
