import type { RemoteDesktopSession } from '#entities/remote-desktop'
import type { RemoteDesktopProtocolRegistry } from './protocolRegistry.ts'
import type { RemoteDesktopRouteRegistry } from './routeRegistry.ts'

export function resolveRemoteDesktopSessionDrivers(
  session: RemoteDesktopSession,
  routeRegistry: RemoteDesktopRouteRegistry,
  protocolRegistry: RemoteDesktopProtocolRegistry,
) {
  return {
    route: routeRegistry.resolve(session.route, session.route_config_version),
    protocol: protocolRegistry.resolve(session.protocol, session.protocol_config_version),
  }
}
