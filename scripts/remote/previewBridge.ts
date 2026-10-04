import { create, fromBinary, fromJson, toBinary, type JsonValue } from '@bufbuild/protobuf'
import { EnvelopeSchema, RequestSchema, StreamFrameSchema, type StreamFrame } from '@termous/remote-protocol'
import type { RemoteBootstrap, RemoteConnection, RemoteWindowBridge } from '#common/contracts'

export function createPreview(query: URLSearchParams): { bridge: RemoteWindowBridge; bootstrap: RemoteBootstrap } {
  const bootstrap: RemoteBootstrap = { generation: '1', deviceId: 'host', deviceName: 'Termous Workstation', language: query.has('en') ? 'en-US' : 'zh-CN', theme: query.has('light') ? 'light' : 'dark' }
  const connection: RemoteConnection = { id: 'preview', state: 'connected', scope: { connection_id: 'preview', generation: '1', controller_id: 'controller', host_id: 'host' }, lease_expires_at: new Date(Date.now() + 300000).toISOString(), stats: { state: 'connected', path: 'direct', protocol: 'udp', encryption: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256', ip_version: 'ipv4', local_candidate: 'host', remote_candidate: 'host', rtt_ms: 12, bytes_sent: 0, bytes_received: 0 } }
  const sessions = [{ id: 'ssh', profileId: 'profile', name: 'Ubuntu · deploy', kind: 'ssh', state: 'connected', generation: '1', origin: 'remote' }, { id: 'sftp', profileId: 'profile', name: 'Ubuntu · deploy', kind: 'sftp', state: 'connected', generation: '1', origin: 'desktop' }]
  const entries = [{ name: 'releases', path: '/releases', kind: 'directory', size: '0' }, { name: 'app.log', path: '/app.log', kind: 'file', size: '16428' }, { name: 'README.md', path: '/README.md', kind: 'file', size: '2048' }]
  let receive: ((sequence: number, data: Uint8Array) => void) | undefined
  let sequence = 0, outputSequence = 0n, offset = 0n, controlled = false
  const control = () => ({ generation: '1', ownerDeviceId: controlled ? 'controller' : '', acceptedSequence: '0' })
  const emit = (frame: StreamFrame) => {
    receive?.(++sequence, toBinary(EnvelopeSchema, create(EnvelopeSchema, { connectionId: 'preview', generation: 1n, payload: { case: 'stream', value: frame } })))
  }
  const output = (data: Uint8Array) => {
    emit(create(StreamFrameSchema, { streamId: 'terminal:preview', kind: 'terminal_output', epoch: 'epoch', offset, sequence: ++outputSequence, data }))
    offset += BigInt(data.length)
  }
  const bridge: RemoteWindowBridge = {
    bootstrap: async () => bootstrap,
    connection: async () => ({ ok: true, value: connection }),
    request: async value => {
      const request = fromJson(RequestSchema, value)
      let result: JsonValue = {}
      switch (request.operation.case) {
        case 'inventory':
          result = { inventory: { profiles: [{ id: 'profile', name: 'Development', host: '192.0.2.10', username: 'deploy', available: true }], sessions, roots: [{ id: 'root', name: 'Downloads', readable: true, writable: true }], operations: [{ id: 'delete', sessionId: 'sftp', kind: 'delete', state: 'completed', path: '/old-release', completedEntries: '4', totalEntries: '4' }] } }
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
          const kind = request.operation.value.kind
          result = { session: sessions.find(item => item.kind === kind)! }
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
    localTransfers: async () => ({ ok: true, value: [{ id: 'transfer', state: 'paused', remote_id: '', name: 'release.tar.gz', direction: 'download', confirmed_bytes: 2097152, total_bytes: 8388608, resumable: true }] }),
    localTransferAction: async () => ({ ok: false, code: 'remote_operation_unsupported' }),
    disconnect: async () => ({ ok: true, value: true }),
    close: async () => {},
    onAppearance: () => () => {},
  }
  return { bridge, bootstrap }
}
