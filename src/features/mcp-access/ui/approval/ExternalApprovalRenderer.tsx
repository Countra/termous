import type { McpApprovalOperation } from '#entities/mcp-access'
import { ApprovalScrollableCode } from './ApprovalDetailFields'
import styles from './ApprovalDetails.module.scss'

export function ExternalApprovalRenderer({operation}: {operation:McpApprovalOperation}) {
  const external=operation.external
  if (!external) return null
  let args=external.arguments
  try { args=JSON.stringify(JSON.parse(args),null,2) } catch { /* 历史异常参数仍按原文展示，不重新解释或执行。 */ }
  return <div className={styles.operation}><div className={styles['operation-title']}><strong>{external.tool}</strong></div><ApprovalScrollableCode value={args}/></div>
}
