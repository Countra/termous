import { defaultValue, delay, fail, item, rows, unique, type Arguments, type PreparationContext } from './contracts.ts'

async function fileSession(ctx: PreparationContext, id: unknown, step: string, requireReady = true): Promise<Arguments> {
  let session = item((await ctx.invoke('termous.files.sessions.get', { file_session_id: id }, step)).session, 'session')
  const deadline = Date.now() + 60_000
  while (requireReady && session.status === 'connecting' && Date.now() < deadline) {
    await delay(ctx.signal)
    session = item((await ctx.invoke('termous.files.sessions.get', { file_session_id: id }, step)).session, 'session')
  }
  if (session.id !== id || session.owned_by_client !== true || requireReady && session.status !== 'connected' || !Number.isSafeInteger(session.connection_generation) || Number(session.connection_generation) <= 0) {
    fail('AGENT_FILE_SESSION_NOT_READY', 'A connected file session owned by this caller is required.', 'user_action')
  }
  return session
}

export async function prepareFiles(ctx: PreparationContext, args: Arguments) {
  const bindings = ctx.bindings.filter((v) => v.kind === 'file_profile')
  const binding = bindings.length === 1 ? bindings[0] : undefined
  if (ctx.name === 'termous.files.sessions.connect') {
    if (args.file_access_profile_id === undefined && args.host_id === undefined && binding) args.file_access_profile_id = binding.file_access_profile_id
    return
  }
  if (ctx.has('source_connection_generation')) {
    for (const side of ['source', 'target']) {
      const session = await fileSession(ctx, args[`${side}_file_session_id`], `file_${side}`)
      defaultValue(args, `${side}_connection_generation`, session.connection_generation)
    }
  }
  if (!ctx.has('file_session_id')) return
  const lifecycle = ['termous.files.sessions.get', 'termous.files.sessions.close', 'termous.files.sessions.reconnect'].includes(ctx.name)
  let id = args.file_session_id
  if (id === undefined) {
    const output = await ctx.invoke('termous.files.sessions.list', {}, 'file_list')
    const candidates = rows(output.sessions).filter((v) => v.owned_by_client === true && (lifecycle || ['connected', 'connecting'].includes(String(v.status))) && (!binding || v.file_access_profile_id === binding.file_access_profile_id))
    if (candidates.length === 0 && binding && !lifecycle) {
      const connected = await ctx.invoke('termous.files.sessions.connect', { file_access_profile_id: binding.file_access_profile_id }, 'file_connect')
      id = item(connected.session, 'session').id
    } else id = unique(candidates, 'file_session_id').id
  }
  if (ctx.name !== 'termous.files.sessions.get' && ctx.name !== 'termous.files.sessions.close') {
    const session = await fileSession(ctx, id, 'file_get', !lifecycle)
    if (binding && session.file_access_profile_id !== binding.file_access_profile_id) fail('AGENT_RESOURCE_BINDING_MISMATCH', 'The file session belongs to another Profile.')
    if (ctx.has('expected_connection_generation')) defaultValue(args, 'expected_connection_generation', session.connection_generation)
  }
  defaultValue(args, 'file_session_id', id)
}
