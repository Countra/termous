import { Switch } from 'antd'
import { LockKeyhole, Monitor, MousePointer2, ShieldCheck, Shield } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { RemotePolicy } from '#common/contracts'
import styles from './RemoteAccessPanels.module.scss'
import { RemoteAccessHelp } from './RemoteAccessHelp'

export function HostDesktopSharing({ policy, disabled, working, change }: { policy?: RemotePolicy; disabled: boolean; working: boolean; change(observe: boolean, control: boolean, secureCapture: boolean, secureControl: boolean): void }) {
  const { i18n } = useTranslation()
  const zh = i18n.language.startsWith('zh')
  const observe = policy?.host_desktop?.observe === true
  const control = policy?.host_desktop?.control === true
  const secureCapture = policy?.host_desktop?.secure_capture === true
  const secureControl = policy?.host_desktop?.secure_control === true
  return <section className={styles.panel} aria-label={zh ? '设备桌面' : 'Device desktop'}>
    <header className={styles.heading}>
      <h3>{zh ? '设备桌面' : 'Device desktop'}</h3>
    </header>
    <div className={styles['permission-group']}>
      <div className={styles['permission-row']}>
        <span className={styles['resource-icon']}><Monitor size={18} aria-hidden="true" /></span>
        <div className={styles['permission-title']}>
          <h4>{zh ? '观看设备桌面' : 'View this desktop'}</h4>
          <RemoteAccessHelp label={zh ? '观看设备桌面 · 权限说明' : 'View this desktop · Permission details'}>
            <p>{zh ? '包含全部显示器和窗口，以及后续接入的显示器。窗口仅供观看。' : 'All displays and windows, including future displays. Windows are view only.'}</p>
            <p>{zh ? '关闭权限将结束相关桌面访问。' : 'Disabling permissions ends affected desktop access.'}</p>
          </RemoteAccessHelp>
        </div>
        <Switch checked={observe} disabled={disabled} loading={working}
          aria-label={zh ? '允许观看设备桌面' : 'Allow viewing this desktop'}
          onChange={value => change(value, value && control, value && secureCapture, value && secureControl)} />
      </div>
      <div className={styles['permission-row']}>
        <span className={styles['resource-icon']}><MousePointer2 size={18} aria-hidden="true" /></span>
        <div className={styles['permission-title']}>
          <h4>{zh ? '控制鼠标和键盘' : 'Mouse and keyboard control'}</h4>
          <RemoteAccessHelp label={zh ? '控制鼠标和键盘 · 权限说明' : 'Mouse and keyboard control · Permission details'}>
            <p>{zh ? '键盘作用于当前焦点应用，不受所选显示器限制。' : 'Keyboard input affects the focused app, regardless of the selected display.'}</p>
          </RemoteAccessHelp>
        </div>
        <Switch checked={control} disabled={disabled || !observe} loading={working}
          aria-label={zh ? '允许控制鼠标和键盘' : 'Allow mouse and keyboard control'}
          onChange={value => change(observe, value, secureCapture, value && secureControl)} />
      </div>
    </div>
    <h4 className={styles.subheading}><LockKeyhole size={14} aria-hidden="true" />{zh ? '安全桌面' : 'Secure desktops'}</h4>
    <div className={styles['permission-group']}>
      <div className={styles['permission-row']}>
        <span className={styles['resource-icon']}><Shield size={18} aria-hidden="true" /></span>
        <div><h4>{zh ? '观看安全桌面' : 'View secure desktops'}</h4></div>
        <Switch checked={secureCapture} disabled={disabled || !observe} loading={working}
          aria-label={zh ? '允许观看安全桌面' : 'Allow viewing secure desktops'}
          onChange={value => change(observe, control, value, value && secureControl)} />
      </div>
      <div className={styles['permission-row']}>
        <span className={styles['resource-icon']}><ShieldCheck size={18} aria-hidden="true" /></span>
        <div><h4>{zh ? '控制安全桌面' : 'Control secure desktops'}</h4></div>
        <Switch checked={secureControl} disabled={disabled || !control || !secureCapture} loading={working}
          aria-label={zh ? '允许控制安全桌面' : 'Allow secure desktop control'}
          onChange={value => change(observe, control, secureCapture, value)} />
      </div>
    </div>
  </section>
}
