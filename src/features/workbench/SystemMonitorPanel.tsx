import { Button, Progress, Segmented, Select } from 'antd'
import type { EChartsCoreOption } from 'echarts/core'
import { Activity, Cpu, HardDrive, MemoryStick, Pause, Play, RadioTower, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { EChartView } from '../../components/charts/EChartView'
import type { LinuxMonitorNetwork, LinuxMonitorSnapshot, Session, ThemeMode } from '../../types/domain'
import { useSessionMonitor } from './useSessionMonitor'

interface SystemMonitorPanelProps {
  api: TermousApi
  session: Session | null
  enabled: boolean
  theme: ThemeMode
}

const intervalOptions = [2, 5, 10, 30]

export function SystemMonitorPanel({ api, session, enabled, theme }: SystemMonitorPanelProps) {
  const { t } = useTranslation()
  const [intervalSeconds, setIntervalSeconds] = useState(5)
  const [networkName, setNetworkName] = useState<string>()
  const monitor = useSessionMonitor({ api, session, enabled, intervalSeconds })
  const networks = useMemo(() => monitor.sample?.networks ?? [], [monitor.sample?.networks])
  const selectedNetwork = useMemo(() => selectNetwork(networks, networkName), [networkName, networks])

  useEffect(() => {
    if (!selectedNetwork && networks.length > 0) {
      setNetworkName(networks.find((item) => !item.is_loopback)?.name ?? networks[0].name)
    }
  }, [networks, selectedNetwork])

  if (!session || session.kind !== 'ssh' || session.status !== 'connected') {
    return (
      <div className="system-monitor-empty">
        <Activity size={20} />
        <strong>{t('workbench.systemMonitor.emptyTitle')}</strong>
        <span>{t('workbench.systemMonitor.emptyHint')}</span>
      </div>
    )
  }

  const statusText = monitor.message || t(`workbench.systemMonitor.status.${monitor.status}`)
  const latest = monitor.sample
  return (
    <section className="system-monitor-panel">
      <div className="system-monitor-toolbar">
        <div className="system-monitor-status">
          <span className={`monitor-status-dot is-${monitor.status}`} />
          <div>
            <strong>{statusText}</strong>
            <span>
              {monitor.connected ? t('workbench.systemMonitor.connected') : t('workbench.systemMonitor.connecting')}
              {latest?.collected_at ? ` · ${t('workbench.systemMonitor.updatedAt', { time: formatTime(latest.collected_at) })}` : ''}
            </span>
          </div>
        </div>
        <div className="system-monitor-controls">
          <Segmented
            size="small"
            value={intervalSeconds}
            options={intervalOptions.map((value) => ({ label: `${value}s`, value }))}
            onChange={(value) => setIntervalSeconds(Number(value))}
          />
          <Button
            type="text"
            className="monitor-control-button"
            icon={monitor.paused ? <Play size={14} /> : <Pause size={14} />}
            onClick={monitor.paused ? monitor.resume : monitor.pause}
          >
            {monitor.paused ? t('workbench.systemMonitor.resume') : t('workbench.systemMonitor.pause')}
          </Button>
        </div>
      </div>

      {!latest ? (
        <div className={`system-monitor-message is-${monitor.status}`}>
          <RotateCcw size={18} />
          <strong>{t('workbench.systemMonitor.warmingTitle')}</strong>
          <span>{statusText}</span>
        </div>
      ) : (
        <div className="system-monitor-content">
          <MetricPanel
            icon={<Cpu size={17} />}
            label={t('workbench.systemMonitor.cpu')}
            value={`${formatPercent(latest.cpu.usage_percent)}%`}
            subValue={formatCPUStatic(session)}
            chart={<EChartView theme={theme} option={cpuOption(monitor.history, theme)} />}
          />
          <MemoryPanel snapshot={latest} theme={theme} />
          <NetworkPanel
            snapshot={latest}
            history={monitor.history}
          selectedNetwork={selectedNetwork}
          networkName={networkName}
          onNetworkChange={setNetworkName}
          theme={theme}
          downloadLabel={t('workbench.systemMonitor.download')}
          uploadLabel={t('workbench.systemMonitor.upload')}
        />
          <DiskPanel snapshot={latest} />
        </div>
      )}
    </section>
  )
}

function MetricPanel({
  icon,
  label,
  value,
  subValue,
  chart,
}: {
  icon: JSX.Element
  label: string
  value: string
  subValue: string
  chart: JSX.Element
}) {
  return (
    <article className="monitor-metric-panel">
      <div className="monitor-card-head">
        <span>{icon}</span>
        <div>
          <small>{label}</small>
          <strong>{value}</strong>
        </div>
        <em>{subValue}</em>
      </div>
      {chart}
    </article>
  )
}

function MemoryPanel({ snapshot, theme }: { snapshot: LinuxMonitorSnapshot; theme: ThemeMode }) {
  const { t } = useTranslation()
  return (
    <article className="monitor-metric-panel">
      <div className="monitor-card-head">
        <span>
          <MemoryStick size={17} />
        </span>
        <div>
          <small>{t('workbench.systemMonitor.memory')}</small>
          <strong>{formatPercent(snapshot.memory.used_percent)}%</strong>
        </div>
        <em>{formatBytes(snapshot.memory.used_bytes)} / {formatBytes(snapshot.memory.total_bytes)}</em>
      </div>
      <Progress
        percent={Math.round(snapshot.memory.used_percent)}
        showInfo={false}
        strokeColor={theme === 'dark' ? '#70a7ff' : '#2f70d8'}
        railColor={theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}
      />
      <div className="monitor-memory-grid">
        <span>
          <small>{t('workbench.systemMonitor.available')}</small>
          <strong>{formatBytes(snapshot.memory.available_bytes)}</strong>
        </span>
        <span>
          <small>{t('workbench.systemMonitor.swap')}</small>
          <strong>{formatBytes(snapshot.memory.swap_used_bytes)} / {formatBytes(snapshot.memory.swap_total_bytes)}</strong>
        </span>
      </div>
    </article>
  )
}

function NetworkPanel({
  snapshot,
  history,
  selectedNetwork,
  networkName,
  onNetworkChange,
  theme,
  downloadLabel,
  uploadLabel,
}: {
  snapshot: LinuxMonitorSnapshot
  history: LinuxMonitorSnapshot[]
  selectedNetwork?: LinuxMonitorNetwork
  networkName?: string
  onNetworkChange: (name: string) => void
  theme: ThemeMode
  downloadLabel: string
  uploadLabel: string
}) {
  const { t } = useTranslation()
  return (
    <article className="monitor-metric-panel monitor-network-panel">
      <div className="monitor-card-head">
        <span>
          <RadioTower size={17} />
        </span>
        <div>
          <small>{t('workbench.systemMonitor.network')}</small>
          <strong>{selectedNetwork?.name ?? t('fields.none')}</strong>
        </div>
        <Select
          size="small"
          className="monitor-network-select"
          value={selectedNetwork?.name ?? networkName}
          options={snapshot.networks.map((item) => ({ label: item.name, value: item.name }))}
          onChange={onNetworkChange}
        />
      </div>
      <div className="monitor-network-rates">
        <span>
          <small>{t('workbench.systemMonitor.download')}</small>
          <strong>{formatRate(selectedNetwork?.rx_bytes_per_sec ?? 0)}</strong>
        </span>
        <span>
          <small>{t('workbench.systemMonitor.upload')}</small>
          <strong>{formatRate(selectedNetwork?.tx_bytes_per_sec ?? 0)}</strong>
        </span>
      </div>
      <EChartView theme={theme} option={networkOption(history, selectedNetwork, theme, downloadLabel, uploadLabel)} />
    </article>
  )
}

function DiskPanel({ snapshot }: { snapshot: LinuxMonitorSnapshot }) {
  const { t } = useTranslation()
  return (
    <article className="monitor-metric-panel monitor-disk-panel">
      <div className="monitor-card-head">
        <span>
          <HardDrive size={17} />
        </span>
        <div>
          <small>{t('workbench.systemMonitor.disk')}</small>
          <strong>{t('workbench.systemMonitor.partitionCount', { count: snapshot.disks.length })}</strong>
        </div>
      </div>
      <div className="monitor-disk-list">
        {snapshot.disks.map((disk) => (
          <div className={`monitor-disk-row is-${disk.severity}`} key={`${disk.filesystem}-${disk.mountpoint}`}>
            <div>
              <strong>{disk.mountpoint}</strong>
              <span>{disk.filesystem} · {disk.type}</span>
            </div>
            <em>{formatBytes(disk.used_bytes)} / {formatBytes(disk.total_bytes)}</em>
            <Progress percent={Math.round(disk.used_percent)} showInfo={false} />
          </div>
        ))}
      </div>
    </article>
  )
}

function cpuOption(history: LinuxMonitorSnapshot[], theme: ThemeMode): EChartsCoreOption {
  const textColor = theme === 'dark' ? '#b8c1d6' : '#4b5565'
  return {
    grid: { left: 0, right: 0, top: 12, bottom: 0, containLabel: false },
    xAxis: { type: 'category', show: false, data: history.map((item) => formatTime(item.collected_at)) },
    yAxis: { type: 'value', min: 0, max: 100, show: false },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme === 'dark' ? '#20242f' : '#ffffff',
      borderWidth: 0,
      textStyle: { color: textColor },
      valueFormatter: (value: unknown) => `${formatPercent(Number(value))}%`,
    },
    series: [
      {
        type: 'line',
        data: history.map((item) => item.cpu.usage_percent),
        showSymbol: false,
        smooth: true,
        lineStyle: { width: 2, color: theme === 'dark' ? '#70a7ff' : '#2f70d8' },
        areaStyle: { color: theme === 'dark' ? 'rgba(112,167,255,0.16)' : 'rgba(47,112,216,0.12)' },
      },
    ],
  }
}

function networkOption(
  history: LinuxMonitorSnapshot[],
  selectedNetwork: LinuxMonitorNetwork | undefined,
  theme: ThemeMode,
  downloadLabel: string,
  uploadLabel: string,
): EChartsCoreOption {
  const textColor = theme === 'dark' ? '#b8c1d6' : '#4b5565'
  const selectedName = selectedNetwork?.name
  const points = selectedName
    ? history.map((snapshot) => snapshot.networks.find((item) => item.name === selectedName) ?? null)
    : []
  return {
    grid: { left: 0, right: 0, top: 12, bottom: 0, containLabel: false },
    xAxis: { type: 'category', show: false, data: history.map((snapshot) => formatTime(snapshot.collected_at)) },
    yAxis: { type: 'value', show: false },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme === 'dark' ? '#20242f' : '#ffffff',
      borderWidth: 0,
      textStyle: { color: textColor },
      valueFormatter: (value: unknown) => formatRate(Number(value)),
    },
    series: [
      {
        name: downloadLabel,
        type: 'line',
        data: points.map((item) => item?.rx_bytes_per_sec ?? 0),
        showSymbol: false,
        lineStyle: { color: '#48d597', width: 2 },
      },
      {
        name: uploadLabel,
        type: 'line',
        data: points.map((item) => item?.tx_bytes_per_sec ?? 0),
        showSymbol: false,
        lineStyle: { color: '#70a7ff', width: 2 },
      },
    ],
  }
}

function selectNetwork(networks: LinuxMonitorNetwork[], preferred?: string) {
  if (preferred) {
    const found = networks.find((item) => item.name === preferred)
    if (found) {
      return found
    }
  }
  return networks.find((item) => !item.is_loopback) ?? networks[0]
}

function formatCPUStatic(session: Session | null) {
  const info = session?.linux_system_info
  if (!info) {
    return ''
  }
  const parts = []
  if (info.cpu_cores) {
    parts.push(`${info.cpu_cores}c`)
  }
  if (info.cpu_frequency_mhz) {
    parts.push(`${Math.round(info.cpu_frequency_mhz)} MHz`)
  }
  return parts.join(' · ')
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let next = value
  let unit = 0
  while (next >= 1024 && unit < units.length - 1) {
    next /= 1024
    unit += 1
  }
  return `${next >= 10 || unit === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unit]}`
}

function formatRate(value: number) {
  return `${formatBytes(value)}/s`
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return value.toFixed(value >= 10 ? 0 : 1)
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
