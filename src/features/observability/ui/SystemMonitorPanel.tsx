import { Alert, Button, Progress, Segmented, Select, Tooltip } from 'antd'
import type { EChartsCoreOption } from 'echarts/core'
import { Activity, ArrowDownToLine, ArrowUpFromLine, ChartNoAxesCombined, Cpu, Gauge, HardDrive, MemoryStick, Pause, Play, RadioTower, RotateCcw, Rows3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EChartView } from '#shared/charts'
import type { ThemeMode } from '#shared/theme'
import { customSelectStyles, uiStyles, WorkspaceEmptyState } from '#shared/ui'
import type {
  LinuxMonitorCPUCore,
  LinuxMonitorDiskIODevice,
  LinuxMonitorLoadAverage,
  LinuxMonitorNetwork,
  LinuxMonitorSnapshot,
} from '#entities/observability'
import type {
  ObservabilityGateway,
  ObservabilitySessionContext,
} from '../model/contracts'
import { useSessionMonitor } from '../model/useSessionMonitor'
import styles from './Observability.module.scss'

export interface SystemMonitorPanelProps {
  api: ObservabilityGateway
  session: ObservabilitySessionContext | null
  enabled: boolean
  theme: ThemeMode
  inventoryRequesting: boolean
  inventoryRequestError: string
  onRetryInventory: () => void
}

const intervalOptions = [2, 5, 10, 30]
type CPUViewMode = 'overall' | 'cores'

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
      classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}
    >
      <span className={styles['monitor-device-select-option']}>{value}</span>
    </Tooltip>
  )
}

export function SystemMonitorPanel({
  api,
  session,
  enabled,
  theme,
  inventoryRequesting,
  inventoryRequestError,
  onRetryInventory,
}: SystemMonitorPanelProps) {
  const { t } = useTranslation()
  const [intervalSeconds, setIntervalSeconds] = useState(5)
  const [cpuViewMode, setCPUViewMode] = useState<CPUViewMode>('overall')
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
      <WorkspaceEmptyState
        icon={<Activity size={20} />}
        title={t('workbench.systemMonitor.emptyTitle')}
        description={t('workbench.systemMonitor.emptyHint')}
      />
    )
  }

  const statusText = monitor.message || t(`workbench.systemMonitor.status.${monitor.status}`)
  const latest = monitor.sample
  const inventoryFailed = session.inventory_status === 'failed' || Boolean(inventoryRequestError)
  return (
    <section className={[styles['system-monitor-panel'], styles.root].join(' ')}>
      {inventoryFailed ? (
        <Alert
          className={styles['system-monitor-inventory-alert']}
          type="warning"
          showIcon
          message={t('workbench.systemInfo.failedTitle')}
          description={inventoryRequestError || session.inventory_message || t('workbench.systemInfo.failedHint')}
          action={(
            <Button
              size="small"
              loading={inventoryRequesting}
              disabled={inventoryRequesting}
              icon={<RotateCcw size={14} />}
              onClick={onRetryInventory}
            >
              {inventoryRequesting ? t('workbench.systemInfo.retrying') : t('workbench.systemInfo.retry')}
            </Button>
          )}
        />
      ) : null}
      <div className={styles['system-monitor-toolbar']}>
        <div className={styles['system-monitor-status']}>
          <span className={[
            styles['monitor-status-dot'],
            styles[`is-${monitor.status}`],
          ].join(' ')} />
          <div>
            <strong>{statusText}</strong>
            <span>
              {monitor.connected ? t('workbench.systemMonitor.connected') : t('workbench.systemMonitor.connecting')}
              {latest?.collected_at ? ` · ${t('workbench.systemMonitor.updatedAt', { time: formatTime(latest.collected_at) })}` : ''}
            </span>
          </div>
        </div>
        <div className={styles['system-monitor-controls']}>
          <Segmented
            size="small"
            value={intervalSeconds}
            options={intervalOptions.map((value) => ({ label: `${value}s`, value }))}
            onChange={(value) => setIntervalSeconds(Number(value))}
          />
          <Button
            type="text"
            className={styles['monitor-control-button']}
            icon={monitor.paused ? <Play size={14} /> : <Pause size={14} />}
            onClick={monitor.paused ? monitor.resume : monitor.pause}
          >
            {monitor.paused ? t('workbench.systemMonitor.resume') : t('workbench.systemMonitor.pause')}
          </Button>
        </div>
      </div>

      {!latest ? (
        <WorkspaceEmptyState
          tone={monitor.status === 'failed' ? 'danger' : 'warning'}
          icon={<RotateCcw size={18} />}
          title={t('workbench.systemMonitor.warmingTitle')}
          description={statusText}
        />
      ) : (
        <div className={styles['system-monitor-content']}>
          <CPUPanel
            snapshot={latest}
            history={monitor.history}
            session={session}
            theme={theme}
            mode={cpuViewMode}
            onModeChange={setCPUViewMode}
          />
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

function CPUPanel({
  snapshot,
  history,
  session,
  theme,
  mode,
  onModeChange,
}: {
  snapshot: LinuxMonitorSnapshot
  history: LinuxMonitorSnapshot[]
  session: ObservabilitySessionContext
  theme: ThemeMode
  mode: CPUViewMode
  onModeChange: (mode: CPUViewMode) => void
}) {
  const { t } = useTranslation()
  const cores = snapshot.cpu.cores
  return (
    <article className={[styles['monitor-metric-panel'], styles['monitor-cpu-panel']].join(' ')}>
      <div className={[styles['monitor-card-head'], styles['monitor-cpu-card-head']].join(' ')}>
        <div className={styles['monitor-cpu-identity']}>
          <span>
            <Cpu size={17} />
          </span>
          <div>
            <small>CPU</small>
            <strong>{formatPercent(snapshot.cpu.usage_percent)}%</strong>
          </div>
        </div>
        <Segmented<CPUViewMode>
          className={styles['monitor-cpu-view-switch']}
          size="small"
          value={mode}
          aria-label={t('workbench.systemMonitor.cpuViewMode')}
          options={[
            {
              icon: <ChartNoAxesCombined size={12} aria-hidden="true" />,
              label: t('workbench.systemMonitor.cpuOverall'),
              value: 'overall',
            },
            {
              icon: <Rows3 size={12} aria-hidden="true" />,
              label: t('workbench.systemMonitor.cpuCores'),
              value: 'cores',
            },
          ]}
          onChange={onModeChange}
        />
        <em>{formatCPUStatic(session)}</em>
      </div>
      {mode === 'cores' ? (
        <CPUCoreList cores={cores} warming={snapshot.status === 'warming'} />
      ) : (
        <EChartView
          className={styles['monitor-time-chart']}
          theme={theme}
          option={cpuOption(history, theme, t('workbench.systemMonitor.cpu'))}
        />
      )}
      <LoadAverageStrip load={snapshot.cpu.load_average} />
    </article>
  )
}

function CPUCoreList({ cores, warming }: { cores: LinuxMonitorCPUCore[]; warming: boolean }) {
  const { t } = useTranslation()
  if (cores.length === 0) {
    return (
      <div className={styles['monitor-cpu-core-empty']}>
        <RotateCcw size={15} />
        <span>
          {t(
            warming
              ? 'workbench.systemMonitor.cpuCoresWarming'
              : 'workbench.systemMonitor.cpuCoresUnavailable',
          )}
        </span>
      </div>
    )
  }
  return (
    <div
      className={styles['monitor-cpu-core-list']}
      role="list"
      aria-label={t('workbench.systemMonitor.cpuCores')}
      tabIndex={0}
    >
      {cores.map((core) => {
        const percent = clampPercent(core.usage_percent)
        return (
          <div className={styles['monitor-cpu-core-row']} key={core.name} role="listitem">
            <span>{formatCPUCoreLabel(core.name)}</span>
            <div className={styles['monitor-cpu-core-meter']} aria-hidden="true">
              <i style={{ width: `${percent}%` }} />
            </div>
            <strong>{formatPercent(percent)}%</strong>
          </div>
        )
      })}
    </div>
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
    <div className={styles['monitor-load-strip']} aria-label={t('workbench.systemMonitor.loadAverage')}>
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
    <article className={styles['monitor-metric-panel']}>
      <div className={styles['monitor-card-head']}>
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
      <div className={styles['monitor-memory-grid']}>
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
    <article className={styles['monitor-metric-panel']}>
      <div className={styles['monitor-card-head']}>
        <span>
          <RadioTower size={17} />
        </span>
        <div>
          <small>{t('workbench.systemMonitor.network')}</small>
          <strong>{selectedNetwork?.name ?? t('fields.none')}</strong>
        </div>
        <Select
          size="small"
          className={styles['monitor-network-select']}
          classNames={{ popup: { root: `${customSelectStyles['select-dropdown']} termous-select-dropdown ${styles['monitor-device-select-dropdown']}` } }}
          value={selectedNetwork?.name ?? networkName}
          options={snapshot.networks.map((item) => ({ label: item.name, value: item.name, title: '' }))}
          optionRender={(option) => <MonitorDeviceOption value={String(option.label ?? option.value ?? '')} />}
          onChange={onNetworkChange}
        />
      </div>
      <div className={styles['monitor-network-rates']}>
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
      <EChartView
        className={styles['monitor-time-chart']}
        theme={theme}
        option={networkOption(history, selectedNetwork, theme, downloadLabel, uploadLabel)}
      />
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
    <article className={[styles['monitor-metric-panel'], styles['monitor-disk-io-panel']].join(' ')}>
      <div className={styles['monitor-card-head']}>
        <span>
          <Gauge size={17} />
        </span>
        <div>
          <small>{t('workbench.systemMonitor.diskIO')}</small>
          <strong>{selectedDevice?.name ?? t('fields.none')}</strong>
        </div>
        <Select
          size="small"
          className={styles['monitor-disk-select']}
          classNames={{ popup: { root: `${customSelectStyles['select-dropdown']} termous-select-dropdown ${styles['monitor-device-select-dropdown']}` } }}
          aria-label={t('workbench.systemMonitor.diskDevice')}
          value={selectedDevice?.name ?? deviceName}
          options={diskIO.devices.map((item) => ({ label: item.name, value: item.name, title: '' }))}
          optionRender={(option) => <MonitorDeviceOption value={String(option.label ?? option.value ?? '')} />}
          disabled={diskIO.devices.length === 0}
          onChange={onDeviceChange}
        />
      </div>
      {unavailable || warming || !selectedDevice ? (
        <div className={[
          styles['monitor-disk-io-state'],
          styles[`is-${diskIO.status}`],
        ].join(' ')}>
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
          <div className={styles['monitor-disk-io-rates']}>
            <span className={styles['is-read']}>
              <ArrowUpFromLine size={14} />
              <small>{t('workbench.systemMonitor.diskRead')}</small>
              <strong>{formatRate(selectedDevice.read_bytes_per_sec)}</strong>
            </span>
            <span className={styles['is-write']}>
              <ArrowDownToLine size={14} />
              <small>{t('workbench.systemMonitor.diskWrite')}</small>
              <strong>{formatRate(selectedDevice.write_bytes_per_sec)}</strong>
            </span>
          </div>
          <EChartView
            className={[styles['monitor-time-chart'], styles['monitor-disk-io-chart']].join(' ')}
            theme={theme}
            option={diskIOOption(
              history,
              selectedDevice.name,
              theme,
              t('workbench.systemMonitor.diskRead'),
              t('workbench.systemMonitor.diskWrite'),
            )}
          />
          <dl className={styles['monitor-disk-io-facts']}>
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
    <article className={[styles['monitor-metric-panel'], styles['monitor-disk-panel']].join(' ')}>
      <div className={[styles['monitor-card-head'], styles['monitor-disk-head']].join(' ')}>
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
        <div className={styles['monitor-disk-empty']}>{t('workbench.systemMonitor.noPartitions')}</div>
      ) : (
        <div className={styles['monitor-disk-list']} role="list">
          {snapshot.disks.map((disk) => {
            const percent = clampPercent(disk.used_percent)
            return (
              <div
                className={[styles['monitor-disk-row'], styles[`is-${disk.severity}`]].join(' ')}
                key={`${disk.filesystem}-${disk.mountpoint}`}
                role="listitem"
              >
                <div className={styles['monitor-disk-row-summary']}>
                  <div className={styles['monitor-disk-title']}>
                    <Tooltip title={disk.mountpoint} placement="topLeft">
                      <strong>{disk.mountpoint}</strong>
                    </Tooltip>
                    <div className={styles['monitor-disk-source']}>
                      <Tooltip title={disk.filesystem} placement="topLeft">
                        <span>{disk.filesystem}</span>
                      </Tooltip>
                      <i aria-hidden="true" />
                      <span>{disk.type}</span>
                    </div>
                  </div>
                  <div className={styles['monitor-disk-usage']}>
                    <strong>{formatPercent(percent)}%</strong>
                    <small>{t('workbench.systemMonitor.diskUsed')}</small>
                  </div>
                </div>
                <div className={styles['monitor-disk-meter']} aria-hidden="true">
                  <i style={{ width: `${percent}%` }} />
                </div>
                <dl className={styles['monitor-disk-row-meta']}>
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

function cpuOption(history: LinuxMonitorSnapshot[], theme: ThemeMode, label: string): EChartsCoreOption {
  const textColor = theme === 'dark' ? '#b8c1d6' : '#4b5565'
  const gridColor = theme === 'dark' ? 'rgba(184,193,214,0.12)' : 'rgba(75,85,101,0.12)'
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 240,
    grid: { left: 34, right: 8, top: 8, bottom: 22, containLabel: false },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: history.map((item) => formatTime(item.collected_at)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 9, hideOverlap: true, showMinLabel: true, showMaxLabel: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      max: 100,
      interval: 50,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 9, formatter: (value: string | number) => `${value}%` },
      splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: gridColor } },
      renderMode: 'html',
      appendToBody: true,
      confine: true,
      className: styles['monitor-chart-tooltip'],
      extraCssText: 'z-index:3600;border-radius:8px;box-shadow:0 14px 34px rgba(0,0,0,.24);',
      backgroundColor: theme === 'dark' ? '#20242f' : '#ffffff',
      borderWidth: 0,
      textStyle: { color: textColor },
      valueFormatter: (value: unknown) => `${formatPercent(Number(value))}%`,
    },
    series: [
      {
        name: label,
        type: 'line',
        data: history.map((item) => item.cpu.usage_percent),
        showSymbol: false,
        smooth: 0.28,
        lineStyle: { width: 2, color: theme === 'dark' ? '#70a7ff' : '#2f70d8' },
        areaStyle: { color: theme === 'dark' ? 'rgba(112,167,255,0.16)' : 'rgba(47,112,216,0.12)' },
        emphasis: { focus: 'series' },
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
  const gridColor = theme === 'dark' ? 'rgba(184,193,214,0.12)' : 'rgba(75,85,101,0.12)'
  const selectedName = selectedNetwork?.name
  const points = selectedName
    ? history.map((snapshot) => snapshot.networks.find((item) => item.name === selectedName) ?? null)
    : []
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 240,
    grid: { left: 8, right: 8, top: 8, bottom: 22, containLabel: false },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: history.map((snapshot) => formatTime(snapshot.collected_at)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 9, hideOverlap: true, showMinLabel: true, showMaxLabel: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitNumber: 2,
      splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: gridColor } },
      renderMode: 'html',
      appendToBody: true,
      confine: true,
      className: styles['monitor-chart-tooltip'],
      extraCssText: 'z-index:3600;border-radius:8px;box-shadow:0 14px 34px rgba(0,0,0,.24);',
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
        smooth: 0.24,
        lineStyle: { color: '#48d597', width: 2 },
        areaStyle: { color: 'rgba(72,213,151,0.08)' },
        emphasis: { focus: 'series' },
      },
      {
        name: uploadLabel,
        type: 'line',
        data: points.map((item) => item?.tx_bytes_per_sec ?? 0),
        showSymbol: false,
        smooth: 0.24,
        lineStyle: { color: '#70a7ff', width: 2 },
        areaStyle: { color: 'rgba(112,167,255,0.07)' },
        emphasis: { focus: 'series' },
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
  const gridColor = theme === 'dark' ? 'rgba(184,193,214,0.12)' : 'rgba(75,85,101,0.12)'
  const points = history.map(
    (snapshot) => snapshot.disk_io.devices.find((item) => item.name === deviceName) ?? null,
  )
  return {
    backgroundColor: 'transparent',
    animationDurationUpdate: 240,
    grid: { left: 8, right: 8, top: 8, bottom: 22, containLabel: false },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: history.map((snapshot) => formatTime(snapshot.collected_at)),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: textColor, fontSize: 9, hideOverlap: true, showMinLabel: true, showMaxLabel: true },
    },
    yAxis: {
      type: 'value',
      min: 0,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
      splitNumber: 2,
      splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: gridColor } },
      renderMode: 'html',
      appendToBody: true,
      confine: false,
      className: styles['monitor-chart-tooltip'],
      extraCssText: 'z-index:3600;border-radius:8px;box-shadow:0 14px 34px rgba(0,0,0,.24);',
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
        areaStyle: { color: 'rgba(112,167,255,0.07)' },
        emphasis: { focus: 'series' },
      },
      {
        name: writeLabel,
        type: 'line',
        data: points.map((item) => item?.write_bytes_per_sec ?? null),
        showSymbol: false,
        connectNulls: false,
        smooth: 0.28,
        lineStyle: { color: '#48d597', width: 2 },
        areaStyle: { color: 'rgba(72,213,151,0.07)' },
        emphasis: { focus: 'series' },
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

function formatCPUStatic(session: ObservabilitySessionContext | null) {
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

function formatCPUCoreLabel(name: string) {
  const match = /^cpu(\d+)$/i.exec(name)
  return match ? `CPU ${match[1]}` : name
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
