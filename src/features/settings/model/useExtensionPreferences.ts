import { useContext, useEffect, useMemo, useSyncExternalStore } from 'react'
import { SettingsGatewayContext, useSettingsModule } from '#entities/settings'
import { emptyExtensionPreference, extensionPreferences, type ExtensionPreferenceId } from './extensionPreferences'

const emptySubscribe = () => () => {}
const emptySnapshot = () => emptyExtensionPreference

export function useExtensionPreferences(id: ExtensionPreferenceId) {
  const gateway = useContext(SettingsGatewayContext)
  const module = useSettingsModule(id, { refreshOnFocus: true })
  const editor = useMemo(() => gateway ? extensionPreferences(gateway, id) : undefined, [gateway, id])
  const state = useSyncExternalStore(editor?.subscribe ?? emptySubscribe, editor?.snapshot ?? emptySnapshot)
  useEffect(() => () => {
    const current = editor?.snapshot()
    // Esc 关闭或切换分区可能没有触发失焦，离开时提交完整草稿；失败不自动重试。
    if (current?.value && (current.status === 'editing' || current.status === 'saving')) editor?.commit()
  }, [editor])
  return { ...state, locked: !module.available || !state.value || module.snapshot?.state.status === 'unavailable',
    error: state.error ?? module.error?.message, loading: module.busy && !state.value,
    change: (patch: Record<string, unknown>) => { module.clearError(); editor?.change(patch) },
    commit: () => { module.clearError(); editor?.commit() },
    retry: () => { if (!state.error && module.error) void module.refresh(); else editor?.retry() },
    reset: () => { module.clearError(); editor?.reset() }, refresh: module.refresh }
}
