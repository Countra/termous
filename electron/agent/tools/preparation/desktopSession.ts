import { delay, fail, item, rows, unique, type Arguments, type PreparationContext } from './contracts.ts'
import { hasHostDesktopTarget } from './hostDesktop.ts'
import { desktopSelection } from './desktopSelection.ts'
import { observationTarget } from '../../contracts/desktopObservation.ts'

export async function desktopSession(ctx: PreparationContext, args: Arguments, connect: boolean): Promise<Arguments> {
  args = desktopSelection(ctx, args)
  if (args.target !== undefined) {
    const target = observationTarget(args.target)
    if (target?.kind !== 'protocol_session' || args.session_id !== undefined || args.profile_id !== undefined) {
      fail('AGENT_RESOURCE_BINDING_MISMATCH', 'Use one exact host or protocol target; do not mix target selectors.', 'correct_parameters')
    }
    args = { ...args, session_id: target.session_id, connection_generation: target.connection_generation }
  }
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
      fail('AGENT_DESKTOP_NOT_READY', 'The selected desktop is not ready. Inspect this original session with termous.desktops.get and resolve its reported state.', {
        kind: session.user_action_required || ['failed', 'closed', 'disconnected'].includes(String(session.status)) ? 'user_action' : 'wait',
        tool: 'termous.desktops.get', arguments: { session_id: id, wait_ms: 10000 },
      }, { session_id: id, state: session.status })
    }
    await delay(ctx.signal)
    session = item((await ctx.invoke('termous.desktops.get', { session_id: id, wait_ms: 10000 }, 'desktop_get')).session, 'session')
  }
  if (session.id !== id || args.connection_generation !== undefined && session.connection_generation !== args.connection_generation
    || binding?.kind === 'desktop_session' && session.connection_generation !== binding.connection_generation) {
    fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The bound desktop generation changed. Select the current desktop again.', 'user_action')
  }
  if (profile !== undefined && session.profile_id !== profile) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The desktop does not match the selected Profile.')
  ctx.remember(`desktop:session:${String(session.id)}`, { id: session.id, profile_id: session.profile_id, connection_generation: session.connection_generation })
  return session
}
