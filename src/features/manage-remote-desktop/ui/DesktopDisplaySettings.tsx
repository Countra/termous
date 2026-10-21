import { Segmented, Switch } from 'antd'
import { Maximize2, MonitorCog, Scaling, Scan } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteDesktopDisplayMode } from '#entities/remote-desktop'
import { ProfileEditorSectionHeading } from '#shared/ui'
import styles from './DesktopProfileForm.module.scss'
import controls from './DesktopProfileControls.module.scss'

interface Toggle {
  key: string
  title: string
  hint: string
  checked: boolean
  onChange: (value: boolean) => void
}
interface Props {
  mode: RemoteDesktopDisplayMode
  hint: string
  disabled: boolean
  onChange: (mode: RemoteDesktopDisplayMode) => void
  toggles: Toggle[]
  children?: ReactNode
}

export function DesktopDisplaySettings({ mode, hint, disabled, onChange, toggles, children }: Props) {
  const { t } = useTranslation()
  const id = useId()
  return <section className={`${styles.section} ${styles['viewer-section']}`} aria-labelledby={`${id}-title`}>
    <ProfileEditorSectionHeading
      classNames={styles} id={`${id}-title`}
      icon={<MonitorCog size={16} />} title={t('remoteDesktop.viewerSection')}
    />
    <div className={styles['viewer-layout']}>
      <div className={styles['mode-setting']}>
        <span className={styles['setting-copy']}>
          <strong>{t('remoteDesktop.displayMode')}</strong>
          <small id={`${id}-hint`}>{hint}</small>
        </span>
        <Segmented<RemoteDesktopDisplayMode>
          name={`${id}-display-mode`} block className={controls.control}
          value={mode} disabled={disabled}
          aria-label={t('remoteDesktop.displayMode')}
          aria-describedby={`${id}-hint`}
          options={[
            { value: 'fit', label: t('remoteDesktop.display.fit'), icon: <Scaling size={13} aria-hidden="true" /> },
            { value: 'resize', label: t('remoteDesktop.display.resize'), icon: <Scan size={13} aria-hidden="true" /> },
            { value: 'actual', label: t('remoteDesktop.display.actual'), icon: <Maximize2 size={13} aria-hidden="true" /> },
          ]}
          onChange={onChange}
        />
        {children}
      </div>
      <div className={styles['behavior-settings']}>
        {toggles.map(toggle => <label key={toggle.key} className={styles['switch-setting']}>
          <span><strong>{toggle.title}</strong><small id={`${id}-${toggle.key}`}>{toggle.hint}</small></span>
          <Switch
            checked={toggle.checked} disabled={disabled}
            aria-label={toggle.title} aria-describedby={`${id}-${toggle.key}`}
            onChange={toggle.onChange}
          />
        </label>)}
      </div>
    </div>
  </section>
}
