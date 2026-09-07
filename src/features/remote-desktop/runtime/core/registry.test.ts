import assert from 'node:assert/strict'
import test from 'node:test'
import type { RemoteDesktopProtocolDriver } from './viewerContracts.ts'
import {
  createRemoteDesktopProtocolRegistry,
  RemoteDesktopProtocolRegistry,
} from './protocolRegistry.ts'
import {
  createRemoteDesktopRouteRegistry,
  RemoteDesktopRouteRegistry,
} from './routeRegistry.ts'

test('同一协议和路由的不同配置版本可以并存并精确解析', () => {
  const protocolV1 = protocolDriver(1)
  const protocolV2 = protocolDriver(2)
  const routeV1 = { id: 'ssh_tunnel' as const, configVersion: 1 }
  const routeV2 = { id: 'ssh_tunnel' as const, configVersion: 2 }

  const protocols = createRemoteDesktopProtocolRegistry([protocolV1, protocolV2])
  const routes = createRemoteDesktopRouteRegistry([routeV1, routeV2])

  assert.equal(protocols.resolve('vnc', 1), protocolV1)
  assert.equal(protocols.resolve('vnc', 2), protocolV2)
  assert.equal(routes.resolve('ssh_tunnel', 1), routeV1)
  assert.equal(routes.resolve('ssh_tunnel', 2), routeV2)
})

test('静态路由注册表可同时解析 SSH 隧道和直连实现', () => {
  const sshTunnel = { id: 'ssh_tunnel' as const, configVersion: 1 }
  const direct = { id: 'direct' as const, configVersion: 1 }
  const routes = createRemoteDesktopRouteRegistry([sshTunnel, direct])

  assert.equal(routes.resolve('ssh_tunnel', 1), sshTunnel)
  assert.equal(routes.resolve('direct', 1), direct)
})

test('Registry 拒绝重复、空注册、错误生命周期和未知版本', () => {
  const protocol = protocolDriver(1)
  const protocols = new RemoteDesktopProtocolRegistry()
  assert.throws(
    () => protocols.resolve('vnc', 1),
    /REMOTE_DESKTOP_PROTOCOL_REGISTRY_NOT_FROZEN/,
  )
  protocols.register(protocol)
  assert.throws(() => protocols.register(protocol), /REMOTE_DESKTOP_PROTOCOL_DUPLICATE/)
  protocols.freeze()
  assert.throws(() => protocols.register(protocolDriver(2)), /REMOTE_DESKTOP_PROTOCOL_REGISTRY_FROZEN/)
  assert.throws(() => protocols.resolve('vnc', 2), /REMOTE_DESKTOP_PROTOCOL_UNSUPPORTED/)
  assert.throws(() => new RemoteDesktopProtocolRegistry().freeze(), /REMOTE_DESKTOP_PROTOCOL_REGISTRY_EMPTY/)

  const route = { id: 'ssh_tunnel' as const, configVersion: 1 }
  const routes = new RemoteDesktopRouteRegistry()
  assert.throws(
    () => routes.resolve('ssh_tunnel', 1),
    /REMOTE_DESKTOP_ROUTE_REGISTRY_NOT_FROZEN/,
  )
  routes.register(route)
  assert.throws(() => routes.register(route), /REMOTE_DESKTOP_ROUTE_DUPLICATE/)
  routes.freeze()
  assert.throws(
    () => routes.register({ id: 'ssh_tunnel', configVersion: 2 }),
    /REMOTE_DESKTOP_ROUTE_REGISTRY_FROZEN/,
  )
  assert.throws(() => routes.resolve('ssh_tunnel', 2), /REMOTE_DESKTOP_ROUTE_UNSUPPORTED/)
  assert.throws(() => new RemoteDesktopRouteRegistry().freeze(), /REMOTE_DESKTOP_ROUTE_REGISTRY_EMPTY/)
})

test('Registry 拒绝无效描述符', () => {
  assert.throws(
    () => new RemoteDesktopProtocolRegistry().register({
      ...protocolDriver(1),
      configVersion: 0,
    }),
    /REMOTE_DESKTOP_PROTOCOL_DESCRIPTOR_INVALID/,
  )
  assert.throws(
    () => new RemoteDesktopRouteRegistry().register({
      id: 'ssh_tunnel',
      configVersion: 0,
    }),
    /REMOTE_DESKTOP_ROUTE_DESCRIPTOR_INVALID/,
  )
})

function protocolDriver(configVersion: number): RemoteDesktopProtocolDriver {
  return {
    id: 'vnc',
    configVersion,
    prepare: async () => undefined,
    initialViewerState: () => ({
      connection: 'idle',
      credentialFields: [],
      verification: null,
      displayMode: 'fit',
      viewOnly: false,
      desktopName: '',
      remoteClipboard: '',
      capabilities: { power: false },
      targetLabel: '',
      errorCode: '',
    }),
    createViewer: async () => ({
      dispose: () => undefined,
      setDisplayMode: () => undefined,
      setViewOnly: () => undefined,
      setViewportActive: () => undefined,
      focus: () => undefined,
      blur: () => undefined,
      sendCredentials: () => undefined,
      approveServer: () => undefined,
      sendCtrlAltDel: () => undefined,
      sendClipboard: () => undefined,
    }),
  }
}
