import { useId } from 'react'
import { MonitorPlay } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ConnectionPreferences, ConnectionPreference } from '@termous/remote-protocol/presentation'
import { SelectControl } from '#shared/ui'
import { SettingsField, SettingsGroup } from '../controls/SettingsGroup'
import styles from './PresentationDefaultsSettings.module.scss'

export function RdpDesktopEffectsSettings({ value, disabled, onChange }: {
  value: ConnectionPreferences
  disabled: boolean
  onChange(value: ConnectionPreferences): void
}) {
  const id = useId()
  const { i18n } = useTranslation()
  const text = (cn: string, en: string) => i18n?.language?.startsWith('zh') ? cn : en
  return <SettingsGroup title={text('RDP 桌面效果', 'RDP desktop effects')} icon={<MonitorPlay size={16} aria-hidden="true" />}>
    <p className={styles.hint}>{text('仅适用于 RDP，重新连接后生效，以服务器支持为准。', 'Applies to RDP after reconnecting, subject to server support.')}</p>
    {([
      ['fontSmoothing', '文字平滑', 'Font smoothing', '改善文字边缘显示。', 'Smooth the edges of text.'],
      ['wallpaper', '桌面壁纸', 'Desktop wallpaper', '显示远端桌面壁纸。', 'Show the remote desktop wallpaper.'],
      ['fullWindowDrag', '拖动时显示窗口内容', 'Show window contents while dragging', '拖动窗口时持续显示其内容。', 'Keep window contents visible while dragging.'],
      ['menuAnimations', '菜单动画', 'Menu animations', '显示菜单展开和收起动画。', 'Animate menus when opening and closing.'],
    ] as const).map(([key, cn, en, hintCn, hintEn]) => <SettingsField key={key} htmlFor={`${id}-${key}`} label={text(cn, en)}
      description={text(hintCn, hintEn)} descriptionId={`${id}-${key}-hint`}
      control={<SelectControl id={`${id}-${key}`} aria-describedby={`${id}-${key}-hint`} disabled={disabled} value={value[key]} options={[
        { value: 'inherit', label: text('使用默认', 'Use default') }, { value: 'enabled', label: text('开启', 'On') }, { value: 'disabled', label: text('关闭', 'Off') },
      ]} onChange={(preference: ConnectionPreference) => onChange({ ...value, [key]: preference })} />} />)}
  </SettingsGroup>
}
