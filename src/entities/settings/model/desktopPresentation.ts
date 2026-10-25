import { useCallback, useContext } from 'react'
import { presentationDefaults, validatePresentationDefaults, type PresentationDefaults, type PresentationPreference } from '@termous/remote-protocol/presentation'
import { SettingsGatewayContext, type SettingsGateway } from './useSettingsModule.ts'

export function decodePresentationDefaults(value: unknown): PresentationDefaults {
  const defaults = value as PresentationDefaults
  validatePresentationDefaults(defaults)
  return structuredClone(defaults)
}

export function useDesktopPresentationDefaults(provided?: SettingsGateway) {
  const context = useContext(SettingsGatewayContext)
  const gateway = provided ?? context
  return useCallback(async (): Promise<Pick<PresentationPreference, 'defaults' | 'warning'>> => {
    if (!gateway) return { defaults: presentationDefaults() }
    try {
      const snapshot = gateway.getModule('desktop_presentation') ?? await gateway.readModule('desktop_presentation')
      return { defaults: decodePresentationDefaults(snapshot.value) }
    } catch {
      return { defaults: presentationDefaults(), warning: 'desktop_defaults_unavailable' }
    }
  }, [gateway])
}
