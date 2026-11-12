import type { RemoteDesktopMediaDetails } from './mediaDetails'

export function formatMediaBitrate(value?: number) {
  return value === undefined || !Number.isFinite(value) || value < 0 ? '—' : `${(value / 1_000_000).toFixed(2)} Mbps`
}

export function desktopMediaMetrics(value: RemoteDesktopMediaDetails, zh: boolean) {
  // 只呈现当前观看的实测数据，避免重连期间把旧样本显示为正在传输。
  const sample = value.phase === 'viewing' ? value.sample : undefined
  return {
    sample,
    path: sample?.path === 'direct' ? (zh ? 'P2P 直连' : 'P2P direct') : sample?.path === 'relay' ? (zh ? 'TURN 中继' : 'TURN relay') : (zh ? '待确认' : 'Unconfirmed'),
    bitrate: formatMediaBitrate(sample?.bitrate),
    framerate: sample?.framerate === undefined ? '—' : `${sample.framerate.toFixed(1)} fps`,
    latency: sample?.rttMs === undefined ? '—' : `${Math.round(sample.rttMs)} ms`,
    resolution: sample?.width && sample.height ? `${sample.width} × ${sample.height}` : '—',
  }
}
