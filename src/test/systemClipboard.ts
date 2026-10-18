import type { SystemClipboardCapability, SystemClipboardConnectionState } from '#common/contracts'
import { systemClipboardCapabilities } from '#entities/system-clipboard'

export function clipboardCapabilitiesFixture(importState: SystemClipboardCapability['state'] = 'ready', publishState: SystemClipboardCapability['state'] = 'ready') {
  let version = 1
  let state: SystemClipboardConnectionState = {
    version, status: 'connected', snapshot: { schema_version: 1, instance_id: 'fixture', revision: 1, capabilities: {
      import_files: { state: importState }, publish_files: { state: publishState },
    } },
  }
  let listener: ((state: SystemClipboardConnectionState) => void) | undefined
  const disconnect = systemClipboardCapabilities.connect({ get: async () => state, subscribe: callback => { listener = callback; return () => { listener = undefined } } })
  listener?.(state)
  return {
    disconnect,
    update(patch: Partial<SystemClipboardConnectionState>) {
      state = { ...state, ...patch, version: ++version }
      listener?.(state)
    },
  }
}
