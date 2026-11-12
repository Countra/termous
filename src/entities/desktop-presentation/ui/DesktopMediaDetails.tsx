import { ChevronRight, MonitorPlay } from 'lucide-react'
import { h264LevelLabel } from '@termous/remote-protocol/presentation'
import type { RemoteDesktopMediaDetails } from '#entities/remote-desktop'
import { desktopMediaMetrics, formatMediaBitrate } from '../model/mediaMetrics'
import styles from './DesktopMediaDetails.module.scss'

export function DesktopMediaDetails({ value, zh }: { value: RemoteDesktopMediaDetails; zh: boolean }) {
  const label = (cn: string, en: string) => zh ? cn : en
  const p = value.presentation, negotiated = p?.codec?.negotiated, applied = p?.codec?.applied
  const metrics = desktopMediaMetrics(value, zh), sample = metrics.sample
  const video = value.transport === 'h264'
  const path = (v?: string) => v === 'direct' ? 'P2P' : v === 'relay' ? 'TURN' : label('待确认', 'Unconfirmed')
  const confirmed = value.phase === 'viewing' && (p?.stability
    ? p.stability.decodeEpoch > 0n && p.stability.confirmedDecodeEpoch === p.stability.decodeEpoch
    : p?.status === 'confirmed' && applied?.configRevision === p.configRevision)
  const limits: Record<string, string> = {
    user_limit: label('用户上限', 'User limit'), encoding_limit: label('协商或编码能力', 'Negotiated or encoder limit'),
    transport_limit: label('媒体路径限制', 'Media path limit'), network_estimate: label('GCC 网络预算', 'GCC network budget'),
    receiver_feedback: label('接收端丢包／抖动反馈', 'Receiver loss/jitter feedback'), local_delivery: label('主机交付背压', 'Host delivery backpressure'),
  }
  return <section className={styles.panel} aria-label={label('桌面媒体', 'Desktop media')}>
    <header className={styles.heading}>
      <span className={styles.icon}><MonitorPlay size={17} aria-hidden="true" /></span>
      <div><span className={styles.eyebrow}>{label('桌面媒体', 'Desktop media')}</span><strong title={value.title}>{value.title}</strong></div>
      <span className={styles.badge}>{video ? 'H.264' : 'RFB'}</span>
    </header>
    <dl className={styles.metrics}>
      <Metric label={label('往返延迟', 'Round-trip latency')} value={metrics.latency} />
      {video ? <><Metric label={label('接收码率', 'Receive bitrate')} value={metrics.bitrate} /><Metric label={label('解码帧率', 'Decoded frame rate')} value={metrics.framerate} /></> : null}
    </dl>
    <dl className={styles.rows}>
      <Metric label={label('媒体路径', 'Media path')} value={metrics.path} />
      <Metric label={label('传输协议', 'Transport')} value={sample?.protocol?.toUpperCase() ?? '—'} />
      <Metric label={label('TURN 接入（本机）', 'TURN access (local)')} value={metrics.localRelayProtocol} />
      {video ? <>
        <Metric label={label('画面尺寸', 'Picture size')} value={metrics.resolution} />
        <Metric label={label('丢包 / 抖动', 'Loss / jitter')} value={`${sample?.lossPerMille === undefined ? '—' : `${(sample.lossPerMille / 10).toFixed(1)}%`} / ${sample?.jitterMs === undefined ? '—' : `${sample.jitterMs.toFixed(1)} ms`}`} />
        <Metric label={label('画面确认', 'Picture confirmation')} value={confirmed ? label('已确认', 'Confirmed') : label('未确认', 'Unconfirmed')} />
      </> : null}
    </dl>
    {video ? <details className={styles.advanced}>
      <summary><ChevronRight size={14} aria-hidden="true" />{label('编码与诊断', 'Encoding and diagnostics')}</summary>
      <dl className={styles.rows}>
        <Metric label={label('传输与编码', 'Transport / codec')} value={negotiated ? 'WebRTC / H.264 Constrained Baseline' : 'WebRTC / H.264'} />
        {p?.stability?.target ? <>
          <Metric label={label('固定会话目标', 'Fixed session target')} value={`${p.stability.target.width} × ${p.stability.target.height} · ${p.stability.target.framerate} fps · Level ${h264LevelLabel(p.stability.level)}`} />
          <Metric label={label('GCC 网络估计', 'GCC network estimate')} value={formatMediaBitrate(p.stability.networkEstimate || undefined)} />
          <Metric label={label('发送帧率', 'Sent frame rate')} value={p.stability.outputFramerate === undefined ? '—' : `${p.stability.outputFramerate.toFixed(1)} fps`} />
          <Metric label={label('码率限制原因', 'Bitrate limit')} value={limits[p.stability.bitrateLimitReason ?? ''] ?? '—'} />
        </> : null}
        <Metric label={label('接收声明上限', 'Receiver declaration')} value={h264LevelLabel(negotiated?.receiverLevel)} />
        <Metric label={label('协商上限', 'Negotiated ceiling')} value={h264LevelLabel(negotiated?.negotiatedLevel)} />
        <Metric label={label('已应用编码等级', 'Applied encoder level')} value={h264LevelLabel(applied?.level)} />
        <Metric label={label('发送端路径策略', 'Sender path policy')} value={`${path(p?.transport?.path)} · ${formatMediaBitrate(p?.transport?.bitrateLimit)}`} />
        <Metric label={label('用户 / 协商码率上限', 'User / negotiated bitrate limit')} value={`${formatMediaBitrate(p?.requested?.kind === 'video' ? p.requested.bitrate : undefined)} / ${formatMediaBitrate(p?.capabilities.maxBitrate)}`} />
        <Metric label={label('编码预算', 'Encoding budget')} value={p?.applied ? `${p.applied.width} × ${p.applied.height} · ${p.applied.framerate} fps · ${formatMediaBitrate(p.applied.bitrate)}` : '—'} />
        <Metric label="profile-level-id" value={negotiated?.profileLevelId ?? '—'} />
        <Metric label={label('视频能力版本', 'Video capability version')} value={String(p?.capabilities.videoLimitsVersion || '—')} />
        <Metric label={label('编码 / 画面版本', 'Encoder / picture revision')} value={`${applied?.configRevision ?? '—'} / ${p?.configRevision ?? '—'}`} />
        <Metric label={label('接收策略', 'Receiver policy')} value={!value.receiver ? '—' : value.receiver.policy === 'prefer_level_51' ? label('优先 5.1', 'Prefer 5.1') : label('原生声明', 'Native declaration')} />
        <Metric label={label('原生声明等级', 'Native declared levels')} value={value.receiver?.nativeLevels.map(h264LevelLabel).join(', ') || '—'} />
        <Metric label={label('回退 / 配置诊断', 'Fallback / configuration diagnostic')} value={value.receiver?.fallbackReason || p?.error || p?.capabilities.reason || '—'} />
      </dl>
    </details> : <p className={styles.note}>WebRTC DataChannel / RFB</p>}
  </section>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>
}
