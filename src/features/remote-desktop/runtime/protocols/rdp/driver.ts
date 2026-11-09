import { emptyRemoteDesktopViewerState, type RemoteDesktopProtocolDriver } from '../../core/viewerContracts.ts'

export const rdpProtocolDriver: RemoteDesktopProtocolDriver = {
  id: 'rdp', configVersion: 1,
  async prepare() { await import('./viewer.ts') },
  initialViewerState(session) {
    return { ...emptyRemoteDesktopViewerState, displayMode: session.rdp?.default_display_mode === 'actual' ? 'actual' : 'fit',
      followWindow: session.rdp?.default_display_mode === 'resize',
      viewOnly: session.rdp?.default_view_only ?? true,
      targetLabel: `RDP · ${session.rdp?.target_host ?? ''}:${session.rdp?.port ?? 3389}` }
  },
  async createViewer(options) {
    const { createRdpViewer } = await import('./viewer.ts')
    return createRdpViewer(options)
  },
}
