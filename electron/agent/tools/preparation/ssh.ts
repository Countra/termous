import { defaultValue, delay, fail, item, rows, unique, type Arguments, type PreparationContext } from './contracts.ts'

export async function prepareSSH(ctx: PreparationContext, args: Arguments) {
  const binding = ctx.bindings.find((v) => v.kind === 'ssh_session' || v.kind === 'ssh_profile')
  if (ctx.name === 'termous.sessions.connect') {
    if (args.ssh_profile_id === undefined && args.host_id === undefined && binding) args.ssh_profile_id = binding.ssh_profile_id
    return
  }
  if (!ctx.has('session_id') && !ctx.has('session_ids')) return
  // 转发的显式 Profile 是业务选择，不能被隐式会话覆盖。
  if (ctx.name === 'termous.forwarding.instances.start' && (args.profile_id !== undefined || args.ssh_profile_id !== undefined || args.host_id !== undefined)) return
  let ids = ctx.has('session_ids') ? args.session_ids : args.session_id === undefined ? undefined : [args.session_id]
  if (ids === undefined && binding?.kind === 'ssh_session') ids = [binding.session_id]
  if (ids === undefined) {
    const list = await ctx.invoke('termous.sessions.list', {}, 'ssh_list')
    const candidates = rows(list.sessions).filter((v) => !binding || v.ssh_profile_id === binding.ssh_profile_id && v.host_id === binding.host_id)
      .filter((v) => v.status === 'connected' || v.status === 'connecting')
    if (candidates.length === 0 && binding?.kind === 'ssh_profile' && !ctx.name.endsWith('.close')) {
      const output = await ctx.invoke('termous.sessions.connect', { ssh_profile_id: binding.ssh_profile_id }, 'ssh_connect')
      ids = [item(output.session, 'session').id]
    } else ids = [unique(candidates, 'session_id').id]
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string')) fail('AGENT_PARAMETER_INVALID', 'session_ids must contain explicit session identifiers.')
  if (binding && ids.length !== 1) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'This run is bound to exactly one SSH target.')
  // 显式会话仍须经当前 Profile 列表核验，不能绕过底层绑定校验。
  if (binding?.kind === 'ssh_profile' && (args.session_id !== undefined || args.session_ids !== undefined)) {
    const listed = rows((await ctx.invoke('termous.sessions.list', {}, 'ssh_verify')).sessions)
    if (ids.some((id) => !listed.some((v) => v.id === id && v.ssh_profile_id === binding.ssh_profile_id && v.host_id === binding.host_id))) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The selected session does not belong to the bound Profile.')
  }
  if (ctx.name !== 'termous.sessions.get' && ctx.name !== 'termous.sessions.close') {
    for (const [index, id] of ids.entries()) {
      const deadline = Date.now() + 60_000
      for (;;) {
        const session = item((await ctx.invoke('termous.sessions.get', { session_id: id }, `ssh_get_${index}`)).session, 'session')
        if (session.id !== id || binding && (session.ssh_profile_id !== binding.ssh_profile_id || session.host_id !== binding.host_id)) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The SSH receipt does not match the bound target.')
        if (session.status === 'connected' && session.phase === 'ready') break
        if (session.status !== 'connecting' || Date.now() >= deadline) fail('AGENT_SSH_NOT_READY', 'The selected SSH session is not ready; inspect termous.sessions.get for this original session and resolve its state.', {
          kind: session.status === 'connecting' ? 'wait' : 'user_action', tool: 'termous.sessions.get', arguments: { session_id: id },
        }, { session_id: id, state: session.status })
        await delay(ctx.signal)
      }
    }
  }
  defaultValue(args, ctx.has('session_ids') ? 'session_ids' : 'session_id', ctx.has('session_ids') ? ids : ids[0])
}
