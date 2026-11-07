import { useState } from 'react'
import { Button, Modal } from 'antd'
import { SelectControl } from '#shared/ui'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { type PresentationSettings, type PresentationState } from '@termous/remote-protocol/presentation'
import { DesktopQualityFields } from './DesktopQualityFields.tsx'
import { DesktopStabilityNotice } from './DesktopStabilityNotice.tsx'
import { DesktopQualityDetails, DesktopQualityField } from './DesktopQualityLayout'
import styles from './DesktopPresentationControls.module.scss'

function qualityStatus(state: PresentationState | undefined, text: (cn: string, en: string) => string) {
  switch (state?.status) {
    case 'failed':
      if (state.error === 'desktop_video_decode_timeout') return text('新画面确认超时，已请求恢复原画质。', 'The new picture was not confirmed in time. Restoring the previous quality.')
      if (['desktop_video_configuration_failed', 'rdp_video_reconfigure_failed'].includes(state.error ?? '')) return text('画质切换失败，已请求恢复原画质。', 'Quality switching failed. Restoring the previous quality.')
      return text('设置未生效，请重试。', 'Settings could not be applied. Please retry.')
    case 'uncertain': return text('尚未确认是否生效。', 'Settings are not yet confirmed.')
    case 'preference_sent': return text('设置已发送，以远端支持为准。', 'Settings sent; application depends on remote support.')
    case 'pending': case 'confirming': return text('正在应用设置…', 'Applying settings…')
    case 'confirmed': case 'applied': return text('设置已生效', 'Settings applied')
    default: return text('正在获取设置…', 'Loading settings…')
  }
}

export function DesktopPresentationControls({ state, sessionKey = '', onChange, resizeAvailable = false, resizeSupported = resizeAvailable, onResize, resolutionStatus, scale, onScale, disabled = false }: {
  state?: PresentationState
  sessionKey?: string
  onChange(settings: PresentationSettings, retryTarget?: boolean): void
  resizeAvailable?: boolean
  resizeSupported?: boolean
  onResize?(width: number, height: number): void
  resolutionStatus?: string
  scale?: 'fit' | 'actual'
  onScale?(value: 'fit' | 'actual'): void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  // 忽略状态保留在弹窗之外，不同会话和新建议不能继承旧的选择。
  const [dismissed, setDismissed] = useState('')
  const adviceKey = `${sessionKey}:${state?.stability?.adviceRevision}:${state?.stability?.phase}`
  const showAdvice = dismissed !== adviceKey && Boolean(state?.stability?.pressure || state?.stability?.phase === 'attention')
  const { i18n } = useTranslation()
  const zh = i18n?.language?.startsWith('zh')
  const text = (cn: string, en: string) => zh ? cn : en
  const title = text('显示与画质', 'Display and quality')
  const caps = state?.capabilities, settings = state?.requested
  const status = qualityStatus(state, text)
  return <>
    <Button size="small" type="text" icon={<Settings2 size={16} />} aria-label={title} title={title} onClick={() => setOpen(true)}>{showAdvice && (caps?.videoQualityVersion !== 1 || state?.stability?.phase === 'attention') ? text('画质需确认', 'Quality needs attention') : null}</Button>
    <Modal open={open} title={title} width={580} centered onCancel={() => setOpen(false)} footer={null} destroyOnHidden>
      <div className={`${styles.controls} ${styles.dialog}`}>
        <p className={styles.intro}>{text('仅用于当前会话，不修改默认设置。', 'Applies to this session only. Your defaults stay unchanged.')}</p>
        {(onScale || onResize && resizeSupported) && <div className={styles.panel}>
          {caps?.videoQualityVersion === 1 && <p className={styles.intro}>{text('优先保留清晰度，必要时临时降低帧率或尺寸；条件改善后自动恢复目标。', 'Clarity comes first. Frame rate or size may temporarily decrease and recover automatically.')}</p>}
          {onScale && <DesktopQualityField label={text('显示方式', 'Display mode')}>
            {attributes => <SelectControl {...attributes} value={scale} options={[{ value: 'fit', label: text('适应窗口', 'Fit to window') }, { value: 'actual', label: text('原始大小（100%）', 'Actual size (100%)') }]} onChange={onScale} />}
          </DesktopQualityField>}
          {onResize && resizeSupported && <DesktopQualityField label={text('远端桌面分辨率', 'Remote desktop resolution')} description={!resizeAvailable ? text('桌面就绪并取得控制权后可调整。', 'Available when the desktop is ready and you have control.') : text('会改变远端桌面大小和窗口布局。', 'Changes the remote desktop size and window layout.')}>
            {attributes => <SelectControl {...attributes} placeholder={text('选择分辨率', 'Choose a resolution')} disabled={disabled || !resizeAvailable} options={[{ value: '1280x720', label: '1280 × 720' }, { value: '1920x1080', label: '1920 × 1080' }]} onChange={value => { const [width, height] = value.split('x').map(Number); onResize(width, height) }} />}
          </DesktopQualityField>}
          {resolutionStatus && resolutionStatus !== 'idle' && <p className={styles.status} data-status={resolutionStatus} role="status">{resolutionStatus === 'timeout' ? text('分辨率尚未确认，请检查远端画面。', 'Resolution not confirmed. Check the remote picture.') : resolutionStatus === 'failed' ? text('分辨率更改失败，请重试。', 'Resolution change failed. Please retry.') : text('正在更改分辨率…', 'Changing resolution…')}</p>}
        </div>}
        <div className={styles.panel}>
          {showAdvice && <DesktopStabilityNotice state={state} onChange={onChange} onDismiss={() => setDismissed(adviceKey)} disabled={disabled} zh={Boolean(zh)} />}
          {caps && !caps.available && <p className={styles.notice}>{caps.reason === 'desktop_video_reconfigure_unsupported' ? text('远端版本不支持调整，请更新远端 Termous。', 'Update Termous on the remote device to adjust these settings.') : text('暂时无法调整，请等待连接就绪。', 'Settings are unavailable until the connection is ready.')}</p>}
          {settings && caps ? <><DesktopQualityFields settings={settings} capabilities={caps} disabled={disabled} onChange={onChange} />{caps.available && <p className={styles.status} data-status={state?.status} role="status">{status}</p>}</> : <p className={styles.notice}>{text('当前连接不支持画质调整。', 'Quality adjustment is unavailable for this connection.')}</p>}
          {state?.warning && <p className={styles.notice} role="alert">{state.warning === 'desktop_video_receiver_limited' ? text('本次观看已按接收端能力降低上限，原画质偏好仍保留。', 'This receiver requires lower limits. Your quality preference is preserved.') : text('默认设置加载失败，暂用推荐设置。', 'Could not load defaults. Using recommended settings.')}</p>}
          {Boolean(state?.encodedWidth || state?.observed || state?.transport) && <DesktopQualityDetails title={text('连接信息', 'Connection details')}>
            <dl className={styles.statistics}>
              {state?.stability?.target && <><dt>{text('用户目标规格', 'Requested profile')}</dt><dd>{state.stability.target.width} × {state.stability.target.height} · {state.stability.target.framerate} fps</dd></>}
              {settings?.kind === 'video' && <><dt>{text('用户码率上限', 'Requested bitrate limit')}</dt><dd>{settings.bitrate / 1_000_000} Mbps</dd></>}
              {caps?.kind === 'video' && <><dt>{text('协商码率上限', 'Negotiated bitrate limit')}</dt><dd>{(caps.maxBitrate ?? 8_000_000) / 1_000_000} Mbps</dd></>}
              {state?.transport && <><dt>{text('媒体路径', 'Media path')}</dt><dd>{state.transport.path === 'direct' ? text('P2P 直连', 'P2P direct') : state.transport.path === 'relay' ? text('中继', 'Relay') : text('待确认', 'Unconfirmed')}</dd><dt>{text('路径码率上限', 'Path bitrate limit')}</dt><dd>{state.transport.bitrateLimit / 1_000_000} Mbps</dd></>}
              {Boolean(state?.encodedWidth) && <><dt>{text('发送尺寸', 'Sent size')}</dt><dd>{state?.encodedWidth} × {state?.encodedHeight}</dd></>}
              {caps?.kind === 'video' && <><dt>{text('协商帧率上限', 'Negotiated frame rate limit')}</dt><dd>{caps.maxFramerate ?? 30} fps</dd></>}
              {state?.applied && <><dt>{text('当前编码预算', 'Current encoder budget')}</dt><dd>{state.applied.framerate} fps · {(state.applied.bitrate / 1_000_000).toFixed(2)} Mbps</dd></>}
              {Boolean(caps?.sourceWidth) && <><dt>{text('来源尺寸', 'Source size')}</dt><dd>{caps?.sourceWidth} × {caps?.sourceHeight}</dd></>}
              {Boolean(caps?.sourceRefreshRate) && <><dt>{text('来源刷新率', 'Source refresh rate')}</dt><dd>{caps?.sourceRefreshRate?.toFixed(2)} Hz</dd></>}
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
