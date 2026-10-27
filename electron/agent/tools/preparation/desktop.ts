import { defaultValue, fail, item, type Arguments, type PreparationContext } from './contracts.ts'
import { hasHostDesktopTarget, hostDesktopTarget } from './hostDesktop.ts'
import { desktopSession } from './desktopSession.ts'
import { desktopAttachment } from './desktopObservation.ts'
import { attachmentMatches, desktopSelection } from './desktopSelection.ts'
import { controlGrant } from './desktopControl.ts'
import { observationRecovery } from '../recovery/preparation.ts'
export { desktopSession } from './desktopSession.ts'
export { desktopAttachment, observeDesktop } from './desktopObservation.ts'

export async function prepareDesktop(ctx: PreparationContext, args: Arguments) {
  if (ctx.name === 'termous.desktops.connect') {
    if (hasHostDesktopTarget(ctx, args)) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'Host desktop access does not create a protocol connection.', 'user_action')
    if (args.profile_id === undefined && args.host_id === undefined) {
      const bindings = ctx.bindings.filter((v) => v.kind === 'desktop_profile')
      if (bindings.length === 1) args.profile_id = bindings[0].desktop_profile_id
    }
    return
  }
  if (ctx.name === 'termous.desktops.attach' || ctx.name === 'termous.desktops.close') {
    const selected = desktopSelection(ctx, args)
    if (ctx.name.endsWith('.attach') && hasHostDesktopTarget(ctx, selected)) {
      args.target = await hostDesktopTarget(ctx, selected)
      return
    }
    const session = await desktopSession(ctx, selected, ctx.name.endsWith('.attach'))
    if (ctx.name.endsWith('.attach')) delete args.target
    defaultValue(args, 'session_id', session.id)
    defaultValue(args, 'connection_generation', session.connection_generation)
    return
  }
  if (ctx.name === 'termous.desktops.get') {
    if (args.attachment_id === undefined && args.session_id === undefined) {
      const binding = ctx.bindings.find((v) => v.kind === 'desktop_session')
      if (binding?.kind === 'desktop_session') args.session_id = binding.session_id
      else {
        const cached = ctx.read('desktop:attachment')
        if (cached && attachmentMatches(ctx, args, cached)) args.attachment_id = cached.id
      }
      if (args.session_id === undefined && args.attachment_id === undefined) {
        if (hasHostDesktopTarget(ctx, desktopSelection(ctx, args))) fail('AGENT_OBSERVATION_REQUIRED', 'get only reads an existing attachment. Use termous.desktops.capture({}) to prepare observation of the selected host desktop.', observationRecovery(ctx))
        args.session_id = (await desktopSession(ctx, args, false)).id
      }
    }
    return
  }
  if (!ctx.has('attachment_id')) return
  const attachment = await desktopAttachment(ctx, args)
  defaultValue(args, 'attachment_id', attachment.id)
  if (ctx.has('grant_id')) {
    const grant = ctx.name.endsWith('.release') ? item(attachment.grant, 'grant') : await controlGrant(ctx, attachment)
    defaultValue(args, 'grant_id', grant.id)
  }
}
