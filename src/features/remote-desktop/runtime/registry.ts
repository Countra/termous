import { createRemoteDesktopProtocolRegistry } from './core/protocolRegistry.ts'
import { createRemoteDesktopRouteRegistry } from './core/routeRegistry.ts'
import { vncProtocolDriver } from './protocols/vnc/driver.ts'
import { directRouteDescriptor } from './routes/direct/descriptor.ts'
import { sshTunnelRouteDescriptor } from './routes/ssh-tunnel/descriptor.ts'

export const remoteDesktopProtocolRegistry = createRemoteDesktopProtocolRegistry([
  vncProtocolDriver,
])

export const remoteDesktopRouteRegistry = createRemoteDesktopRouteRegistry([
  sshTunnelRouteDescriptor,
  directRouteDescriptor,
])
