import { Button, Segmented, Select, Tooltip } from 'antd'
import { Maximize2, RefreshCw, Scaling } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesktopScaleMode, RemoteDesktopViewerState } from '#features/remote-desktop'
import styles from './RemoteDesktopDisplayControls.module.scss'

export function RemoteDesktopDisplayControls({ state, onScale, onFollow }: {
  state?: RemoteDesktopViewerState
  onScale(mode: DesktopScaleMode): void
  onFollow(value: boolean): void
}) {
  const { t } = useTranslation()
  const resolution = state?.resolution
  const status = resolution?.status ?? 'idle'
  const fixed = resolution?.fixed
  const size = resolution?.size
  const retryable = status === 'failed' || status === 'timeout'
  return <div className={styles.controls}>
    <Segmented<DesktopScaleMode> size="small" value={state?.displayMode ?? 'fit'}
      aria-label={t('remoteDesktop.display.scale')}
      options={[
        { value: 'fit', label: <Tooltip title={t('remoteDesktop.display.fitHint')}><span className={styles.mode}><Scaling size={14} /><span>{t('remoteDesktop.display.fit')}</span></span></Tooltip> },
        { value: 'actual', label: <Tooltip title={t('remoteDesktop.display.actualHint')}><span className={styles.mode}><Maximize2 size={14} /><span>{t('remoteDesktop.display.actual')}</span></span></Tooltip> },
      ]} onChange={onScale} />
    <Tooltip title={t('remoteDesktop.display.resolutionHint')}>
      <Select size="small" className={styles.resolution} aria-label={t('remoteDesktop.display.resolution')}
        value={state?.followWindow ? 'follow' : 'fixed'}
        disabled={state?.connection !== 'connected'}
        options={[
          { value: 'fixed', label: `${t('remoteDesktop.display.fixed')}${fixed ? ` ${fixed.width}×${fixed.height}` : ''}` },
          { value: 'follow', label: t('remoteDesktop.display.resize'), disabled: resolution?.supported !== true && !state?.followWindow },
        ]} onChange={value => onFollow(value === 'follow')} />
    </Tooltip>
    {status !== 'idle' ? <Tooltip title={t(`remoteDesktop.display.${status}Hint`)}>
      <span className={styles.status} role="status">{t(`remoteDesktop.display.${status}`)}</span>
    </Tooltip> : size ? <span className={styles.size}>{size.width}×{size.height}</span> : null}
    {retryable && <Tooltip title={t('remoteDesktop.display.retry')}><Button type="text" size="small"
      disabled={state?.connection !== 'connected'} aria-label={t('remoteDesktop.display.retry')}
      icon={<RefreshCw size={14} />} onClick={() => onFollow(state?.followWindow ?? false)} /></Tooltip>}
  </div>
}
