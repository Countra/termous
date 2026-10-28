import type { AgentToolResult } from '@earendil-works/pi-agent-core'
import { readDesktopBatch } from '#common/desktop-batch'
import { isMCPToolDetails } from '../../../contracts/mcpTools.ts'
import { isRecord } from '../../../contracts/validation.ts'
import type { Arguments, PreparationContext } from '../contracts.ts'

export function observeDesktopBatch(ctx: Pick<PreparationContext, 'read' | 'remember'>, output: Arguments) {
  if (!readDesktopBatch(output) || !isRecord(output.run) || !isRecord(output.capture)) return
  const { attachment_id: attachment } = output.run
  const { screenshot_id: screenshot, expires_at: expires } = output.capture
  const current = ctx.read('desktop:attachment')
  // 历史图片可以展示；只有仍属于本轮附着的有效截图才能成为新的输入依据。
  if (typeof screenshot === 'string' && current?.id === attachment && typeof expires === 'string' && Date.parse(expires) > Date.now()) {
    ctx.remember(`capture:${screenshot}`, { attachment_id: attachment })
  }
}

export function desktopBatchQueryReceipt(result: AgentToolResult<unknown>, originalRequest: string): boolean {
  if (!isMCPToolDetails(result.details)) return false
  const output = result.details.result.structuredContent
  return readDesktopBatch(output) !== undefined && isRecord(output) && isRecord(output.run) && output.run.client_request_id === originalRequest
}
