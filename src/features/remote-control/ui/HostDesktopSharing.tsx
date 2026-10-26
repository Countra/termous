import { Switch } from 'antd'
import { Monitor, MousePointer2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemotePolicy } from '#common/contracts'
import styles from './RemoteAccessDialog.module.scss'

export function HostDesktopSharing({ policy, disabled, working, change }: { policy?: RemotePolicy; disabled: boolean; working: boolean; change(observe: boolean, control: boolean): void }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const observe = policy?.host_desktop?.observe === true
  const control = policy?.host_desktop?.control === true
  return <section className={styles.panel}>
    <div className={styles['agent-control']}>
      <Monitor size={22} /><div><h3>{zh ? '允许观看设备桌面' : 'Allow viewing this desktop'}</h3></div>
      <Switch checked={observe} disabled={disabled} loading={working} aria-label={zh ? '允许观看设备桌面' : 'Allow viewing this desktop'} onChange={value => change(value, value && control)} />
    </div>
    <div className={styles['agent-control']}>
      <MousePointer2 size={22} /><div><h3>{zh ? '允许控制鼠标和键盘' : 'Allow mouse and keyboard control'}</h3></div>
      <Switch checked={control} disabled={disabled || !observe} loading={working} aria-label={zh ? '允许控制鼠标和键盘' : 'Allow mouse and keyboard control'} onChange={value => change(observe, value)} />
    </div>
    <dl className={styles.scope}>
      <div><dt>{zh ? '共享范围' : 'Scope'}</dt><dd>{zh ? '同账号设备可访问全部显示器和窗口，包括以后接入的显示器。窗口仅供观看。' : 'Devices on this account can access all displays and windows, including newly connected displays. Windows are view only.'}</dd></div>
      <div><dt>{zh ? '控制影响' : 'Input'}</dt><dd>{zh ? '键盘操作影响当前焦点应用，选择显示器不会限制应用范围。关闭权限会结束正在进行的桌面访问。' : 'Keyboard input affects the focused app. Selecting a display does not isolate apps. Disabling access ends current desktop visits.'}</dd></div>
    </dl>
  </section>
}
