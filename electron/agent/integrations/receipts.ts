import type { CallToolResult } from '@earendil-works/pi-mcp'
import type { IntegrationCallReceipt, IntegrationToolResult } from '#common/agent-integrations'
import type { IntegrationCorePort, IntegrationRunContext } from '../contracts/integrations.ts'
import { normalizeIntegrationResult } from './content.ts'

export function receiptResult(receipt: IntegrationCallReceipt): IntegrationToolResult {
  return receipt.result ?? { content: [{ type: 'text', text: JSON.stringify({ operation: receipt.id, state: receipt.state,
    recovery: 'query_original_operation', message: 'This operation cannot be dispatched again.' }) }], isError: true }
}

// 外部业务调用只派发一次；持久化失败不能转成重新调用远端服务。
export async function executeIntegrationCall(core: IntegrationCorePort, context: IntegrationRunContext, receipt: IntegrationCallReceipt,
  generation: string, execute: (markDispatched: () => void) => Promise<CallToolResult>, signal?: AbortSignal): Promise<IntegrationToolResult> {
  if (!receipt.may_dispatch) return receiptResult(receipt)
  let raw: CallToolResult
  let dispatched = false
  try { signal?.throwIfAborted(); raw = await execute(() => { dispatched = true }) }
  catch (error) {
    const state = dispatched ? 'uncertain' : 'not_dispatched'
    try { await core.settle(receipt.id, state) }
    catch (persistError) { throw Object.assign(new Error('INTEGRATION_RESULT_UNCERTAIN'), { causes: [error, persistError] }) }
    throw Object.assign(new Error(dispatched ? 'INTEGRATION_RESULT_UNCERTAIN' : 'INTEGRATION_NOT_DISPATCHED'), { cause: error })
  }
  let result: IntegrationToolResult
  try { result = await normalizeIntegrationResult(core, context, receipt.id, raw, signal) }
  catch {
    result = { content: [{ type: 'text', text: 'The external operation returned, but its content could not be saved. Do not repeat the operation. Query its state at the source.' }],
      isError: true, operation: receipt.id }
  }
  result.connection_generation = generation
  // 回执写入为幂等操作；网络响应丢失时仅重试完全相同的本地持久化。
  try { await core.settle(receipt.id, 'completed', result) }
  catch { await core.settle(receipt.id, 'completed', result) }
  return result
}
