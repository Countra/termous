import { AgentQuery_Kind as Q, AgentSessionCommand_Action as S, AgentGroupCommand_Action as G, AgentResourceCommand_Action as R } from '@termous/remote-protocol/agent'
import type { AgentResourceReference, AgentSessionMoveInput } from '#entities/agent'
import {
  decodeAgentSession, decodeAgentSessionPage, decodeAgentSessionGroup, decodeAgentSessionGroups,
  decodeAgentSessionMoveResult, decodeAgentSessionPins, decodeAgentMessagePage, decodeAgentSessionContext,
  decodeAgentSessionUsage, decodeAgentResourceRecoveryView, decodeAgentResourceConnectionView,
  type AgentWorkspaceGateway,
} from '#features/agent-runtime'
import { RemoteAgentTransport, revision } from './agentTransport.ts'

export function reference(value?: AgentResourceReference) {
  if (!value) return undefined
  return { kind: value.kind, sessionId: value.kind === 'ssh_session' ? value.session_id : undefined,
    sshProfileId: value.kind === 'ssh_profile' ? value.ssh_profile_id : undefined,
    fileAccessProfileId: value.kind === 'file_profile' ? value.file_access_profile_id : undefined }
}
const move = (input: AgentSessionMoveInput) => ({ expectedRevision: revision(input.expected_revision), targetId: input.target_id, targetRevision: revision(input.target_expected_revision), placement: input.placement })

export function agentSessions(t: RemoteAgentTransport) {
  return {
    sessions: (options = {}) => t.query('sessions', Q.SESSIONS, { cursor: options.cursor, search: options.query, archived: options.archived, limit: options.limit ?? 100 }, options.signal).then(decodeAgentSessionPage),
    session: (id, signal) => t.query('session', Q.SESSION, { id }, signal).then(decodeAgentSession),
    createSession: (input, signal) => t.write('session', { case: 'session', value: { action: S.CREATE, title: input.title, groupId: input.group_id, modelId: input.model_id, reasoningLevel: input.reasoning_level, resource: reference(input.resource_reference) } }, signal).then(decodeAgentSession),
    updateSession: (id, input, signal) => t.write('session', { case: 'session', value: { action: S.UPDATE, id, title: input.title, modelId: input.model_id, reasoningLevel: input.reasoning_level, archived: input.archived, expectedRevision: revision(input.expected_revision) } }, signal).then(decodeAgentSession),
    updateSessionMetadata: (id, input, signal) => t.write('session', { case: 'session', value: { action: S.METADATA, id, title: input.title, groupId: input.group_id, pinned: input.pinned, archived: input.archived, expectedRevision: revision(input.expected_revision) } }, signal).then(decodeAgentSession),
    deleteSession: async (id, expectedRevision, signal) => { await t.write('empty', { case: 'session', value: { action: S.DELETE, id, expectedRevision: revision(expectedRevision) } }, signal) },
    moveSession: (id, input, signal) => t.write('session_order', { case: 'session', value: { action: S.MOVE, id, ...move(input) } }, signal).then(items => decodeAgentSessionMoveResult({ items })),
    moveSessionPin: (id, input, signal) => t.write('session_order', { case: 'session', value: { action: S.MOVE_PIN, id, ...move(input) } }, signal).then(items => decodeAgentSessionPins({ items })),
    sessionGroups: signal => t.query('groups', Q.GROUPS, {}, signal).then(items => decodeAgentSessionGroups({ items })),
    createSessionGroup: (name, signal) => t.write('group', { case: 'group', value: { action: G.CREATE, name } }, signal).then(decodeAgentSessionGroup),
    updateSessionGroup: (id, input, signal) => t.write('group', { case: 'group', value: { action: G.UPDATE, id, name: input.name, expectedRevision: revision(input.expected_revision) } }, signal).then(decodeAgentSessionGroup),
    deleteSessionGroup: async (id, expectedRevision, signal) => { await t.write('empty', { case: 'group', value: { action: G.DELETE, id, expectedRevision: revision(expectedRevision) } }, signal) },
    moveSessionGroup: (id, input, signal) => t.write('groups', { case: 'group', value: { action: G.MOVE, id, ...move(input) } }, signal).then(items => decodeAgentSessionGroups({ items })),
    messages: (id, options = {}) => t.query('messages', Q.MESSAGES, { id, afterSequence: revision(options.afterSequence ?? 0), limit: options.limit ?? 100 }, options.signal).then(decodeAgentMessagePage),
    context: (id, signal) => t.query('context', Q.CONTEXT, { id }, signal).then(decodeAgentSessionContext),
    usage: (id, signal) => t.query('usage', Q.USAGE, { id }, signal).then(decodeAgentSessionUsage),
    replaceResourceBinding: (sessionId, input, signal) => t.write('session', { case: 'resource', value: { action: R.BIND, sessionId, expectedRevision: revision(input.expected_revision), reference: reference(input) } }, signal).then(decodeAgentSession),
    removeResourceBinding: (sessionId, expectedRevision, kind = 'ssh_session', signal) => t.write('session', { case: 'resource', value: { action: R.UNBIND, sessionId, expectedRevision: revision(expectedRevision), reference: { kind } } }, signal).then(decodeAgentSession),
    recoverResourceBinding: (sessionId, input, signal) => t.write('resource_recovery', { case: 'resource', value: { action: R.RECOVER, sessionId, expectedRevision: revision(input.expected_revision), reference: { kind: input.kind } } }, signal, input.client_request_id).then(v => decodeAgentResourceRecoveryView(v, sessionId)),
    resourceBindingRecovery: (sessionId, signal) => t.call('resource_recovery', { case: 'resource', value: { action: R.RECOVERY, sessionId, reference: { kind: 'ssh_session' } } }, signal).then(v => decodeAgentResourceRecoveryView(v, sessionId)),
    cancelResourceBindingRecovery: (sessionId, operationId, signal) => t.write('resource_recovery', { case: 'resource', value: { action: R.CANCEL_RECOVERY, sessionId, operationId } }, signal).then(v => decodeAgentResourceRecoveryView(v, sessionId)),
    connectResourceBinding: (sessionId, input, signal) => t.write('resource_connection', { case: 'resource', value: { action: R.CONNECT, sessionId, expectedRevision: revision(input.expected_revision), expectedInstanceId: input.expected_instance_id, reference: { kind: input.kind, sshProfileId: input.ssh_profile_id } } }, signal, input.client_request_id).then(v => decodeAgentResourceConnectionView(v, sessionId)),
    resourceBindingConnection: (sessionId, operationId, signal) => t.call('resource_connection', { case: 'resource', value: { action: R.CONNECTION, sessionId, operationId } }, signal).then(v => decodeAgentResourceConnectionView(v, sessionId)),
    cancelResourceBindingConnection: (sessionId, operationId, signal) => t.write('resource_connection', { case: 'resource', value: { action: R.CANCEL_CONNECTION, sessionId, operationId } }, signal).then(v => decodeAgentResourceConnectionView(v, sessionId)),
  } satisfies Pick<AgentWorkspaceGateway, 'sessions' | 'session' | 'createSession' | 'updateSession' | 'updateSessionMetadata' | 'deleteSession' | 'moveSession' | 'moveSessionPin' | 'sessionGroups' | 'createSessionGroup' | 'updateSessionGroup' | 'deleteSessionGroup' | 'moveSessionGroup' | 'messages' | 'context' | 'usage' | 'replaceResourceBinding' | 'removeResourceBinding' | 'recoverResourceBinding' | 'resourceBindingRecovery' | 'cancelResourceBindingRecovery' | 'connectResourceBinding' | 'resourceBindingConnection' | 'cancelResourceBindingConnection'>
}
