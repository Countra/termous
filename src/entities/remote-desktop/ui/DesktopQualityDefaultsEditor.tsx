import { useState } from 'react'
import { ManagementFilterTabs, SelectControl } from '#shared/ui'
import { useTranslation } from 'react-i18next'
import { presentationDefaults, presentationPresetName, type PresentationDefaults, type PresentationPreset, type ConnectionPreference } from '@termous/remote-protocol/presentation'
import { DesktopQualityFields } from './DesktopQualityFields.tsx'
import { DesktopQualityDetails, DesktopQualityField } from './DesktopQualityLayout'
import styles from './DesktopPresentationControls.module.scss'

export function DesktopQualityDefaultsEditor({ value, disabled, onChange }: { value: PresentationDefaults; disabled: boolean; onChange(value: PresentationDefaults): void }) {
  const { i18n } = useTranslation()
  const [section, setSection] = useState<'pixels' | 'video' | 'rfb'>('pixels')
  const text = (cn: string, en: string) => i18n?.language?.startsWith('zh') ? cn : en
  const presets = [value.pixels, value.video, value.rfb].map(presentationPresetName)
  const preset = presets.every(p => p === presets[0]) ? presets[0] : 'custom'
  const sections = [
    { kind: 'pixels', title: text('本机 RDP', 'Local RDP'), description: text('在本机直接连接 RDP 桌面时使用。', 'For RDP desktops connected directly from this device.') },
    { kind: 'video', title: text('远控 RDP', 'Remote RDP'), description: text('经另一台设备查看 RDP 桌面时使用。', 'For RDP desktops viewed through another device.') },
    { kind: 'rfb', title: 'VNC', description: text('本机连接与远控通用，以远端支持为准。', 'For local and remote viewing, subject to remote support.') },
  ] as const
  return <div className={styles.controls}>
    <DesktopQualityField label={text('显示方案', 'Display preset')} description={text('自动保存，仅用于新连接。', 'Saves automatically. Applies to new connections only.')}>
      {attributes => <SelectControl {...attributes} disabled={disabled} value={preset} options={[
        { value: 'clear', label: text('清晰优先', 'Clear') }, { value: 'balanced', label: text('均衡', 'Balanced') }, { value: 'economy', label: text('省资源', 'Resource saving') }, { value: 'custom', label: text('自定义', 'Custom'), disabled: true },
      ]} onChange={preset => onChange({ ...presentationDefaults(preset as PresentationPreset), connection: value.connection })} />}
    </DesktopQualityField>
    <div className={styles['connection-settings']}>
      <div className={styles['section-heading']}>
        <h4>{text('连接参数', 'Connection settings')}</h4>
      </div>
      <ManagementFilterTabs aria-label={text('连接方式', 'Connection type')} activeKey={section}
        items={sections.map(item => ({ key: item.kind, label: item.title }))}
        onChange={key => setSection(key as typeof section)} />
      {sections.filter(item => item.kind === section).map(({ kind, title, description }) => <section key={kind} aria-label={title}>
        <p className={styles['connection-hint']}>{description}</p>
        <DesktopQualityFields settings={value[kind]} capabilities={{ kind, available: true, dynamicSize: true, maxHeight: 1080 }} showPreset={false} commitOnBlur disabled={disabled} onChange={settings => onChange({ ...value, [kind]: settings })} />
      </section>)}
    </div>
    <DesktopQualityDetails title={text('RDP 桌面效果', 'RDP desktop effects')} description={text('重新连接后生效，以远端支持为准。', 'Applies after reconnecting, subject to remote support.')}>
      <div className={styles.effects}>
      {([['fontSmoothing', '文字平滑', 'Font smoothing'], ['wallpaper', '桌面壁纸', 'Desktop wallpaper'], ['fullWindowDrag', '拖动时显示窗口内容', 'Show window contents while dragging'], ['menuAnimations', '菜单动画', 'Menu animations']] as const).map(([key, cn, en]) => <DesktopQualityField key={key} label={text(cn, en)}>
        {attributes => <SelectControl {...attributes} disabled={disabled} value={value.connection[key]} options={[
          { value: 'inherit', label: text('使用默认', 'Use default') }, { value: 'enabled', label: text('开启', 'On') }, { value: 'disabled', label: text('关闭', 'Off') },
        ]} onChange={(preference: ConnectionPreference) => onChange({ ...value, connection: { ...value.connection, [key]: preference } })} />}
      </DesktopQualityField>)}
      </div>
    </DesktopQualityDetails>
  </div>
}
