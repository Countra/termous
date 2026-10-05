import { AgentQuery_Kind as Q, AgentContentCommand_Action as C } from '@termous/remote-protocol/agent'
import { RemoteClient, RemoteError } from '#entities/remote-control'
import { decodeAgentAttachment, type AgentWorkspaceGateway } from '#features/agent-runtime'
import { decodeAgentReadiness, decodeAgentModelPage, decodeAgentModelProviderPage, type AgentSetupGateway } from '#features/agent-setup'
import { RemoteAgentTransport, revision } from './agentTransport.ts'
import { agentSessions } from './agentSessions.ts'
import { agentRuns } from './agentRuns.ts'

export type RemoteAgentSetup = Pick<AgentSetupGateway, 'readiness' | 'modelProviders' | 'models'>

export function createRemoteAgentGateway(client: RemoteClient) {
  const transport = new RemoteAgentTransport(client)
  const gateway: AgentWorkspaceGateway = {
    ...agentSessions(transport), ...agentRuns(transport),
    eventsUrl: () => { throw new RemoteError('remote_operation_unsupported') },
    subscribeWorkspace: observer => transport.subscribe(observer),
    updateMcpPolicy: async () => { throw new RemoteError('remote_operation_unsupported') },
    attachment: (id, signal) => transport.query('attachment', Q.ATTACHMENT, { id }, signal).then(decodeAgentAttachment),
    attachmentContent: async (id, signal) => {
      signal?.throwIfAborted()
      const data = await client.agentDownload(id)
      signal?.throwIfAborted()
      return new Blob([new Uint8Array(data)])
    },
    uploadAttachment: async (sessionId, file, signal, origin) => {
      signal?.throwIfAborted()
      if (file.size > 10 << 20 || !file.size) throw new RemoteError('remote_invalid')
      const mime = file.type || 'text/plain'
      const ref = await client.agentUpload(new Uint8Array(await file.arrayBuffer()), mime)
      signal?.throwIfAborted()
      return transport.write('attachment', { case: 'content', value: { action: C.COMMIT_ATTACHMENT, id: ref.id, sessionId, name: file.name, mimeType: mime,
        origin: origin ? { sourceSessionId: origin.source_session_id, hostName: origin.host_name, capturedAt: origin.captured_at, lineCount: origin.line_count } : undefined } }, signal).then(decodeAgentAttachment)
    },
    deleteAttachment: async (id, expectedRevision, signal) => { await transport.write('empty', { case: 'content', value: { action: C.DELETE_ATTACHMENT, id, expectedRevision: revision(expectedRevision) } }, signal) },
  }
  const setup: RemoteAgentSetup = {
    readiness: signal => transport.query('readiness', Q.STATUS, {}, signal).then(decodeAgentReadiness),
    modelProviders: (cursor, signal) => transport.query('providers', Q.PROVIDERS, { cursor, limit: 100 }, signal).then(decodeAgentModelProviderPage),
    models: (_query, cursor, signal) => transport.query('models', Q.MODELS, { cursor, limit: 100 }, signal).then(decodeAgentModelPage),
  }
  return { gateway, setup, transport }
}
