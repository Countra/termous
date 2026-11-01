import { Descriptions } from 'antd'
import type { RemoteDesktopMediaDetails } from '#entities/remote-desktop'
import { h264LevelLabel } from '@termous/remote-protocol/presentation'

export function RemoteMediaDetails({ value, zh }: { value: RemoteDesktopMediaDetails; zh: boolean }) {
  const label = (cn: string, en: string) => zh ? cn : en
  const p = value.presentation, n = p?.codec?.negotiated, applied = p?.codec?.applied, s = value.sample
  const bitrate = (n?: number) => n === undefined ? '—' : `${(n / 1_000_000).toFixed(2)} Mbps`
  const path = (v?: string) => v === 'direct' ? 'P2P' : v === 'relay' ? 'TURN' : label('未知', 'Unknown')
  const rows = [
    [label('当前桌面媒体', 'Current desktop media'), value.title],
    [label('传输与编码', 'Transport / codec'), value.transport === 'rfb' ? 'WebRTC DataChannel / RFB' : n ? 'WebRTC / H.264 Constrained Baseline' : 'WebRTC / H.264'],
    ...(value.transport === 'h264' ? [
      ...(p?.stability?.target ? [[label('固定会话目标', 'Fixed session target'), `${p.stability.target.width} × ${p.stability.target.height} · ${p.stability.target.framerate} fps · Level ${h264LevelLabel(p.stability.level)}`],
        [label('GCC 网络估计', 'GCC network estimate'), bitrate(p.stability.networkEstimate || undefined)],
        [label('实际发送帧率', 'Actual sent FPS'), p.stability.outputFramerate === undefined ? '—' : `${p.stability.outputFramerate.toFixed(1)} fps`],
        [label('码率限制原因', 'Bitrate limit'), ({user_limit:label('用户上限','User limit'),encoding_limit:label('协商或编码能力','Negotiated or encoder limit'),transport_limit:label('媒体路径限制','Media path limit'),network_estimate:label('GCC 网络预算','GCC network budget'),receiver_feedback:label('接收端拥塞反馈','Receiver congestion feedback')} as Record<string,string>)[p.stability.bitrateLimitReason ?? ''] ?? '—']] : []),
      [label('接收声明上限', 'Receiver declaration'), h264LevelLabel(n?.receiverLevel)],
      [label('协商上限', 'Negotiated ceiling'), h264LevelLabel(n?.negotiatedLevel)],
      [label('已应用编码等级', 'Applied encoder level'), h264LevelLabel(applied?.level)],
      [label('画面确认', 'Picture confirmation'), (p?.stability ? p.stability.decodeEpoch > 0n && p.stability.confirmedDecodeEpoch === p.stability.decodeEpoch : p?.status === 'confirmed' && applied?.configRevision === p.configRevision) ? label('已确认', 'Confirmed') : label('未确认', 'Unconfirmed')],
    ] : []),
    [label('媒体路径（本地观测）', 'Media path (local)'), path(s?.path)],
    [label('协议 / ICE RTT', 'Protocol / ICE RTT'), `${s?.protocol?.toUpperCase() ?? '—'} / ${s?.rttMs === undefined ? '—' : `${Math.round(s.rttMs)} ms`}`],
    ...(value.transport === 'h264' ? [
      [label('发送端路径策略', 'Sender path policy'), `${path(p?.transport?.path)} · ${bitrate(p?.transport?.bitrateLimit)}`],
      [label('用户 / 协商码率上限', 'User / negotiated bitrate limit'), `${bitrate(p?.requested?.kind === 'video' ? p.requested.bitrate : undefined)} / ${bitrate(p?.capabilities.maxBitrate)}`],
      [label('已应用编码预算', 'Applied encoding budget'), p?.applied ? `${p.applied.width} × ${p.applied.height} · ${p.applied.framerate} fps · ${bitrate(p.applied.bitrate)}` : '—'],
      [label('实测接收 / 解码帧率', 'Received bitrate / decoded FPS'), `${bitrate(s?.bitrate)} / ${s?.framerate === undefined ? '—' : `${s.framerate} fps`}`],
      [label('实测画面尺寸', 'Received picture size'), s?.width && s.height ? `${s.width} × ${s.height}` : '—'],
      [label('丢包 / 抖动', 'Loss / jitter'), `${s?.lossPerMille === undefined ? '—' : `${(s.lossPerMille / 10).toFixed(1)}%`} / ${s?.jitterMs === undefined ? '—' : `${s.jitterMs.toFixed(1)} ms`}`],
    ] : []),
  ]
  return <section aria-label={label('当前桌面媒体', 'Current desktop media')}>
    <Descriptions size="small" column={1} items={rows.map(([name, content]) => ({ key: name, label: name, children: content }))} />
    {value.transport === 'h264' ? <details><summary>{label('高级详情', 'Advanced details')}</summary>
      <Descriptions size="small" column={1} items={[
        { key: 'profile', label: 'profile-level-id', children: n?.profileLevelId ?? '—' },
        { key: 'version', label: label('Termous 视频能力版本', 'Termous video capability version'), children: p?.capabilities.videoLimitsVersion || '—' },
        { key: 'revision', label: label('编码配置 / 画面版本', 'Encoder / picture revision'), children: `${applied?.configRevision ?? '—'} / ${p?.configRevision ?? '—'}` },
        { key: 'policy', label: label('接收策略', 'Receiver policy'), children: !value.receiver ? '—' : value.receiver.policy === 'prefer_level_51' ? label('优先 5.1', 'Prefer 5.1') : label('原生声明', 'Native declaration') },
        { key: 'native', label: label('原生声明等级', 'Native declared levels'), children: value.receiver?.nativeLevels.map(h264LevelLabel).join(', ') || '—' },
        { key: 'fallback', label: label('回退 / 配置诊断', 'Fallback / configuration diagnostic'), children: value.receiver?.fallbackReason || p?.error || p?.capabilities.reason || '—' },
      ]} />
    </details> : null}
  </section>
}
