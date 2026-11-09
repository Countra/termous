import { presentationDefaults, validatePresentationDefaults, type PresentationDefaults, type PresentationDefaultsSnapshot } from '@termous/remote-protocol/presentation'
import type { RemoteWindowBridge } from '#common/contracts'

export async function readDesktopDefaults(bridge: RemoteWindowBridge, connectionId: string): Promise<PresentationDefaultsSnapshot> {
  try {
    const response = await bridge.desktopQualityDefaults?.(connectionId)
    if (!response?.ok) throw new Error('desktop_defaults_unavailable')
    const defaults = response.value.value as unknown as PresentationDefaults
    validatePresentationDefaults(defaults)
    return { defaults: structuredClone(defaults) }
  } catch {
    return { defaults: presentationDefaults(), warning: 'desktop_defaults_unavailable' }
  }
}
