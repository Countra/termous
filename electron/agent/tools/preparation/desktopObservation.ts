import { isRecord } from '../../contracts/validation.ts'
import { isMCPToolDetails } from '../../contracts/mcpTools.ts'
import { fail, item, PreparationStopped, type Arguments, type PreparationContext } from './contracts.ts'
import { hasHostDesktopTarget, hostDesktopTarget } from './hostDesktop.ts'
import { desktopSession } from './desktopSession.ts'
import { attachmentMatches, desktopSelection } from './desktopSelection.ts'
import { observationRecovery } from '../recovery/preparation.ts'

const observationTools = new Set(['termous.desktops.capture', 'termous.desktop_workflows.captures.create', 'termous.screen_analyses.create'])

function staleAttachment(error: unknown) {
  if (!(error instanceof PreparationStopped) || !isMCPToolDetails(error.result.details)) return false
  const output = error.result.details.result.structuredContent
  const failure = isRecord(output) && isRecord(output.error) ? output.error : undefined
  const execution = failure && isRecord(failure.execution) ? failure.execution : undefined
  const recovery = execution && isRecord(execution.recovery) ? execution.recovery : undefined
  return failure?.code === 'desktop_generation_stale' && (!execution || execution.dispatch === 'not_started')
    && (!recovery || recovery.kind === 'reread' && (!recovery.tool || recovery.tool === 'termous.desktops.attach' && recovery.arguments === undefined))
}

export async function desktopAttachment(ctx: PreparationContext, args: Arguments): Promise<Arguments> {
  const selected = desktopSelection(ctx, args)
  let id = args.attachment_id
  const explicit = id !== undefined || args.screenshot_id !== undefined
  if (id === undefined && typeof args.screenshot_id === 'string') {
    id = ctx.read(`capture:${args.screenshot_id}`)?.attachment_id
    if (!id) fail('AGENT_OBSERVATION_REQUIRED', 'This screenshot is not registered in the current execution. Observe again and locate the target; old coordinates cannot be reused.', observationRecovery(ctx))
  }
  const cached = ctx.read('desktop:attachment')
  if (id === undefined && cached && attachmentMatches(ctx, selected, cached)) id = cached.id
  if (id !== undefined) {
    try {
      const receipt = await ctx.invoke('termous.desktops.get', { attachment_id: id, wait_ms: 10000 }, 'attachment_get')
      const attachment = item(receipt.attachment, 'attachment')
      if (attachment.id !== id || !attachmentMatches(ctx, selected, { ...(cached?.id === id ? cached : {}), ...attachment })) {
        fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The attachment does not match the selected target. Observe the selected target again and locate it before input; do not reuse old screenshots or coordinates.', observationRecovery(ctx))
      }
      if (['invalidated', 'detached'].includes(String(attachment.state)) && !explicit && observationTools.has(ctx.name)) ctx.forget('desktop:attachment')
      else {
        if (['invalidated', 'detached'].includes(String(attachment.state))) fail('AGENT_OBSERVATION_REQUIRED', 'The original attachment has ended. Querying it again cannot restore observation.', observationRecovery(ctx))
        if (attachment.state !== 'ready') fail('AGENT_DESKTOP_NOT_READY', 'The original attachment is not ready. Read its state and resolve the reported condition.', {
          kind: attachment.state === 'preparing' ? 'wait' : 'user_action',
          tool: 'termous.desktops.get', arguments: { attachment_id: id, wait_ms: 10000 },
        })
        return attachment
      }
    } catch (error) {
      if (staleAttachment(error) && cached?.id === id) ctx.forget('desktop:attachment')
      // 只重建隐式观察缓存；显式旧 ID、截图及输入失败必须返回给模型重新判断。
      if (explicit || !observationTools.has(ctx.name) || !staleAttachment(error)) throw error
    }
  }
  if (ctx.name === 'termous.desktops.detach' || ctx.name === 'termous.desktops.control.release') {
    fail('AGENT_TARGET_SELECTION_REQUIRED', 'Choose the original attachment to release; no new attachment will be created.')
  }
  const target = hasHostDesktopTarget(ctx, selected) ? { target: await hostDesktopTarget(ctx, selected) } : await (async () => {
    const session = await desktopSession(ctx, selected, true)
    return { session_id: session.id, connection_generation: session.connection_generation }
  })()
  let attachment = item((await ctx.invoke('termous.desktops.attach', target, 'desktop_attach')).attachment, 'attachment')
  const attachmentID = attachment.id
  if (!attachmentMatches(ctx, target, attachment)) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The new attachment receipt does not match the verified target.', 'user_action')
  if (attachment.state !== 'ready') attachment = item((await ctx.invoke('termous.desktops.get', { attachment_id: attachment.id, wait_ms: 10000 }, 'attachment_get')).attachment, 'attachment')
  if (attachment.id !== attachmentID || !attachmentMatches(ctx, target, attachment)) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The attachment query does not match the verified target.', 'user_action')
  if (attachment.state !== 'ready') fail('AGENT_DESKTOP_NOT_READY', 'Desktop observation is not ready; inspect the original attachment and resolve its reported condition.', {
    kind: attachment.state === 'preparing' ? 'wait' : 'user_action', tool: 'termous.desktops.get', arguments: { attachment_id: attachment.id, wait_ms: 10000 },
  })
  ctx.desktop?.observe('termous.desktops.attach', target, { attachment })
  return attachment
}

export function observeDesktop(ctx: PreparationContext, args: Arguments, output: Arguments) {
  if (!ctx.name.startsWith('termous.desktops.')) return
  if (isRecord(output.capture) && typeof output.capture.screenshot_id === 'string') ctx.remember(`capture:${output.capture.screenshot_id}`, { attachment_id: args.attachment_id })
  if (isRecord(output.attachment) && typeof output.attachment.id === 'string'
    && (ctx.name === 'termous.desktops.attach' ? attachmentMatches(ctx, args, output.attachment) : output.attachment.id === args.attachment_id)) {
    const previous = ctx.read('desktop:attachment')
    // 未就绪和失败态仍属于原附着；保留身份供查询，避免每次观察都新建执行端。
    ctx.remember('desktop:attachment', { ...(previous?.id === output.attachment.id ? previous : {}), ...output.attachment, grant: undefined })
  }
  const cached = ctx.read('desktop:attachment')
  if (output.completed && (ctx.name === 'termous.desktops.detach' && args.attachment_id === cached?.id
    || ctx.name === 'termous.desktops.close' && args.session_id === cached?.session_id)) ctx.forget('desktop:attachment')
}
