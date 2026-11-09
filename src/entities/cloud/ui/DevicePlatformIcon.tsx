import type { CSSProperties } from 'react'
import { Tooltip } from 'antd'
import { MonitorSmartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { devicePlatformNames, normalizeDevicePlatform } from '../model/devicePlatform'
import windows from '../assets/platforms/windows.svg'
import linux from '../assets/platforms/linux.svg'
import apple from '../assets/platforms/apple.svg'
import android from '../assets/platforms/android.svg'
import styles from './DevicePlatformIcon.module.scss'

const icons = { windows, linux, darwin: apple, android }

export function DevicePlatformIcon({ platform, size = 18 }: { platform?: string; size?: number }) {
  const { t } = useTranslation()
  const value = normalizeDevicePlatform(platform)
  const label = value === 'unknown' ? t('cloud.unknownPlatform') : devicePlatformNames[value]
  return <Tooltip title={label}>
    <span className={styles.icon} role="img" aria-label={label} style={{ width: size, height: size }}>
      {value === 'unknown' ? <MonitorSmartphone size={size} aria-hidden="true" /> : <span className={styles.glyph} aria-hidden="true" style={{ '--platform-icon': `url("${icons[value]}")` } as CSSProperties} />}
    </span>
  </Tooltip>
}
