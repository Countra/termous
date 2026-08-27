import type {
  RemoteDesktopCredentials,
  RemoteDesktopProtocolDriver,
} from '../../core/viewerContracts.ts'
import {
  prepareVncViewerAdapter,
  VncViewerAdapter,
  type VncCredentials,
} from './noVncAdapter.ts'

const credentialKinds = new Set(['username', 'target'])

export const vncProtocolDriver = Object.freeze({
  id: 'vnc',
  configVersion: 1,
  async prepare() {
    await prepareVncViewerAdapter()
  },
  initialViewerState(session) {
    return {
      connection: session.status === 'streaming' ? 'connecting' : 'idle',
      credentialFields: [],
      verification: null,
      displayMode: session.vnc.default_display_mode,
      viewOnly: session.vnc.default_view_only,
      desktopName: '',
      remoteClipboard: '',
      capabilities: { power: false },
      targetLabel: `VNC · ${formatHostPort(session.vnc.target_host, session.vnc.port)}`,
      errorCode: '',
    }
  },
  async createViewer(options) {
    const adapter = await VncViewerAdapter.create({
      target: options.target,
      url: options.url,
      shared: options.session.vnc.shared,
      viewOnly: options.state.viewOnly,
      displayMode: options.state.displayMode,
      credentials: toVncCredentials(options.credentials),
      events: {
        ...options.events,
        onCredentialsRequired: (types) => options.events.onCredentialsRequired(types.map((id) => ({
          id,
          kind: credentialKinds.has(id) ? 'text' : 'secret',
          required: true,
        }))),
      },
    })
    return {
      dispose: () => adapter.dispose(),
      setDisplayMode: (mode) => adapter.setDisplayMode(mode),
      setViewOnly: (value) => adapter.setViewOnly(value),
      setViewportActive: (active, mode) => adapter.setViewportActive(active, mode),
      focus: () => adapter.focus(),
      blur: () => adapter.blur(),
      sendCredentials: (credentials) => adapter.sendCredentials(toVncCredentials(credentials) ?? {}),
      approveServer: () => adapter.approveServer(),
      sendCtrlAltDel: () => adapter.sendCtrlAltDel(),
      sendClipboard: (text) => adapter.sendClipboard(text),
    }
  },
} satisfies RemoteDesktopProtocolDriver)

function toVncCredentials(credentials?: RemoteDesktopCredentials): VncCredentials | undefined {
  if (!credentials) {
    return undefined
  }
  const result: VncCredentials = {}
  if (typeof credentials.username === 'string') result.username = credentials.username
  if (typeof credentials.password === 'string') result.password = credentials.password
  if (typeof credentials.target === 'string') result.target = credentials.target
  return result
}

function formatHostPort(host: string, port: number) {
  const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `${normalizedHost}:${port}`
}
