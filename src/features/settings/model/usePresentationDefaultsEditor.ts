import { useContext, useMemo, useSyncExternalStore } from 'react'
import type { PresentationDefaults } from '@termous/remote-protocol/presentation'
import { SettingsGatewayContext, useSettingsModule } from '#entities/settings'
import { emptyPresentationEditor, presentationDefaultsAutosave } from './presentationDefaultsAutosave'

const emptySubscribe = () => () => {}
const emptySnapshot = () => emptyPresentationEditor

export function usePresentationDefaultsEditor(disabled: boolean) {
  const gateway = useContext(SettingsGatewayContext)
  const module = useSettingsModule('desktop_presentation')
  const editor = useMemo(() => gateway ? presentationDefaultsAutosave(gateway) : undefined, [gateway])
  const state = useSyncExternalStore(editor?.subscribe ?? emptySubscribe, editor?.snapshot ?? emptySnapshot)
  const locked = disabled || !module.available || !state.draft || state.invalidSnapshot
  return {
    ...state,
    change: (next: PresentationDefaults) => { if (!locked) editor?.change(next) },
    retry: () => { if (!locked) editor?.retry() },
    loading: module.busy && !state.draft,
    locked,
    loadFailed: state.invalidSnapshot || !state.draft && !module.busy && Boolean(module.error || !module.available),
  }
}
