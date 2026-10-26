import { isRecord } from '../../contracts/validation.ts'
import { defaultValue, delay, fail, item, rows, unique, type Arguments, type PreparationContext } from './contracts.ts'
import { hasHostDesktopTarget, hostDesktopTarget } from './hostDesktop.ts'

export async function desktopSession(ctx: PreparationContext, args: Arguments, connect: boolean): Promise<Arguments> {
  if (hasHostDesktopTarget(ctx, args)) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'A host desktop has no protocol connection. Use its exact target to attach.', 'user_action')
  const bindings = ctx.bindings.filter((v) => v.kind === 'desktop_session' || v.kind === 'desktop_profile')
  if (bindings.length > 1 && args.session_id === undefined && args.profile_id === undefined) fail('AGENT_TARGET_SELECTION_REQUIRED', 'Select one desktop target.')
  const binding = bindings[0]
  let id = args.session_id
  const profile = args.profile_id ?? binding?.desktop_profile_id
  if (id === undefined && binding?.kind === 'desktop_session') id = binding.session_id
  if (id === undefined) {
    const list = await ctx.invoke('termous.desktops.list', {}, 'desktop_list')
    const candidates = rows(list.sessions).filter((v) => profile === undefined || v.profile_id === profile)
      .filter((v) => ['ready', 'streaming', 'connecting'].includes(String(v.status)))
    if (candidates.length === 0 && profile !== undefined && connect) {
      const result = await ctx.invoke('termous.desktops.connect', { profile_id: profile }, 'desktop_connect')
      id = item(result.session, 'session').id
    } else id = unique(candidates, 'session_id').id
  }
  let session = item((await ctx.invoke('termous.desktops.get', { session_id: id, wait_ms: 10000 }, 'desktop_get')).session, 'session')
  const deadline = Date.now() + 60_000
  while (!['ready', 'streaming'].includes(String(session.status))) {
    if (session.user_action_required === true || ['failed', 'closed', 'disconnected'].includes(String(session.status)) || Date.now() >= deadline) {
      fail('AGENT_DESKTOP_NOT_READY', 'The selected desktop is not ready. Continue with this session after resolving its state.', session.user_action_required ? 'user_action' : 'wait', { session_id: id, state: session.status })
    }
    await delay(ctx.signal)
    session = item((await ctx.invoke('termous.desktops.get', { session_id: id, wait_ms: 10000 }, 'desktop_get')).session, 'session')
  }
  if (session.id !== id || binding?.kind === 'desktop_session' && session.connection_generation !== binding.connection_generation) {
    fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The bound desktop generation changed. Select the current desktop again.', 'user_action')
  }
  if (profile !== undefined && session.profile_id !== profile) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The desktop does not match the selected Profile.')
  return session
}

export async function desktopAttachment(ctx: PreparationContext, args: Arguments): Promise<Arguments> {
  let id = args.attachment_id
  if (id === undefined && typeof args.screenshot_id === 'string') {
    id = ctx.read(`capture:${args.screenshot_id}`)?.attachment_id
    if (!id) fail('AGENT_OBSERVATION_REQUIRED', 'Observe the current desktop and locate the target again; this screenshot is not registered in the current execution.', 'reread')
  }
  if (id === undefined) id = ctx.read('desktop:attachment')?.id
  if (id !== undefined) {
    const receipt = await ctx.invoke('termous.desktops.get', { attachment_id: id, wait_ms: 10000 }, 'attachment_get')
    const attachment = item(receipt.attachment, 'attachment')
    if (attachment.id !== id || attachment.state !== 'ready') fail('AGENT_DESKTOP_NOT_READY', 'The original attachment is not ready. Read its current state before continuing.', 'reread')
    return attachment
  }
  if (ctx.name === 'termous.desktops.detach' || ctx.name === 'termous.desktops.control.release') fail('AGENT_TARGET_SELECTION_REQUIRED', 'Choose the original attachment to release; no new attachment will be created.')
  const target = hasHostDesktopTarget(ctx, args) ? { target: await hostDesktopTarget(ctx, args) } : await (async () => {
    const session = await desktopSession(ctx, args, true)
    return { session_id: session.id, connection_generation: session.connection_generation }
  })()
  let attachment = item((await ctx.invoke('termous.desktops.attach', target, 'desktop_attach')).attachment, 'attachment')
  if (attachment.state !== 'ready') attachment = item((await ctx.invoke('termous.desktops.get', { attachment_id: attachment.id, wait_ms: 10000 }, 'attachment_get')).attachment, 'attachment')
  if (attachment.state !== 'ready') fail('AGENT_DESKTOP_NOT_READY', 'Desktop observation is still preparing.', 'wait')
  ctx.remember('desktop:attachment', { id: attachment.id })
  return attachment
}

async function controlGrant(ctx: PreparationContext, attachment: Arguments): Promise<Arguments> {
  if (isRecord(attachment.grant) && Date.parse(String(attachment.grant.expires_at)) > Date.now() && Date.parse(String(attachment.grant.idle_expires_at)) > Date.now()) return attachment.grant
  const deadline = Date.now() + 5 * 60_000
  for (;;) {
    const result = await ctx.invoke('termous.desktops.control.acquire', { attachment_id: attachment.id }, 'desktop_control')
    const control = item(result.control, 'control')
    if (isRecord(control.attachment) && isRecord(control.attachment.grant)) return control.attachment.grant
    const approval = isRecord(control.approval) ? control.approval : undefined
    if (approval && ['rejected', 'expired', 'cancelled'].includes(String(approval.state))) {
      fail('AGENT_CONTROL_APPROVAL_STOPPED', 'Control approval ended without permission. Stop control requests in this execution; observation and original-result queries remain available.', 'user_action', { approval_id: approval.id, state: approval.state })
    }
    if (approval?.state === 'dispatch_conflict') {
      fail(typeof approval.error_code === 'string' && approval.error_code ? approval.error_code : 'AGENT_CONTROL_ACQUISITION_FAILED',
        typeof approval.error_message === 'string' && approval.error_message ? approval.error_message : 'Control acquisition failed after approval.',
        'user_action', { approval_id: approval.id, state: approval.state })
    }
    if (approval?.state === 'approved') {
      fail('AGENT_CONTROL_GRANT_UNAVAILABLE', 'The approval has completed but its control grant is no longer available. Read the current attachment; this approval cannot be approved again.', 'reread', { approval_id: approval.id, state: approval.state })
    }
    if (!approval || !['pending', 'dispatching'].includes(String(approval.state))) {
      fail('AGENT_TOOL_RESPONSE_INVALID', 'The control request returned no valid approval state.', 'user_action')
    }
    if (Date.now() >= deadline) {
      fail('AGENT_CONTROL_APPROVAL_REQUIRED', 'Control is not granted. Resolve the existing approval; do not submit another request.', 'approval', { approval_id: approval.id, state: approval.state })
    }
    await delay(ctx.signal)
  }
}

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
    if (ctx.name.endsWith('.attach') && hasHostDesktopTarget(ctx, args)) {
      defaultValue(args, 'target', await hostDesktopTarget(ctx, args))
      return
    }
    const session = await desktopSession(ctx, args, ctx.name.endsWith('.attach'))
    defaultValue(args, 'session_id', session.id)
    defaultValue(args, 'connection_generation', session.connection_generation)
    return
  }
  if (ctx.name === 'termous.desktops.get') {
    if (args.attachment_id === undefined && args.session_id === undefined) {
      const binding = ctx.bindings.find((v) => v.kind === 'desktop_session')
      if (binding?.kind === 'desktop_session') args.session_id = binding.session_id
      else args.attachment_id = ctx.read('desktop:attachment')?.id
      if (args.session_id === undefined && args.attachment_id === undefined) {
        if (hasHostDesktopTarget(ctx, args)) fail('AGENT_OBSERVATION_REQUIRED', 'Capture or attach the selected host desktop before querying its attachment.', 'reread')
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

export function observeDesktop(ctx: PreparationContext, args: Arguments, output: Arguments) {
  if (!ctx.name.startsWith('termous.desktops.')) return
  if (isRecord(output.capture) && typeof output.capture.screenshot_id === 'string') ctx.remember(`capture:${output.capture.screenshot_id}`, { attachment_id: args.attachment_id })
  if (isRecord(output.attachment) && output.attachment.state === 'ready') ctx.remember('desktop:attachment', { id: output.attachment.id })
  if (ctx.name === 'termous.desktops.detach' && output.completed) ctx.forget('desktop:attachment')
}
