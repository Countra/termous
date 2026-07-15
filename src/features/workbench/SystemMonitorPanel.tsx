import { Button, Progress, Segmented, Select, Tooltip } from 'antd'
import type { EChartsCoreOption } from 'echarts/core'
import { Activity, ArrowDownToLine, ArrowUpFromLine, Cpu, Gauge, HardDrive, MemoryStick, Pause, Play, RadioTower, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import { EChartView } from '../../components/charts/EChartView'
import type {
  LinuxMonitorDiskIODevice,
  LinuxMonitorLoadAverage,
  LinuxMonitorNetwork,
  LinuxMonitorSnapshot,
  Session,
  ThemeMode,
} from '../../types/domain'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'
import { useSessionMonitor } from './useSessionMonitor'

interface SystemMonitorPanelProps {
  api: TermousApi
  session: Session | null
  enabled: boolean
  theme: ThemeMode
}

const intervalOptions = [2, 5, 10, 30]

interface NetworkCounter {
  rxBytes: number
  txBytes: number
}

interface NetworkSessionState {
  networkName?: string
  baselines: Record<string, NetworkCounter>
}

interface DiskIOSessionState {
  deviceName?: string
}

const emptyNetworkSessionState: NetworkSessionState = {
  baselines: {},
}

const emptyDiskIOSessionState: DiskIOSessionState = {}

function createNetworkSessionState(): NetworkSessionState {
  return { baselines: {} }
}

function MonitorDeviceOption({ value }: { value: string }) {
  return (
    <Tooltip
      title={value}
      placement="left"
      mouseEnterDelay={0.3}
      classNames={{ root: 'termous-tooltip' }}
    >
      <span className="monitor-device-select-option">{value}</span>
    </Tooltip>
  )
}

export function SystemMonitorPanel({ api, session, enabled, theme }: SystemMonitorPanelProps) {
  const { t } = useTranslation()
  const [intervalSeconds, setIntervalSeconds] = useState(5)
  const [networkStates, setNetworkStates] = useState<Record<string, NetworkSessionState>>({})
  const [diskIOStates, setDiskIOStates] = useState<Record<string, DiskIOSessionState>>({})
  const sessionId = session?.id ?? ''
  const networkState = sessionId ? networkStates[sessionId] ?? emptyNetworkSessionState : emptyNetworkSessionState
  const diskIOState = sessionId ? diskIOStates[sessionId] ?? emptyDiskIOSessionState : emptyDiskIOSessionState
  const networkName = networkState.networkName
  const monitor = useSessionMonitor({ api, session, enabled, intervalSeconds })
  const networks = useMemo(() => monitor.sample?.networks ?? [], [monitor.sample?.networks])
  const diskDevices = useMemo(() => monitor.sample?.disk_io.devices ?? [], [monitor.sample?.disk_io.devices])
  const selectedNetwork = useMemo(() => selectNetwork(networks, networkName), [networkName, networks])
  const selectedDiskDevice = useMemo(
    () => selectDiskIODevice(diskDevices, diskIOState.deviceName),
    [diskDevices, diskIOState.deviceName],
  )
  const networkBaselineKey = selectedNetwork?.name ?? ''
  const networkTotals = useMemo(
    () => calculateNetworkTotals(selectedNetwork, networkState.baselines[networkBaselineKey]),
    [networkBaselineKey, networkState.baselines, selectedNetwork],
  )

  const setSessionNetworkName = useCallback((name: string) => {
    if (!sessionId) {
      return
    }
    setNetworkStates((current) => {
      const previous = current[sessionId] ?? createNetworkSessionState()
      return {
        ...current,
        [sessionId]: {
          ...previous,
          networkName: name,
        },
      }
    })
  }, [sessionId])

  const setSessionDiskDeviceName = useCallback((name: string) => {
    if (!sessionId) {
      return
    }
    setDiskIOStates((current) => ({ ...current, [sessionId]: { deviceName: name } }))
  }, [sessionId])

  useEffect(() => {
    if (!sessionId || networks.length === 0) {
      return
    }
    if (!networkName || !networks.some((item) => item.name === networkName)) {
      setSessionNetworkName(networks.find((item) => !item.is_loopback)?.name ?? networks[0].name)
    }
  }, [networkName, networks, sessionId, setSessionNetworkName])

  useEffect(() => {
    if (!sessionId || diskDevices.length === 0) {
      return
    }
    if (!diskIOState.deviceName || !diskDevices.some((item) => item.name === diskIOState.deviceName)) {
      const nextDevice = selectDiskIODevice(diskDevices)
      if (nextDevice) {
        setSessionDiskDeviceName(nextDevice.name)
      }
    }
  }, [diskDevices, diskIOState.deviceName, sessionId, setSessionDiskDeviceName])

  useEffect(() => {
    if (!sessionId || !session || (session.kind === 'ssh' && session.status === 'connected')) {
      return
    }
    setNetworkStates((current) => {
      if (!current[sessionId]) {
        return current
      }
      const next = { ...current }
      delete next[sessionId]
      return next
    })
    setDiskIOStates((current) => {
      if (!current[sessionId]) {
        return current
      }
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [session, sessionId])

  useEffect(() => {
    if (!sessionId || !networkBaselineKey || !selectedNetwork) {
      return
    }
    setNetworkStates((current) => {
      const previous = current[sessionId] ?? createNetworkSessionState()
      if (previous.baselines[networkBaselineKey]) {
        return current
      }
      return {
        ...current,
        [sessionId]: {
          ...previous,
          baselines: {
            ...previous.baselines,
            [networkBaselineKey]: {
              rxBytes: selectedNetwork.rx_bytes,
              txBytes: selectedNetwork.tx_bytes,
            },
          },
        },
      }
    })
  }, [networkBaselineKey, selectedNetwork, sessionId])

  if (!session || session.kind !== 'ssh' || session.status !== 'connected') {
    return (
      <WorkbenchEmptyState
        className="system-monitor-empty"
        icon={<Activity size={20} />}
        title={t('workbench.systemMonitor.emptyTitle')}
        description={t('workbench.systemMonitor.emptyHint')}
      />
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
        <WorkbenchEmptyState
          className={`system-monitor-message is-${monitor.status}`}
          tone={monitor.status === 'failed' ? 'danger' : 'warning'}
          icon={<RotateCcw size={18} />}
          title={t('workbench.systemMonitor.warmingTitle')}
          description={statusText}
        />
      ) : (
        <div className="system-monitor-content">
          <MetricPanel
            icon={<Cpu size={17} />}
            label={t('workbench.systemMonitor.cpu')}
            value={`${formatPercent(latest.cpu.usage_percent)}%`}
            subValue={formatCPUStatic(session)}
            chart={<EChartView theme={theme} option={cpuOption(monitor.history, theme)} />}
          >
            <LoadAverageStrip load={latest.cpu.load_average} />
          </MetricPanel>
          <MemoryPanel snapshot={latest} theme={theme} />
          <NetworkPanel
            snapshot={latest}
            history={monitor.history}
            selectedNetwork={selectedNetwork}
            networkTotals={networkTotals}
            networkName={networkName}
            onNetworkChange={setSessionNetworkName}
            theme={theme}
            downloadLabel={t('workbench.systemMonitor.download')}
            uploadLabel={t('workbench.systemMonitor.upload')}
          />
          <DiskIOPanel
            snapshot={latest}
            history={monitor.history}
            selectedDevice={selectedDiskDevice}
            deviceName={diskIOState.deviceName}
            onDeviceChange={setSessionDiskDeviceName}
            theme={theme}
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
  children,
}: {
  icon: ReactNode
  label: string
  value: string
  subValue: string
  chart: ReactNode
  children?: ReactNode
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
      {children}
      {chart}
    </article>
  )
}

function LoadAverageStrip({ load }: { load?: LinuxMonitorLoadAverage }) {
  const { t } = useTranslation()
  const values = [
    { label: t('workbench.systemMonitor.loadOneMinute'), value: load?.one_minute },
    { label: t('workbench.systemMonitor.loadFiveMinutes'), value: load?.five_minutes },
    { label: t('workbench.systemMonitor.loadFifteenMinutes'), value: load?.fifteen_minutes },
  ]
  return (
    <div className="monitor-load-strip" aria-label={t('workbench.systemMonitor.loadAverage')}>
      <span>{t('workbench.systemMonitor.loadAverage')}</span>
      {values.map((item) => (
        <strong key={item.label}>
          {formatLoad(item.value)}
          <small>{item.label}</small>
        </strong>
      ))}
    </div>
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
  networkTotals,
  networkName,
  onNetworkChange,
  theme,
  downloadLabel,
  uploadLabel,
}: {
  snapshot: LinuxMonitorSnapshot
  history: LinuxMonitorSnapshot[]
  selectedNetwork?: LinuxMonitorNetwork
  networkTotals: NetworkCounter
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
          classNames={{ popup: { root: 'termous-select-dropdown monitor-device-select-dropdown' } }}
          value={selectedNetwork?.name ?? networkName}
          options={snapshot.networks.map((item) => ({ label: item.name, value: item.name, title: '' }))}
          optionRender={(option) => <MonitorDeviceOption value={String(option.label ?? option.value ?? '')} />}
          onChange={onNetworkChange}
        />
      </div>
      <div className="monitor-network-rates">
        <span>
          <small>{t('workbench.systemMonitor.download')}</small>
          <strong>{formatRate(selectedNetwork?.rx_bytes_per_sec ?? 0)}</strong>
          <em>{t('workbench.systemMonitor.networkTotal', { value: formatBytes(networkTotals.rxBytes) })}</em>
        </span>
        <span>
          <small>{t('workbench.systemMonitor.upload')}</small>
          <strong>{formatRate(selectedNetwork?.tx_bytes_per_sec ?? 0)}</strong>
          <em>{t('workbench.systemMonitor.networkTotal', { value: formatBytes(networkTotals.txBytes) })}</em>
        </span>
      </div>
      <EChartView theme={theme} option={networkOption(history, selectedNetwork, theme, downloadLabel, uploadLabel)} />
    </article>
  )
}

function DiskIOPanel({
  snapshot,
  history,
  selectedDevice,
  deviceName,
  onDeviceChange,
  theme,
}: {
  snapshot: LinuxMonitorSnapshot
  history: LinuxMonitorSnapshot[]
  selectedDevice?: LinuxMonitorDiskIODevice
  deviceName?: string
  onDeviceChange: (name: string) => void
  theme: ThemeMode
}) {
  const { t } = useTranslation()
  const diskIO = snapshot.disk_io
  const warming = diskIO.status === 'warming'
  const unavailable = !warming && (diskIO.status === 'unsupported' || diskIO.devices.length === 0)
  return (
    <article className="monitor-metric-panel monitor-disk-io-panel">
      <div className="monitor-card-head">
        <span>
          <Gauge size={17} />
        </span>
        <div>
          <small>{t('workbench.systemMonitor.diskIO')}</small>
          <strong>{selectedDevice?.name ?? t('fields.none')}</strong>
        </div>
        <Select
          size="small"
          className="monitor-disk-select"
          classNames={{ popup: { root: 'termous-select-dropdown monitor-device-select-dropdown' } }}
          aria-label={t('workbench.systemMonitor.diskDevice')}
          value={selectedDevice?.name ?? deviceName}
          options={diskIO.devices.map((item) => ({ label: item.name, value: item.name, title: '' }))}
          optionRender={(option) => <MonitorDeviceOption value={String(option.label ?? option.value ?? '')} />}
          disabled={diskIO.devices.length === 0}
          onChange={onDeviceChange}
        />
      </div>
      {unavailable || warming || !selectedDevice ? (
        <div className={`monitor-disk-io-state is-${diskIO.status}`}>
          <RotateCcw size={15} />
          <span>
            {t(
              unavailable
                ? 'workbench.systemMonitor.diskIOUnsupported'
                : 'workbench.systemMonitor.diskIOWarming',
            )}
          </span>
        </div>
      ) : (
        <>
          <div className="monitor-disk-io-rates">
            <span className="is-read">
              <ArrowUpFromLine size={14} />
              <small>{t('workbench.systemMonitor.diskRead')}</small>
              <strong>{formatRate(selectedDevice.read_bytes_per_sec)}</strong>
            </span>
            <span className="is-write">
              <ArrowDownToLine size={14} />
              <small>{t('workbench.systemMonitor.diskWrite')}</small>
              <strong>{formatRate(selectedDevice.write_bytes_per_sec)}</strong>
            </span>
          </div>
          <EChartView
            className="monitor-disk-io-chart"
            theme={theme}
            option={diskIOOption(
              history,
              selectedDevice.name,
              theme,
              t('workbench.systemMonitor.diskRead'),
              t('workbench.systemMonitor.diskWrite'),
            )}
          />
          <dl className="monitor-disk-io-facts">
            <div>
              <dt>{t('workbench.systemMonitor.diskIOPS')}</dt>
              <dd>
                {t('workbench.systemMonitor.diskIOPSValue', {
                  read: formatMetric(selectedDevice.read_iops),
                  write: formatMetric(selectedDevice.write_iops),
                })}
              </dd>
            </div>
            <div>
              <dt>{t('workbench.systemMonitor.diskLatency')}</dt>
              <dd>
                {t('workbench.systemMonitor.diskLatencyValue', {
                  read: formatMetric(selectedDevice.read_latency_ms),
                  write: formatMetric(selectedDevice.write_latency_ms),
                })}
              </dd>
            </div>
            <div>
              <Tooltip title={t('workbench.systemMonitor.diskBusyHint')}>
                <dt>{t('workbench.systemMonitor.diskBusy')}</dt>
              </Tooltip>
              <dd>{formatPercent(selectedDevice.busy_percent)}%</dd>
            </div>
            <div>
              <dt>{t('workbench.systemMonitor.diskInFlight')}</dt>
              <dd>{selectedDevice.in_flight}</dd>
            </div>
          </dl>
        </>
      )}
    </article>
  )
}

function DiskPanel({ snapshot }: { snapshot: LinuxMonitorSnapshot }) {
  const { t } = useTranslation()
  const peakUsage = snapshot.disks.reduce((max, disk) => Math.max(max, clampPercent(disk.used_percent)), 0)
  return (
    <article className="monitor-metric-panel monitor-disk-panel">
      <div className="monitor-card-head monitor-disk-head">
        <span>
          <HardDrive size={17} />
        </span>
        <div>
          <small>{t('workbench.systemMonitor.disk')}</small>
          <strong>{t('workbench.systemMonitor.partitionCount', { count: snapshot.disks.length })}</strong>
        </div>
        <em>{snapshot.disks.length > 0 ? t('workbench.systemMonitor.peakUsage', { percent: formatPercent(peakUsage) }) : ''}</em>
      </div>
      {snapshot.disks.length === 0 ? (
        <div className="monitor-disk-empty">{t('workbench.systemMonitor.noPartitions')}</div>
      ) : (
        <div className="monitor-disk-list" role="list">
          {snapshot.disks.map((disk) => {
            const percent = clampPercent(disk.used_percent)
            return (
              <div className={`monitor-disk-row is-${disk.severity}`} key={`${disk.filesystem}-${disk.mountpoint}`} role="listitem">
                <div className="monitor-disk-row-summary">
                  <div className="monitor-disk-title">
                    <Tooltip title={disk.mountpoint} placement="topLeft">
                      <strong>{disk.mountpoint}</strong>
                    </Tooltip>
                    <div className="monitor-disk-source">
                      <Tooltip title={disk.filesystem} placement="topLeft">
                        <span>{disk.filesystem}</span>
                      </Tooltip>
                      <i aria-hidden="true" />
                      <span>{disk.type}</span>
                    </div>
                  </div>
                  <div className="monitor-disk-usage">
                    <strong>{formatPercent(percent)}%</strong>
                    <small>{t('workbench.systemMonitor.diskUsed')}</small>
                  </div>
                </div>
                <div className="monitor-disk-meter" aria-hidden="true">
                  <i style={{ width: `${percent}%` }} />
                </div>
                <dl className="monitor-disk-row-meta">
                  <div>
                    <dt>{t('workbench.systemMonitor.diskTotal')}</dt>
                    <dd>{formatBytes(disk.total_bytes)}</dd>
                  </div>
                  <div>
                    <dt>{t('workbench.systemMonitor.diskUsed')}</dt>
                    <dd>{formatBytes(disk.used_bytes)}</dd>
                  </div>
                  <div>
                    <dt>{t('workbench.systemMonitor.diskAvailable')}</dt>
                    <dd>{formatBytes(disk.available_bytes)}</dd>
                  </div>
                </dl>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

function cpuOption(history: LinuxMonitorSnapshot[], theme: ThemeMode): EChartsCoreOption {
  const textColor = theme === 'dark' ? '#b8c1d6' : '#4b5565'
  return {
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 12, bottom: 0, containLabel: false },
    xAxis: { type: 'category', show: false, data: history.map((item) => formatTime(item.collected_at)) },
    yAxis: { type: 'value', min: 0, max: 100, show: false },
    tooltip: {
      trigger: 'axis',
      renderMode: 'html',
      appendToBody: true,
      confine: true,
      className: 'monitor-chart-tooltip',
      extraCssText: 'z-index:3600;border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.24);',
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
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 12, bottom: 0, containLabel: false },
    xAxis: { type: 'category', show: false, data: history.map((snapshot) => formatTime(snapshot.collected_at)) },
    yAxis: { type: 'value', show: false },
    tooltip: {
      trigger: 'axis',
      renderMode: 'html',
      appendToBody: true,
      confine: true,
      className: 'monitor-chart-tooltip',
      extraCssText: 'z-index:3600;border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.24);',
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

function diskIOOption(
  history: LinuxMonitorSnapshot[],
  deviceName: string,
  theme: ThemeMode,
  readLabel: string,
  writeLabel: string,
): EChartsCoreOption {
  const textColor = theme === 'dark' ? '#b8c1d6' : '#4b5565'
  const points = history.map(
    (snapshot) => snapshot.disk_io.devices.find((item) => item.name === deviceName) ?? null,
  )
  return {
    backgroundColor: 'transparent',
    grid: { left: 0, right: 0, top: 12, bottom: 0, containLabel: false },
    xAxis: { type: 'category', show: false, data: history.map((snapshot) => formatTime(snapshot.collected_at)) },
    yAxis: { type: 'value', min: 0, show: false },
    tooltip: {
      trigger: 'axis',
      renderMode: 'html',
      appendToBody: true,
      confine: false,
      className: 'monitor-chart-tooltip',
      extraCssText: 'z-index:3600;border-radius:10px;box-shadow:0 14px 34px rgba(0,0,0,.24);',
      backgroundColor: theme === 'dark' ? '#20242f' : '#ffffff',
      borderWidth: 0,
      textStyle: { color: textColor },
      valueFormatter: (value: unknown) => formatRate(Number(value)),
    },
    series: [
      {
        name: readLabel,
        type: 'line',
        data: points.map((item) => item?.read_bytes_per_sec ?? null),
        showSymbol: false,
        connectNulls: false,
        smooth: 0.28,
        lineStyle: { color: '#70a7ff', width: 2 },
      },
      {
        name: writeLabel,
        type: 'line',
        data: points.map((item) => item?.write_bytes_per_sec ?? null),
        showSymbol: false,
        connectNulls: false,
        smooth: 0.28,
        lineStyle: { color: '#48d597', width: 2 },
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

function selectDiskIODevice(devices: LinuxMonitorDiskIODevice[], preferred?: string) {
  if (preferred) {
    const found = devices.find((item) => item.name === preferred)
    if (found) {
      return found
    }
  }
  return devices.reduce<LinuxMonitorDiskIODevice | undefined>((selected, item) => {
    if (!selected) {
      return item
    }
    const selectedActivity = selected.read_bytes_per_sec + selected.write_bytes_per_sec
    const itemActivity = item.read_bytes_per_sec + item.write_bytes_per_sec
    if (itemActivity === selectedActivity) {
      return item.name.localeCompare(selected.name) < 0 ? item : selected
    }
    return itemActivity > selectedActivity ? item : selected
  }, undefined)
}

function calculateNetworkTotals(selectedNetwork: LinuxMonitorNetwork | undefined, baseline: NetworkCounter | undefined): NetworkCounter {
  if (!selectedNetwork || !baseline) {
    return { rxBytes: 0, txBytes: 0 }
  }
  return {
    rxBytes: safeCounterDelta(baseline.rxBytes, selectedNetwork.rx_bytes),
    txBytes: safeCounterDelta(baseline.txBytes, selectedNetwork.tx_bytes),
  }
}

function safeCounterDelta(start: number, current: number) {
  if (!Number.isFinite(start) || !Number.isFinite(current) || current < start) {
    return 0
  }
  return current - start
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

function formatMetric(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0'
  }
  return value >= 100 ? value.toFixed(0) : value.toFixed(1)
}

function formatPercent(value: number) {
  if (!Number.isFinite(value)) {
    return '0'
  }
  return value.toFixed(value >= 10 ? 0 : 1)
}

function formatLoad(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '0.00'
  }
  return value.toFixed(2)
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(100, Math.max(0, value))
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
