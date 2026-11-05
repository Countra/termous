import { Button, Switch } from 'antd'
import { ShieldCheck } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { settingsErrorCode, useSettingsModule } from '#entities/settings'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import styles from '../controls/SettingsGroup.module.scss'

export function LocalDesktopAccessSettings({ disabled }: { disabled: boolean }) {
  const { i18n, t } = useTranslation()
  const zh = i18n.language.startsWith('zh'), id = useId()
  const module = useSettingsModule('desktop_access', { refreshOnFocus: true })
  const value = module.snapshot?.value
  const locked = disabled || module.busy || !module.available || module.snapshot?.state.status === 'unavailable'
    || typeof value?.secure_capture !== 'boolean' || typeof value?.secure_control !== 'boolean'
  return <SettingsGroup title={zh ? '本地自动化桌面权限' : 'Local automation desktop access'} icon={<ShieldCheck size={16} />}>
    <SettingsField descriptionId={`${id}-capture-hint`} htmlFor={`${id}-capture`} label={zh ? '允许观看安全桌面' : 'Allow viewing secure desktops'}
      description={zh ? '仅用于本地工作流。远控、MCP 和 Agent 使用各自的授权设置。' : 'Applies to local workflows. Remote control, MCP and Agent use their own access settings.'}
      control={<Switch id={`${id}-capture`} checked={value?.secure_capture === true} disabled={locked} loading={module.busy}
        onChange={enabled => { if (!locked) void module.update({ secure_capture: enabled, secure_control: enabled && value?.secure_control === true }) }} />} />
    <SettingsField descriptionId={`${id}-control-hint`} htmlFor={`${id}-control`} label={zh ? '允许控制安全桌面和提升权限的窗口' : 'Allow secure desktop and elevated window control'}
      description={zh ? '仍需有效控制授权；切换后必须重新观察，旧动作不会重放。' : 'A valid control grant is still required. Transitions require a fresh observation; previous actions are never replayed.'}
      control={<Switch id={`${id}-control`} checked={value?.secure_control === true} disabled={locked || value?.secure_capture !== true} loading={module.busy}
        onChange={enabled => { if (!locked) void module.update({ secure_capture: true, secure_control: enabled }) }} />} />
    {module.error && <p role="alert" className={styles.error}>
      {settingsErrorCode(module.error) === 'SETTINGS_REVISION_CONFLICT' ? t('settings.conflict') : zh ? '桌面权限更新失败' : 'Desktop access update failed'}
      <Button type="link" disabled={disabled || module.busy} onClick={() => void module.refresh()}>{t('app.retry')}</Button>
    </p>}
  </SettingsGroup>
}
