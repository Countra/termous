import { isRecord } from '../../contracts/validation.ts'
import { defaultValue, fail, item, type Arguments, type PreparationContext } from './contracts.ts'
import { desktopSession, prepareDesktop } from './desktop.ts'

export async function prepareWorkflow(ctx: PreparationContext, args: Arguments) {
  if (ctx.name !== 'termous.desktop_workflows.runs.start') {
    if (ctx.has('attachment_id')) await prepareDesktop(ctx, args)
    return
  }
  const workflow = ctx.bindings.find((v) => v.kind === 'desktop_workflow')
  if (workflow?.kind === 'desktop_workflow') {
    defaultValue(args, 'script_id', workflow.workflow_id)
    defaultValue(args, 'version', workflow.workflow_version)
  }
  if (typeof args.script_id !== 'string') fail('AGENT_TARGET_SELECTION_REQUIRED', 'Choose script_id before starting the workflow.')
  if (args.version === undefined) {
    let snapshot = ctx.read(`workflow:${args.script_id}`)
    if (!snapshot) {
      const read = await ctx.invoke('termous.desktop_workflows.get', { script_id: args.script_id }, 'workflow_read')
      const detail = item(read.detail, 'detail')
      const version = item(detail.version, 'version')
      snapshot = { version: version.number }
    }
    defaultValue(args, 'version', snapshot.version)
  }
  const session = await desktopSession(ctx, args, true)
  // 固定为本次已经核验的会话；Core 在审批后再次验证连接代次。
  delete args.profile_id
  defaultValue(args, 'session_id', session.id)
  defaultValue(args, 'connection_generation', session.connection_generation)
}

export function observeWorkflow(ctx: PreparationContext, output: Arguments) {
  if (!ctx.name.startsWith('termous.desktop_workflows.')) return
  const detail = isRecord(output.detail) ? output.detail : undefined
  const script = detail ? detail.script : output.script
  if (!isRecord(script) || typeof script.id !== 'string') return
  const version = detail && isRecord(detail.version) ? detail.version.number : script.revision
  ctx.remember(`workflow:${script.id}`, { version, expected_revision: script.revision })
}
