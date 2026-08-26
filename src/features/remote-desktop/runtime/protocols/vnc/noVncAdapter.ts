import type {
  RemoteDesktopDisplayMode,
} from '#entities/remote-desktop'
import type {
  RemoteDesktopTransportMetricsSnapshot,
  RemoteDesktopViewerCapabilities,
  RemoteDesktopViewerErrorCode,
} from '../../core/viewerContracts.ts'
import { VncTransportMetrics } from './vncTransportMetrics.ts'

export type VncCredentialType = 'username' | 'password' | 'target'
export type VncCredentials = Partial<Record<VncCredentialType, string>>

export interface VncViewerAdapterError {
  code: RemoteDesktopViewerErrorCode
  detail?: string
}

export interface VncViewerAdapterEvents {
  onConnected: () => void
  onDisconnected: (clean: boolean) => void
  onCredentialsRequired: (types: VncCredentialType[]) => void
  onSecurityFailure: (error: VncViewerAdapterError) => void
  onServerVerification: (verification: { type: string; fingerprint: string }) => void
  onClipboard: (text: string) => void
  onDesktopName: (name: string) => void
  onCapabilities: (capabilities: RemoteDesktopViewerCapabilities) => void
  onMetrics: (metrics: RemoteDesktopTransportMetricsSnapshot) => void
}

interface NoVncEventMap {
  connect: Event
  disconnect: CustomEvent<{ clean?: boolean }>
  credentialsrequired: CustomEvent<{ types?: string[] }>
  securityfailure: CustomEvent<{ reason?: string; status?: number }>
  serververification: CustomEvent<{ type?: string; publickey?: Uint8Array }>
  clipboard: CustomEvent<{ text?: string }>
  desktopname: CustomEvent<{ name?: string }>
  capabilities: CustomEvent<{ capabilities?: Record<string, boolean> }>
}

type NoVncEventName = keyof NoVncEventMap

export interface CreateVncViewerAdapterOptions {
  target: HTMLElement
  url: string
  shared: boolean
  viewOnly: boolean
  displayMode: RemoteDesktopDisplayMode
  credentials?: VncCredentials
  events: VncViewerAdapterEvents
}

export class VncViewerAdapter {
  private readonly rfb: InstanceType<typeof import('@novnc/novnc')['default']>
  private readonly listeners: Array<[NoVncEventName, EventListener]> = []
  private disposed = false

  private constructor(
    rfb: InstanceType<typeof import('@novnc/novnc')['default']>,
    private readonly transportMetrics: VncTransportMetrics,
    private readonly events: VncViewerAdapterEvents,
  ) {
    this.rfb = rfb
    this.bindEvents()
  }

  static async create(options: CreateVncViewerAdapterOptions) {
    const { default: RFB } = await prepareVncViewerAdapter()
    const transportMetrics = new VncTransportMetrics(options.url, options.events.onMetrics)
    let rfb: InstanceType<typeof RFB>
    try {
      rfb = new RFB(options.target, transportMetrics.channel, {
        shared: options.shared,
        credentials: options.credentials,
      })
    } catch (error) {
      transportMetrics.close()
      throw error
    }
    rfb.background = 'var(--remote-desktop-canvas-bg, #090c11)'
    rfb.viewOnly = options.viewOnly
    rfb.focusOnClick = true
    rfb.showDotCursor = true
    rfb.qualityLevel = 6
    rfb.compressionLevel = 2
    const adapter = new VncViewerAdapter(rfb, transportMetrics, options.events)
    adapter.setDisplayMode(options.displayMode)
    return adapter
  }

  setDisplayMode(mode: RemoteDesktopDisplayMode) {
    if (mode === 'fit') {
      this.rfb.resizeSession = false
      this.rfb.scaleViewport = true
      this.rfb.clipViewport = false
      return
    }
    if (mode === 'resize') {
      this.rfb.scaleViewport = false
      this.rfb.clipViewport = true
      this.rfb.resizeSession = true
      return
    }
    this.rfb.resizeSession = false
    this.rfb.scaleViewport = false
    this.rfb.clipViewport = false
  }

  setViewOnly(value: boolean) {
    this.rfb.viewOnly = value
  }

  setViewportActive(active: boolean, mode: RemoteDesktopDisplayMode) {
    if (!active && mode === 'resize') {
      this.rfb.resizeSession = false
      return
    }
    if (active) {
      this.setDisplayMode(mode)
    }
  }

  focus() {
    this.rfb.focus({ preventScroll: true })
  }

  blur() {
    this.rfb.blur()
  }

  sendCredentials(credentials: VncCredentials) {
    this.rfb.sendCredentials(credentials)
  }

  approveServer() {
    this.rfb.approveServer()
  }

  sendCtrlAltDel() {
    this.rfb.sendCtrlAltDel()
  }

  sendClipboard(text: string) {
    this.rfb.clipboardPasteFrom(text)
  }

  disconnect() {
    if (!this.disposed) {
      this.rfb.disconnect()
    }
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    for (const [name, listener] of this.listeners) {
      this.rfb.removeEventListener(name, listener)
    }
    this.listeners.length = 0
    try {
      this.rfb.disconnect()
    } finally {
      this.transportMetrics.close()
    }
  }

  private bindEvents() {
    this.listen('connect', () => {
      this.transportMetrics.markConnected()
      this.events.onConnected()
    })
    this.listen('disconnect', (event) => this.events.onDisconnected(event.detail.clean === true))
    this.listen('credentialsrequired', (event) => {
      const types = (event.detail.types ?? []).filter(isCredentialType)
      this.events.onCredentialsRequired(types)
    })
    this.listen('securityfailure', (event) => {
      this.events.onSecurityFailure({
        code: 'security_failure',
        detail: event.detail.reason || String(event.detail.status ?? ''),
      })
    })
    this.listen('serververification', (event) => {
      const key = event.detail.publickey
      if (!key) {
        this.events.onSecurityFailure({ code: 'server_identity_missing' })
        return
      }
      void sha256Fingerprint(key).then((fingerprint) => {
        if (!this.disposed) {
          this.events.onServerVerification({
            type: event.detail.type || 'RSA',
            fingerprint,
          })
        }
      }).catch(() => {
        if (!this.disposed) {
          this.events.onSecurityFailure({ code: 'server_identity_unverifiable' })
        }
      })
    })
    this.listen('clipboard', (event) => this.events.onClipboard(event.detail.text ?? ''))
    this.listen('desktopname', (event) => this.events.onDesktopName(event.detail.name ?? ''))
    this.listen('capabilities', (event) => {
      this.events.onCapabilities({ power: event.detail.capabilities?.power === true })
    })
  }

  private listen<Name extends NoVncEventName>(
    name: Name,
    handler: (event: NoVncEventMap[Name]) => void,
  ) {
    const listener = ((event: Event) => handler(event as NoVncEventMap[Name])) as EventListener
    this.rfb.addEventListener(name, listener)
    this.listeners.push([name, listener])
  }
}

let noVncModulePromise: Promise<typeof import('@novnc/novnc')> | null = null

export function prepareVncViewerAdapter() {
  noVncModulePromise ??= import('@novnc/novnc')
  return noVncModulePromise
}

function isCredentialType(value: string): value is VncCredentialType {
  return value === 'username' || value === 'password' || value === 'target'
}

async function sha256Fingerprint(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(value).buffer)
  const encoded = btoa(String.fromCharCode(...new Uint8Array(digest)))
  return `SHA256:${encoded.replace(/=+$/, '')}`
}
