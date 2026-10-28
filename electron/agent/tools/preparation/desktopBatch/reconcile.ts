import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core'
import { desktopBatchQueryReceipt } from './receipt.ts'

// 同次调用的传输恢复只核查一次原请求，不借客户端重试重新提交动作数组。
export async function reconcileDesktopBatch(query: AgentTool | undefined, callID: string, requestID: string,
  signal?: AbortSignal, update?: Parameters<AgentTool['execute']>[3]): Promise<AgentToolResult<unknown> | undefined> {
  if (!query || signal?.aborted) return undefined
  const querySignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(3000)]) : AbortSignal.timeout(3000)
  try {
    const receipt = await query.execute(callID, { client_request_id: requestID }, querySignal, update)
    if (desktopBatchQueryReceipt(receipt, requestID)) return receipt
  } catch { /* 核查失败保留派发未知状态，不以新请求覆盖原输入。 */ }
  return undefined
}
