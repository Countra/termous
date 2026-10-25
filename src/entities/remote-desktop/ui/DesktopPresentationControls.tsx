import { useState } from 'react'
import { Button, Modal } from 'antd'
import { SelectControl } from '#shared/ui'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type PresentationSettings, type PresentationState } from '@termous/remote-protocol/presentation'
import { DesktopQualityFields } from './DesktopQualityFields.tsx'
import { DesktopQualityDetails, DesktopQualityField } from './DesktopQualityLayout'
import styles from './DesktopPresentationControls.module.scss'

function qualityStatus(state: PresentationState | undefined, text: (cn: string, en: string) => string) {
  switch (state?.status) {
    case 'failed': return text('设置未生效，请重试。', 'Settings could not be applied. Please retry.')
    case 'uncertain': return text('尚未确认是否生效。', 'Settings are not yet confirmed.')
    case 'preference_sent': return text('设置已发送，以远端支持为准。', 'Settings sent; application depends on remote support.')
    case 'pending': case 'confirming': return text('正在应用设置…', 'Applying settings…')
    case 'confirmed': case 'applied': return text('设置已生效', 'Settings applied')
    default: return text('正在获取设置…', 'Loading settings…')
  }
}

export function DesktopPresentationControls({ state, onChange, resizeAvailable = false, resizeSupported = resizeAvailable, onResize, resolutionStatus, scale, onScale, disabled = false }: {
  state?: PresentationState
  onChange(settings: PresentationSettings): void
  resizeAvailable?: boolean
  resizeSupported?: boolean
  onResize?(width: number, height: number): void
  resolutionStatus?: string
  scale?: 'fit' | 'actual'
  onScale?(value: 'fit' | 'actual'): void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const { i18n } = useTranslation()
  const zh = i18n?.language?.startsWith('zh')
  const text = (cn: string, en: string) => zh ? cn : en
  const title = text('显示与画质', 'Display and quality')
  const caps = state?.capabilities, settings = state?.requested
  const status = qualityStatus(state, text)
  return <>
    <Button size="small" type="text" icon={<Settings2 size={16} />} aria-label={title} title={title} onClick={() => setOpen(true)} />
    <Modal open={open} title={title} width={580} centered onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <div className={`${styles.controls} ${styles.dialog}`}>
        <p className={styles.intro}>{text('仅用于当前会话，不修改默认设置。', 'Applies to this session only. Your defaults stay unchanged.')}</p>
        {(onScale || onResize && resizeSupported) && <div className={styles.panel}>
          {onScale && <DesktopQualityField label={text('显示方式', 'Display mode')}>
            {attributes => <SelectControl {...attributes} value={scale} options={[{ value: 'fit', label: text('适应窗口', 'Fit to window') }, { value: 'actual', label: text('原始大小（100%）', 'Actual size (100%)') }]} onChange={onScale} />}
          </DesktopQualityField>}
          {onResize && resizeSupported && <DesktopQualityField label={text('远端桌面分辨率', 'Remote desktop resolution')} description={!resizeAvailable ? text('桌面就绪并取得控制权后可调整。', 'Available when the desktop is ready and you have control.') : text('会改变远端桌面大小和窗口布局。', 'Changes the remote desktop size and window layout.')}>
            {attributes => <SelectControl {...attributes} placeholder={text('选择分辨率', 'Choose a resolution')} disabled={disabled || !resizeAvailable} options={[{ value: '1280x720', label: '1280 × 720' }, { value: '1920x1080', label: '1920 × 1080' }]} onChange={value => { const [width, height] = value.split('x').map(Number); onResize(width, height) }} />}
          </DesktopQualityField>}
          {resolutionStatus && resolutionStatus !== 'idle' && <p className={styles.status} data-status={resolutionStatus} role="status">{resolutionStatus === 'timeout' ? text('分辨率尚未确认，请检查远端画面。', 'Resolution not confirmed. Check the remote picture.') : resolutionStatus === 'failed' ? text('分辨率更改失败，请重试。', 'Resolution change failed. Please retry.') : text('正在更改分辨率…', 'Changing resolution…')}</p>}
        </div>}
        <div className={styles.panel}>
          {caps && !caps.available && <p className={styles.notice}>{caps.reason === 'desktop_video_reconfigure_unsupported' ? text('远端版本不支持调整，请更新远端 Termous。', 'Update Termous on the remote device to adjust these settings.') : text('暂时无法调整，请等待连接就绪。', 'Settings are unavailable until the connection is ready.')}</p>}
          {settings && caps ? <><DesktopQualityFields settings={settings} capabilities={caps} disabled={disabled} onChange={onChange} />{caps.available && <p className={styles.status} data-status={state?.status} role="status">{status}</p>}</> : <p className={styles.notice}>{text('当前连接不支持画质调整。', 'Quality adjustment is unavailable for this connection.')}</p>}
          {state?.warning && <p className={styles.notice} role="alert">{text('默认设置加载失败，暂用推荐设置。', 'Could not load defaults. Using recommended settings.')}</p>}
          {Boolean(state?.encodedWidth || state?.observed) && <DesktopQualityDetails title={text('连接信息', 'Connection details')}>
            <dl className={styles.statistics}>
              {Boolean(state?.encodedWidth) && <><dt>{text('发送尺寸', 'Sent size')}</dt><dd>{state?.encodedWidth} × {state?.encodedHeight}</dd></>}
              {Boolean(state?.observed?.width) && <><dt>{text('接收尺寸', 'Received size')}</dt><dd>{state?.observed?.width} × {state?.observed?.height}</dd></>}
              {state?.observed?.bitrate !== undefined && <><dt>{text('实际接收速率', 'Receive rate')}</dt><dd>{(state.observed.bitrate / 1_000_000).toFixed(2)} Mbps</dd></>}
              {state?.observed?.framerate !== undefined && <><dt>{text('实际帧率', 'Frame rate')}</dt><dd>{state.observed.framerate} {text('帧／秒', 'fps')}</dd></>}
              {state?.observed?.updateRate !== undefined && <><dt>{text('实际更新频率', 'Update rate')}</dt><dd>{state.observed.updateRate.toFixed(1)} {text('次／秒', 'updates/s')}</dd></>}
            </dl>
          </DesktopQualityDetails>}
        </div>
      </div>
    </Modal>
  </>
}
