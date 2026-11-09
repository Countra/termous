import { useTranslation } from 'react-i18next'
import { videoDefaultCapabilities, type PresentationDefaults } from '@termous/remote-protocol/presentation'
import { DesktopQualityFields } from './DesktopQualityFields.tsx'
import { DesktopQualityDetails } from './DesktopQualityLayout'
import styles from './DesktopPresentationControls.module.scss'

export function DesktopQualityDefaultsEditor({ value, disabled, onChange }: { value: PresentationDefaults; disabled: boolean; onChange(value: PresentationDefaults): void }) {
  const { i18n } = useTranslation()
  const text = (cn: string, en: string) => i18n?.language?.startsWith('zh') ? cn : en
  const sections = [
    { kind: 'pixels', title: text('RDP 直接观看', 'Direct RDP viewing'), description: text('用于从本设备连接的 RDP 桌面，含 SSH 隧道连接。', 'For RDP connections from this device, including SSH tunnels.') },
    { kind: 'rfb', title: text('VNC 画面', 'VNC picture'), description: text('用于 VNC 桌面，效果取决于服务器支持。', 'For VNC desktops. Results depend on server support.') },
  ] as const
  return <div className={styles.controls}>
    <section aria-label={text('远程控制画面', 'Remote control picture')}>
      <h4 className={styles['defaults-heading']}>{text('远程控制画面', 'Remote control picture')}</h4>
      <p className={styles['section-hint']}>{text('用于设备桌面及远控中的 RDP 画面。', 'For device desktops and RDP viewed through another device.')}</p>
      <DesktopQualityFields settings={value.video} capabilities={videoDefaultCapabilities} commitOnBlur disabled={disabled} onChange={settings => onChange({ ...value, [settings.kind]: settings })} />
    </section>
    {sections.map(({ kind, title, description }) => <DesktopQualityDetails key={kind} title={title} description={description}>
      <section aria-label={title}>
        <DesktopQualityFields settings={value[kind]} capabilities={{ kind, available: true, dynamicSize: true }} commitOnBlur disabled={disabled} onChange={settings => onChange({ ...value, [kind]: settings })} />
      </section>
    </DesktopQualityDetails>)}
  </div>
}
