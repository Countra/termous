import type { RuntimeBootstrap } from '../../contracts/runtimeBootstrap.ts'
import { decodeMCPToolName } from '../../contracts/toolNameCodec.ts'
import { isRecord } from '../../contracts/validation.ts'
import { DesktopObservationContext } from './state.ts'

export function restoreDesktopObservation(bootstrap: RuntimeBootstrap) {
  const context = new DesktopObservationContext(bootstrap.session.id, bootstrap.core_instance_id, bootstrap.session.resource_bindings)
  const checkpoint = bootstrap.context.checkpoint
  const checkpointHasState = checkpoint?.details !== undefined && Object.prototype.hasOwnProperty.call(checkpoint.details, 'desktop_context')
  if (checkpointHasState) context.restore(checkpoint!.details!.desktop_context)
  const result = (name: string, content: unknown) => {
    const original = decodeMCPToolName(name) ?? name
    // 外部工具按来源限定名称；不能借同名正文恢复 Termous 的观察目标。
    if (!['termous.desktops.', 'termous.desktop_workflows.', 'termous.screen_analyses.'].some(prefix => original.startsWith(prefix)) || !Array.isArray(content)) return
    for (const block of content) {
      if (!isRecord(block) || block.type !== 'text' || typeof block.text !== 'string' || block.text.length > 16384) continue
      try {
        const value: unknown = JSON.parse(block.text)
        if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'termous_desktop_context')) { context.restore(value.termous_desktop_context); return }
      } catch { /* 非结构化正文不是观察上下文。 */ }
    }
    // 旧回执没有 Core 与绑定身份，不能证明仍属于当前上下文，退回正常发现流程。
  }
  // 快照已覆盖保留尾部；即使快照损坏也不倒退重放旧尾部，以免恢复已清除目标。
  if (!checkpointHasState) for (const message of checkpoint?.retained_tail ?? []) {
    if (message.role === 'toolResult') result(message.toolName, message.content)
  }
  for (const message of bootstrap.messages) for (const part of message.parts) {
    const receipt = part.content.tool_result
    if (part.kind === 'tool_result' && isRecord(receipt) && typeof receipt.tool_name === 'string' && typeof receipt.tool_call_id === 'string') {
      result(receipt.tool_name, receipt.content)
    }
  }
  return context
}
