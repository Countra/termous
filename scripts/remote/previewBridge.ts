import { create, fromBinary, fromJson, toBinary, type JsonValue } from '@bufbuild/protobuf'
import { EnvelopeSchema, RequestSchema, StreamFrameSchema, type StreamFrame } from '@termous/remote-protocol'
import { AgentQuery_Kind as Q } from '@termous/remote-protocol/agent'
import type { RemoteBootstrap, RemoteConnection, RemoteWindowBridge } from '#common/contracts'
import { createAgentPreview } from './agentPreview'

export function createPreview(query: URLSearchParams): { bridge: RemoteWindowBridge; bootstrap: RemoteBootstrap } {
  const bootstrap: RemoteBootstrap = { generation: '1', deviceId: 'host', deviceName: 'Termous Workstation', language: query.has('en') ? 'en-US' : 'zh-CN', theme: query.has('light') ? 'light' : 'dark' }
  const connection: RemoteConnection = { id: 'preview', state: 'connected', scope: { connection_id: 'preview', generation: '1', controller_id: 'controller', host_id: 'host' }, lease_expires_at: new Date(Date.now() + 300000).toISOString(), stats: { state: 'connected', path: 'direct', protocol: 'udp', encryption: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256', ip_version: 'ipv4', local_candidate: 'host', remote_candidate: 'host', rtt_ms: 12, bytes_sent: 0, bytes_received: 0 } }
  const capabilities = ['browse', 'entry_create', 'entry_mutate', 'planned_delete', 'transfer', 'transfer_receive']
  const hosts = [{ id: 'host', name: 'Development', connections: [
    { id: 'profile', name: 'deploy', kind: 'ssh', engine: '', available: true },
    { id: 'sftp-profile', name: 'Project files', kind: 'files', engine: 'sftp', available: true },
    { id: 's3-profile', name: 'Release bucket', kind: 'files', engine: 's3', available: true },
    { id: 'dav-profile', name: 'Team documents', kind: 'files', engine: 'webdav', available: true },
  ] }]
  const sessions = hosts[0]!.connections.map(profile => ({ id: profile.kind === 'ssh' ? 'ssh' : profile.id, hostId: 'host', profileId: profile.id, name: profile.name, kind: profile.kind, engine: profile.engine, capabilities: profile.kind === 'files' ? capabilities : [], state: 'connected', generation: '1', origin: 'remote' }))
  const entries = [{ name: 'releases', path: '/releases', kind: 'directory', size: '0' }, { name: 'app.log', path: '/app.log', kind: 'file', size: '16428' }, { name: 'README.md', path: '/README.md', kind: 'file', size: '2048' }]
  let receive: ((sequence: number, data: Uint8Array) => void) | undefined
  let sequence = 0, outputSequence = 0n, offset = 0n, controlled = false
  let maximized = false
  let connectionFailed = query.get('feedback') === 'connection'
  let inventoryReads = 0
  const maximizeListeners = new Set<(value: boolean) => void>()
  const agent = createAgentPreview(query.has('en'), () => receive?.(++sequence, toBinary(EnvelopeSchema, create(EnvelopeSchema, { connectionId: connection.id, generation: 1n, payload: { case: 'event', value: { type: 'agent.update', value: { case: 'agent', value: { instanceId: 'agent-instance', resync: true } } } } }))), query.has('scroll'))
  const control = () => ({ generation: '1', ownerDeviceId: controlled ? 'controller' : '', acceptedSequence: '0' })
  const emit = (frame: StreamFrame) => {
    receive?.(++sequence, toBinary(EnvelopeSchema, create(EnvelopeSchema, { connectionId: connection.id, generation: 1n, payload: { case: 'stream', value: frame } })))
  }
  const output = (data: Uint8Array) => {
    emit(create(StreamFrameSchema, { streamId: 'terminal:preview', kind: 'terminal_output', epoch: 'epoch', offset, sequence: ++outputSequence, data }))
    offset += BigInt(data.length)
  }
  const bridge: RemoteWindowBridge = {
    ...(query.has('window') ? { windowControls: {
      minimize: async () => ({ ok: true as const, value: true }),
      toggleMaximize: async () => {
        maximized = !maximized
        maximizeListeners.forEach(listener => listener(maximized))
        return { ok: true as const, value: maximized }
      },
      isMaximized: async () => ({ ok: true as const, value: maximized }),
      onMaximizeState: (callback: (value: boolean) => void) => { maximizeListeners.add(callback); return () => { maximizeListeners.delete(callback) } },
    } } : {}),
    bootstrap: async () => bootstrap,
    connection: async () => connectionFailed ? { ok: false, code: 'remote_signaling_unavailable' } : { ok: true, value: connection },
    reconnect: async () => {
      connectionFailed = false
      connection.id = `preview-${++sequence}`
      connection.scope.connection_id = connection.id
      connection.state = 'connected'
      return { ok: true, value: connection }
    },
    request: async value => {
      const request = fromJson(RequestSchema, value)
      let result: JsonValue = {}
      switch (request.operation.case) {
        case 'agent':
          if (query.get('feedback') === 'combined' && request.operation.value.operation.case === 'query' && request.operation.value.operation.value.kind === Q.RESOURCES) return { ok: false, code: 'remote_invalid' }
          if (query.get('feedback') === 'approval' && request.operation.value.operation.case === 'approval') return { ok: false, code: 'remote_operation_uncertain', uncertain: true }
          result = agent(request.operation.value); break
        case 'inventory':
          inventoryReads++
          if (query.get('feedback') === 'refresh' && inventoryReads === 2 || query.get('feedback') === 'combined' && inventoryReads > 1) return { ok: false, code: 'remote_invalid' }
          result = { inventory: { hosts, sessions, agentEnabled: query.has('agent'), roots: [{ id: 'root', name: 'Downloads', readable: true, writable: true }], operations: [{ id: 'delete', sessionId: 'sftp-profile', kind: 'delete', state: 'completed', path: '/old-release', completedEntries: '4', totalEntries: '4' }] } }
          break
        case 'session': {
          const action = request.operation.value.action
          if (action === 'attach') result = { attachment: { streamId: 'terminal:preview', epoch: 'epoch', oldestOffset: '0', nextOffset: '0' } }
          else if (action.startsWith('control_')) {
            if (action === 'control_acquire') controlled = true
            if (action === 'control_release') controlled = false
            result = { control: control() }
          }
          break
        }
        case 'createSession': {
          if (query.get('feedback') === 'action') return { ok: false, code: 'remote_operation_uncertain', uncertain: true }
          const input = request.operation.value
          result = { session: sessions.find(item => item.kind === input.kind && item.profileId === input.profileId)! }
          break
        }
        case 'file': {
          const action = request.operation.value.action
          if (action === 'list') result = { directory: { entries: request.operation.value.location?.path === '/' ? entries : [] } }
          else if (action === 'stat') {
            const path = request.operation.value.location?.path
            result = { entry: entries.find(item => item.path === path) ?? entries[1]! }
          }
          else return { ok: false, code: 'remote_operation_unsupported' }
          break
        }
        default: return { ok: false, code: 'remote_operation_unsupported' }
      }
      return { ok: true, value: result }
    },
    subscribe: callback => { receive = callback; return () => { receive = undefined } },
    consume: () => {},
    send: async bytes => {
      const frame = fromBinary(StreamFrameSchema, bytes)
      if (frame.kind === 'credit' && offset === 0n) output(new TextEncoder().encode('\x1b[36mUbuntu 24.04 LTS\x1b[0m\r\n\r\nConnected to deploy@workspace\r\n\x1b[32mdeploy@workspace\x1b[0m:~/project$ '))
      if (frame.kind === 'terminal_input') {
        output(frame.data)
        emit(create(StreamFrameSchema, { streamId: frame.streamId, kind: 'ack', controlGeneration: frame.controlGeneration, sequence: frame.sequence }))
      }
      return { ok: true, value: true }
    },
    selectTransfer: async () => ({ ok: false, code: 'remote_operation_unsupported' }),
    agentUpload: async () => ({ ok: false, code: 'remote_operation_unsupported' }),
    agentDownload: async () => ({ ok: false, code: 'remote_operation_unsupported' }),
    setAgentView: async () => ({ ok: true, value: true }),
    localTransfers: async () => ({ ok: true, value: query.has('progress') ? [
      { id: 'upload', state: query.get('progress') === 'completed' ? 'completed' : 'running', stage: query.get('progress') === 'sending' ? 'running' : 'publishing', remote_id: '', session_id: 'sftp-profile', name: 'release.tar.gz', direction: 'upload', confirmed_bytes: 8388608, total_bytes: 8388608, target_bytes: query.get('progress') === 'sending' ? 0 : query.get('progress') === 'writing' ? 4194304 : 8388608, resumable: false },
    ] : [{ id: 'transfer', state: 'paused', remote_id: '', name: 'release.tar.gz', direction: 'download', confirmed_bytes: 2097152, total_bytes: 8388608, resumable: true }] }),
    localTransferAction: async () => ({ ok: false, code: 'remote_operation_unsupported' }),
    disconnect: async () => ({ ok: true, value: true }),
    close: async () => {},
    onAppearance: () => () => {},
  }
  return { bridge, bootstrap }
}
