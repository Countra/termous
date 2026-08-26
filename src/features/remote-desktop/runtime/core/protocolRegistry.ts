import type { RemoteDesktopProtocol } from '#entities/remote-desktop'
import type { RemoteDesktopProtocolDriver } from './viewerContracts.ts'

export class RemoteDesktopProtocolRegistry {
  private readonly drivers = new Map<string, RemoteDesktopProtocolDriver>()
  private frozen = false

  register(driver: RemoteDesktopProtocolDriver) {
    if (this.frozen) {
      throw new Error('REMOTE_DESKTOP_PROTOCOL_REGISTRY_FROZEN')
    }
    if (!isValidDriver(driver)) {
      throw new Error('REMOTE_DESKTOP_PROTOCOL_DESCRIPTOR_INVALID')
    }
    const key = registryKey(driver.id, driver.configVersion)
    if (this.drivers.has(key)) {
      throw new Error('REMOTE_DESKTOP_PROTOCOL_DUPLICATE')
    }
    this.drivers.set(key, driver)
    return this
  }

  freeze() {
    if (this.drivers.size === 0) {
      throw new Error('REMOTE_DESKTOP_PROTOCOL_REGISTRY_EMPTY')
    }
    this.frozen = true
    return this
  }

  resolve(protocol: RemoteDesktopProtocol, configVersion: number) {
    if (!this.frozen) {
      throw new Error('REMOTE_DESKTOP_PROTOCOL_REGISTRY_NOT_FROZEN')
    }
    const driver = this.drivers.get(registryKey(protocol, configVersion))
    if (!driver) {
      throw new Error('REMOTE_DESKTOP_PROTOCOL_UNSUPPORTED')
    }
    return driver
  }
}

export function createRemoteDesktopProtocolRegistry(
  drivers: RemoteDesktopProtocolDriver[],
) {
  const registry = new RemoteDesktopProtocolRegistry()
  for (const driver of drivers) {
    registry.register(driver)
  }
  return registry.freeze()
}

function registryKey(protocol: RemoteDesktopProtocol, configVersion: number) {
  return `${protocol}@${configVersion}`
}

function isValidDriver(driver: RemoteDesktopProtocolDriver) {
  return typeof driver.id === 'string'
    && driver.id.length > 0
    && driver.id.trim() === driver.id
    && Number.isSafeInteger(driver.configVersion)
    && driver.configVersion > 0
    && driver.configVersion <= 65_535
    && typeof driver.prepare === 'function'
    && typeof driver.initialViewerState === 'function'
    && typeof driver.createViewer === 'function'
}
