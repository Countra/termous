import type { RemoteDesktopRoute } from '#entities/remote-desktop'

export interface RemoteDesktopRouteDescriptor {
  readonly id: RemoteDesktopRoute
  readonly configVersion: number
}

export class RemoteDesktopRouteRegistry {
  private readonly descriptors = new Map<string, RemoteDesktopRouteDescriptor>()
  private frozen = false

  register(descriptor: RemoteDesktopRouteDescriptor) {
    if (this.frozen) {
      throw new Error('REMOTE_DESKTOP_ROUTE_REGISTRY_FROZEN')
    }
    if (!isValidDescriptor(descriptor)) {
      throw new Error('REMOTE_DESKTOP_ROUTE_DESCRIPTOR_INVALID')
    }
    const key = registryKey(descriptor.id, descriptor.configVersion)
    if (this.descriptors.has(key)) {
      throw new Error('REMOTE_DESKTOP_ROUTE_DUPLICATE')
    }
    this.descriptors.set(key, descriptor)
    return this
  }

  freeze() {
    if (this.descriptors.size === 0) {
      throw new Error('REMOTE_DESKTOP_ROUTE_REGISTRY_EMPTY')
    }
    this.frozen = true
    return this
  }

  resolve(route: RemoteDesktopRoute, configVersion: number) {
    if (!this.frozen) {
      throw new Error('REMOTE_DESKTOP_ROUTE_REGISTRY_NOT_FROZEN')
    }
    const descriptor = this.descriptors.get(registryKey(route, configVersion))
    if (!descriptor) {
      throw new Error('REMOTE_DESKTOP_ROUTE_UNSUPPORTED')
    }
    return descriptor
  }
}

export function createRemoteDesktopRouteRegistry(
  descriptors: RemoteDesktopRouteDescriptor[],
) {
  const registry = new RemoteDesktopRouteRegistry()
  for (const descriptor of descriptors) {
    registry.register(descriptor)
  }
  return registry.freeze()
}

function registryKey(route: RemoteDesktopRoute, configVersion: number) {
  return `${route}@${configVersion}`
}

function isValidDescriptor(descriptor: RemoteDesktopRouteDescriptor) {
  return typeof descriptor.id === 'string'
    && descriptor.id.length > 0
    && descriptor.id.trim() === descriptor.id
    && Number.isSafeInteger(descriptor.configVersion)
    && descriptor.configVersion > 0
    && descriptor.configVersion <= 65_535
}
