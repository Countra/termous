import { AgentQuery_Kind as Q, AgentRunCommand_Action as R, AgentQueueCommand_Action as C } from '@termous/remote-protocol/agent'
import { decodeAgentRun, decodeAgentRunEventPage, decodeAgentQueuedTurnPage, decodeAgentQueuedTurn, decodeAgentQueuedTurnMoveResult, decodeAgentQueueState, decodeAgentWorkspaceEvent, type AgentWorkspaceGateway } from '#features/agent-runtime'
import { decodeAgentReadiness } from '#features/agent-setup'
import { RemoteError } from '#entities/remote-control'
import type { AgentRuntimeStatus } from '#common/contracts'
import { RemoteAgentTransport, object, revision } from './agentTransport.ts'

export function agentRuns(t: RemoteAgentTransport) {
  const status = async (): Promise<AgentRuntimeStatus> => {
    const snapshot = decodeAgentWorkspaceEvent(await t.query('workspace', Q.WORKSPACE))
    if (snapshot.type !== 'snapshot') throw new RemoteError('remote_invalid')
    const readiness = decodeAgentReadiness(await t.query('readiness', Q.STATUS))
    return { state: readiness.status === 'ready' ? 'ready' : 'offline',
      capacity: readiness.settings.max_concurrent_runs,
      occupied_slots: snapshot.active_runs.length,
      workers: snapshot.active_runs.map((run) => ({ state: run.status === 'stopping' ? 'stopping' : run.status === 'queued' ? 'starting' : 'running',
        run_id: run.id, generation: run.generation, session_id: run.session_id })) }

  }
  const command = async (value: unknown) => {
    const result = object(value)
    if (typeof result.accepted !== 'boolean' || result.error_code !== undefined && typeof result.error_code !== 'string') throw new RemoteError('remote_invalid')
    return { accepted: result.accepted, error_code: result.error_code, status: await status() }
  }
  const prompt = async (text: string) => {
    const bytes = new TextEncoder().encode(text)
    if (bytes.length > 1 << 20) throw new RemoteError('remote_invalid')
    if (bytes.length <= 24 << 10) return { prompt: text }
    const uploaded = await t.client.agentUpload(bytes, 'text/plain')
    return { promptContentId: uploaded.id }
  }
  return {
    runtimeOwnedByHost: true,
    createRun: async (sessionId, input, signal) => {
      const value = await t.write('run_command', { case: 'run', value: { action: R.CREATE, sessionId, ...await prompt(input.prompt), attachmentIds: input.attachment_ids, forceContextCompression: input.force_context_compression } }, signal, input.client_request_id)
      return decodeAgentRun(object(value).run)
    },
    run: (id, signal) => t.query('run', Q.RUN, { id }, signal).then(decodeAgentRun),
    stopRun: async (id, expectedRevision, generation, signal) => {
      const value = await t.write('run_command', { case: 'run', value: { action: R.STOP, id, expectedRevision: revision(expectedRevision), generation: revision(generation) } }, signal)
      return decodeAgentRun(object(value).run)
    },
    runEvents: (id, options) => t.query('run_events', Q.RUN_EVENTS, { id, generation: revision(options.generation), afterSequence: revision(options.afterSequence ?? 0), limit: options.limit ?? 100 }, options.signal).then(decodeAgentRunEventPage),
    queuedTurns: (id, options = {}) => t.query('queue', Q.QUEUE, { id, cursor: options.cursor, limit: options.limit ?? 100 }, options.signal).then(decodeAgentQueuedTurnPage),
    enqueueTurn: async (sessionId, input, signal) => t.write('queued_turn', { case: 'queue', value: { action: C.CREATE, sessionId, ...await prompt(input.prompt), attachmentIds: input.attachment_ids, forceContextCompression: input.force_context_compression } }, signal, input.client_request_id).then(decodeAgentQueuedTurn),
    beginQueuedTurnEdit: (id, expectedRevision, signal) => t.write('queued_turn', { case: 'queue', value: { action: C.BEGIN_EDIT, id, expectedRevision: revision(expectedRevision) } }, signal).then(decodeAgentQueuedTurn),
    updateQueuedTurn: async (id, input, signal) => t.write('queued_turn', { case: 'queue', value: { action: C.UPDATE, id, ...await prompt(input.prompt), attachmentIds: input.attachment_ids, expectedRevision: revision(input.expected_revision) } }, signal).then(decodeAgentQueuedTurn),
    cancelQueuedTurnEdit: (id, expectedRevision, signal) => t.write('queued_turn', { case: 'queue', value: { action: C.CANCEL_EDIT, id, expectedRevision: revision(expectedRevision) } }, signal).then(decodeAgentQueuedTurn),
    deleteQueuedTurn: (id, expectedRevision, signal) => t.write('queued_turn', { case: 'queue', value: { action: C.DELETE, id, expectedRevision: revision(expectedRevision) } }, signal).then(decodeAgentQueuedTurn),
    moveQueuedTurn: (id, input, signal) => t.write('queue_order', { case: 'queue', value: { action: C.MOVE, id, expectedRevision: revision(input.expected_revision), targetId: input.target_turn_id, targetRevision: revision(input.target_expected_revision), placement: input.placement } }, signal).then(decodeAgentQueuedTurnMoveResult),
    steerQueuedTurn: async input => {
      const value = await t.write('queue_steer', { case: 'queue', value: { action: C.STEER, id: input.turn_id, expectedRevision: revision(input.turn_revision), runId: input.run_id, generation: revision(input.run_generation), runRevision: revision(input.run_revision) } })
      const pending = object(value).pending
      return pending ? { accepted: true, status: await status() } : command(object(value).runtime)
    },
    resumeQueue: (sessionId, expectedRevision, signal) => t.write('queue_state', { case: 'queue', value: { action: C.RESUME, sessionId, expectedRevision: revision(expectedRevision) } }, signal).then(decodeAgentQueueState),
    wakeQueue: () => t.write('runtime', { case: 'run', value: { action: R.WAKE } }).then(command),
    runtimeStatus: status,
    startRuntime: async () => { throw new RemoteError('remote_operation_unsupported') },
    stopRuntime: async () => { throw new RemoteError('remote_operation_unsupported') },
    steerRuntime: async (run, text) => {
      const current = decodeAgentRun(await t.query('run', Q.RUN, { id: run.id }))
      return t.write('runtime', { case: 'run', value: { action: R.STEER, id: run.id, generation: revision(run.generation), expectedRevision: revision(current.revision), ...await prompt(text) } }).then(command)
    },
    onRuntimeStatus: callback => {
      let active = true
      let pending = false
      const refresh = () => {
        if (pending || !active) return
        pending = true
        void status().then(value => { if (active) callback(value) }, () => { if (active) callback({ state: 'offline' }) }).finally(() => { pending = false })
      }
      const stop = t.client.onEvent(event => { if (event.value.case === 'agent') refresh() })
      refresh()
      return () => { active = false; stop() }
    },
  } satisfies Pick<AgentWorkspaceGateway, 'runtimeOwnedByHost' | 'createRun' | 'run' | 'stopRun' | 'runEvents' | 'queuedTurns' | 'enqueueTurn' | 'beginQueuedTurnEdit' | 'updateQueuedTurn' | 'cancelQueuedTurnEdit' | 'deleteQueuedTurn' | 'moveQueuedTurn' | 'steerQueuedTurn' | 'resumeQueue' | 'wakeQueue' | 'runtimeStatus' | 'startRuntime' | 'stopRuntime' | 'steerRuntime' | 'onRuntimeStatus'>
}
