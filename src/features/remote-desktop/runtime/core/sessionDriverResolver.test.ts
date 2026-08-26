import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDesktopSession } from '#entities/remote-desktop'
import { createRemoteDesktopProtocolRegistry } from './protocolRegistry.ts'
import { createRemoteDesktopRouteRegistry } from './routeRegistry.ts'
import { resolveRemoteDesktopSessionDrivers } from './sessionDriverResolver.ts'
import type { RemoteDesktopProtocolDriver } from './viewerContracts.ts'

test('Driver 身份只由 Session 固化快照决定', () => {
  const protocolV1 = protocolDriver(1)
  const protocolV2 = protocolDriver(2)
  const routeV1 = { id: 'ssh_tunnel' as const, configVersion: 1 }
  const routeV2 = { id: 'ssh_tunnel' as const, configVersion: 2 }
  const resolved = resolveRemoteDesktopSessionDrivers(
    session({ route_config_version: 2, protocol_config_version: 2 }),
    createRemoteDesktopRouteRegistry([routeV1, routeV2]),
    createRemoteDesktopProtocolRegistry([protocolV1, protocolV2]),
  )

  assert.equal(resolved.route, routeV2)
  assert.equal(resolved.protocol, protocolV2)
})

function session(overrides: Partial<RemoteDesktopSession>): RemoteDesktopSession {
  return {
    id: 'rds_test',
    profile_id: 'rdp_test',
    profile_name: '测试桌面',
    host_id: 'hst_test',
    ssh_profile_id: 'ssh_test',
    ssh_host_id: 'hst_test',
    ssh_host_name: '测试主机',
    route: 'ssh_tunnel',
    route_config_version: 1,
    protocol: 'vnc',
    protocol_config_version: 1,
    vnc: {
      loopback_host: '127.0.0.1',
      port: 5900,
      shared: true,
      default_view_only: false,
      default_display_mode: 'fit',
    },
    status: 'ready',
    phase: 'ready',
    connection_generation: 1,
    viewer_attached: false,
    created_at: '2026-08-26T00:00:00Z',
    updated_at: '2026-08-26T00:00:00Z',
    ...overrides,
  }
}

function protocolDriver(configVersion: number): RemoteDesktopProtocolDriver {
  return {
    id: 'vnc',
    configVersion,
    prepare: async () => undefined,
    initialViewerState: () => {
      throw new Error('not used')
    },
    createViewer: async () => {
      throw new Error('not used')
    },
  }
}
