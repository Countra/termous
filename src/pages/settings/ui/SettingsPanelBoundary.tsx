import { useCallback, type ReactNode } from 'react'
import { SettingsEditorContext, type SettingsEditor } from '#entities/settings'
import type { SettingsPageTabKey } from '../model/registry'

export function SettingsPanelBoundary({ id, active, children, onChange }: {
  id: SettingsPageTabKey
  active: boolean
  children: ReactNode
  onChange(id: SettingsPageTabKey, editor: SettingsEditor | null): void
}) {
  const register = useCallback((editor: SettingsEditor | null) => onChange(id, editor), [id, onChange])
  return <div role="tabpanel" id={`settings-panel-${id}`} aria-labelledby={`settings-tab-${id}`} aria-hidden={!active} hidden={!active} inert={!active}>
    <SettingsEditorContext.Provider value={register}>{children}</SettingsEditorContext.Provider>
  </div>
}
