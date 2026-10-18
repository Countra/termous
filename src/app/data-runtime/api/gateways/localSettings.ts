import { localSettingsDefinitions, type DesktopSettingsModule, type SettingsModuleId, type SettingsSnapshot, type TermousBridge, type UpdatePreferencesPatch } from '#common/contracts'
import { SettingsModuleStore, decodeSettingsEvent, decodeSettingsSnapshot, type SettingsGateway } from '#entities/settings'
import { getTermousBridge } from '#shared/bridge'

const smoothScrollKey = 'termous.ui.terminal.sshSmoothScroll.v1'
let localSnapshot: SettingsSnapshot | undefined
function definition(id: SettingsModuleId) {
  if (!Object.prototype.hasOwnProperty.call(localSettingsDefinitions, id)) throw new Error('SETTINGS_UNSUPPORTED_MODULE')
  return localSettingsDefinitions[id as keyof typeof localSettingsDefinitions]
}
function readLocal(): SettingsSnapshot {
  if (!localSnapshot) {
    let enabled = false
    try { enabled = window.localStorage.getItem(smoothScrollKey) === 'true' } catch { /* 浏览器禁止存储时沿用原有内存降级。 */ }
    localSnapshot = { id: 'terminal_local', schema_version: localSettingsDefinitions.terminal_local.schema_version, revision: 1, value: { ssh_smooth_scroll: enabled }, state: { status: 'applied' } }
  }
  return structuredClone(localSnapshot)
}
export const localSettingsStore = new SettingsModuleStore({
  read: async (id) => {
    const module = definition(id)
    if (module.owner === 'browser') return readLocal()
    const bridge = getTermousBridge()?.settings
    if (!bridge) return { id, schema_version: module.schema_version, revision: 1, value: {}, state: { status: 'unavailable', reason: 'desktop_only' } }
    return decodeSettingsSnapshot(await bridge.get(id as DesktopSettingsModule), id)
  },
  update: async (id, request) => {
    if (definition(id).owner === 'browser') {
      const current = readLocal()
      if (request.expected_revision !== current.revision) throw Object.assign(new Error('SETTINGS_REVISION_CONFLICT'), { code: 'SETTINGS_REVISION_CONFLICT' })
      if (Object.keys(request.patch).length !== 1 || typeof request.patch.ssh_smooth_scroll !== 'boolean') throw new Error('SETTINGS_INVALID_REQUEST')
      try { window.localStorage.setItem(smoothScrollKey, String(request.patch.ssh_smooth_scroll)) } catch { /* 与旧设置一致，当前窗口仍可调整平滑滚动。 */ }
      localSnapshot = { ...current, revision: current.revision + 1, value: { ssh_smooth_scroll: request.patch.ssh_smooth_scroll } }
      return structuredClone(localSnapshot)
    }
    const bridge = getTermousBridge()?.settings
    if (!bridge) throw new Error('SETTINGS_UNAVAILABLE')
    return decodeSettingsSnapshot(await bridge.update(id as DesktopSettingsModule, request), id)
  },
})

export const localSettingsGateway: SettingsGateway = {
  getModule: (id) => localSettingsStore.snapshot(id),
  readModule: (id, signal) => localSettingsStore.read(id, signal),
  updateModule: (id, patch, options) => localSettingsStore.update(id, patch, options),
  subscribeSettings: localSettingsStore.subscribe,
}

export function subscribeLocalSettings() {
  const bridge = getTermousBridge()?.settings
  return bridge?.onChanged((input) => {
    try {
      const event = decodeSettingsEvent(input)
      if (event.type === 'changed') void localSettingsStore.read(event.module).catch(() => { console.error('刷新桌面设置失败') })
    } catch { console.error('桌面设置事件格式无效') }
  }) ?? (() => {})
}

// 更新执行状态保留原通道，仅把设置写入转交统一中心。
export function desktopUpdateBridge(bridge: TermousBridge | null | undefined) {
  if (!bridge?.updates) return null
  return { ...bridge.updates, setPreferences: async (patch: UpdatePreferencesPatch) => {
    const snapshot = await localSettingsStore.update('updates', { ...patch })
    const { automatic_check, automatic_download, check_interval } = snapshot.value
    if (typeof automatic_check !== 'boolean' || typeof automatic_download !== 'boolean' || !['startup', 'daily', 'weekly'].includes(String(check_interval))) throw new Error('SETTINGS_INVALID_RESPONSE')
    return { automatic_check, automatic_download, check_interval: check_interval as 'startup' | 'daily' | 'weekly', last_checked_at: typeof snapshot.state.last_checked_at === 'string' ? snapshot.state.last_checked_at : null, revision: Number(snapshot.state.preferences_revision) }
  } }
}
