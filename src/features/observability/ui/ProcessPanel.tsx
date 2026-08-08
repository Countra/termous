import { App, Button, Input, Popconfirm, Popover, Segmented, Tag, Tooltip } from 'antd'
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Gauge,
  Hash,
  ListFilter,
  PlugZap,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Square,
  XOctagon,
} from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { RemoteProcessDetail, RemoteProcessPort, RemoteProcessSort, RemoteProcessSummary } from '#entities/observability'
import { uiStyles, WorkspaceEmptyState } from '#shared/ui'
import type { ObservabilityGateway, ObservabilitySessionContext } from '../model/contracts'
import { defaultProcessQuery, type ProcessAutoRefreshSeconds, type SessionProcessQueryState, useSessionProcesses } from '../model/useSessionProcesses'
import styles from './Observability.module.scss'

export interface ProcessPanelProps {
  api: ObservabilityGateway
  session: ObservabilitySessionContext | null
  enabled: boolean
}

const sortOptions: RemoteProcessSort[] = ['cpu', 'memory', 'runtime', 'pid', 'name']
const autoRefreshOptions: ProcessAutoRefreshSeconds[] = [0, 5, 10, 30]

export function ProcessPanel({ api, session, enabled }: ProcessPanelProps) {
  const { t } = useTranslation()
  const { notification } = App.useApp()
  const processes = useSessionProcesses({ api, session, enabled })
  const items = processes.list?.items ?? []
  const detail = processes.detail
  const selectedPid = processes.selectedPid
  const showingDetail = Boolean(selectedPid)
  const hasActiveFilters = Boolean(
      processes.query.pid ||
      processes.query.port ||
      processes.query.autoRefreshSeconds !== defaultProcessQuery.autoRefreshSeconds,
  )
  const canTerminate = Boolean(detail && processes.terminatingPid !== detail.summary.pid)
  const updatedText = processes.lastUpdatedAt
    ? t('workbench.processes.collectedAt', { time: formatTime(processes.lastUpdatedAt) })
    : t('workbench.processes.updatedNever')

  const listSummary = processes.list
    ? t('workbench.processes.filtered', { count: processes.list.filtered, total: processes.list.total })
    : t('workbench.processes.total', { count: 0 })

  const autoRefreshSelectOptions = useMemo(
    () =>
      autoRefreshOptions.map((value) => ({
        value,
        label: value === 0 ? t('workbench.processes.manualRefresh') : `${value}s`,
      })),
    [t],
  )

  const terminateProcess = async (signal: 'term' | 'kill') => {
    if (!detail) {
      return
    }
    try {
      const result = await processes.terminateProcess(detail.summary.pid, signal)
      notification.success({
        title: t('workbench.processes.terminateSuccess'),
        description: result?.message,
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
    } catch (error) {
      notification.error({
        title: t('workbench.processes.terminateFailed'),
        description: error instanceof Error ? error.message : undefined,
        duration: 4,
        role: 'alert',
        className: 'termous-notification',
      })
    }
  }

  const changeSort = (sort: RemoteProcessSort) => {
    const query = { ...processes.query, sort }
    processes.updateQuery({ sort })
    void processes.refresh(query)
  }

  const resetFilters = () => {
    processes.resetQuery()
    void processes.refresh(defaultProcessQuery)
  }

  const refreshWithQuery = (patch: Partial<SessionProcessQueryState>) => {
    const query = { ...processes.query, ...patch }
    processes.updateQuery(patch)
    void processes.refresh(query)
  }

  if (!processes.supported) {
    const unavailableKey = !session || session.kind !== 'ssh' || session.status !== 'connected' ? 'empty' : 'unsupported'
    return (
      <WorkspaceEmptyState
        icon={<Activity size={20} />}
        title={t(unavailableKey === 'empty' ? 'workbench.processes.emptyTitle' : 'workbench.processes.unsupportedTitle')}
        description={t(unavailableKey === 'empty' ? 'workbench.processes.emptyHint' : 'workbench.processes.unsupportedHint')}
      />
    )
  }

  return (
    <section className={`process-panel ${styles.root}`}>
      <div className="process-toolbar">
        <div className="process-toolbar-status">
          <span className={`process-status-dot ${processes.error ? 'is-danger' : processes.loading ? 'is-loading' : 'is-ready'}`} />
          <div>
            <strong>{listSummary}</strong>
            <span>{updatedText}</span>
          </div>
        </div>
        <Tooltip title={t('workbench.processes.refresh')}>
          <Button
            type="text"
            className="process-icon-button"
            aria-label={t('workbench.processes.refresh')}
            loading={processes.loading}
            icon={<RotateCcw size={15} />}
            onClick={() => void processes.refresh()}
          />
        </Tooltip>
      </div>

      <div className="process-filter-panel">
        <Input
          className="host-search-input termous-search-input process-search-input"
          value={processes.query.text}
          allowClear
          variant="borderless"
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={t('workbench.processes.searchPlaceholder')}
          onChange={(event) => processes.updateQuery({ text: event.target.value })}
          onPressEnter={(event) => refreshWithQuery({ text: event.currentTarget.value })}
        />
        <Popover
          trigger="click"
          placement="bottomRight"
          arrow={false}
          overlayClassName="process-filter-popover"
          content={
            <div className="process-filter-popover-content">
              <div className="process-filter-popover-head">
                <strong>{t('workbench.processes.filters')}</strong>
                <Button type="text" size="small" onClick={resetFilters}>
                  {t('workbench.processes.resetFilters')}
                </Button>
              </div>
              <div className="process-filter-grid">
                <Input
                  className="process-compact-input"
                  value={processes.query.pid}
                  allowClear
                  variant="borderless"
                  prefix={<Hash size={13} aria-hidden="true" />}
                  placeholder={t('workbench.processes.pidPlaceholder')}
                  onChange={(event) => processes.updateQuery({ pid: event.target.value.replace(/[^\d]/g, '') })}
                  onPressEnter={(event) => refreshWithQuery({ pid: event.currentTarget.value.replace(/[^\d]/g, '') })}
                />
                <Input
                  className="process-compact-input"
                  value={processes.query.port}
                  allowClear
                  variant="borderless"
                  prefix={<PlugZap size={13} aria-hidden="true" />}
                  placeholder={t('workbench.processes.portPlaceholder')}
                  onChange={(event) => processes.updateQuery({ port: event.target.value.replace(/[^\d]/g, '') })}
                  onPressEnter={(event) => refreshWithQuery({ port: event.currentTarget.value.replace(/[^\d]/g, '') })}
                />
              </div>
              <label className="process-filter-field">
                <span>{t('workbench.processes.refreshEvery')}</span>
                <Segmented
                  className="process-refresh-segment"
                  size="small"
                  value={processes.query.autoRefreshSeconds}
                  options={autoRefreshSelectOptions}
                  onChange={(value) => processes.updateQuery({ autoRefreshSeconds: Number(value) as ProcessAutoRefreshSeconds })}
                />
              </label>
            </div>
          }
        >
          <Button
            type="text"
            className={`process-filter-button ${hasActiveFilters ? 'is-active' : ''}`}
            icon={<SlidersHorizontal size={15} />}
          >
            {t('workbench.processes.filters')}
          </Button>
        </Popover>
        <div className="process-sort-strip" aria-label={t('workbench.processes.sort')}>
          <span className="process-sort-label">{t('workbench.processes.sort')}</span>
          <div className="process-sort-options" role="radiogroup">
            {sortOptions.map((sort) => (
              <button
                key={sort}
                type="button"
                role="radio"
                aria-checked={processes.query.sort === sort}
                className={`process-sort-option ${processes.query.sort === sort ? 'is-active' : ''}`}
                onClick={() => changeSort(sort)}
              >
                {t(`workbench.processes.sortOptions.${sort}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {processes.error ? (
        <WorkspaceEmptyState
          className="process-error-state"
          tone="danger"
          icon={<AlertTriangle size={20} />}
          title={t('workbench.processes.loadFailed')}
          description={processes.error}
        />
      ) : null}

      <div className="process-content">
        {showingDetail ? (
          <ProcessDetailView
            detail={detail}
            loading={processes.detailLoading}
            error={processes.detailError}
            selectedPid={selectedPid}
            terminatingPid={processes.terminatingPid}
            canTerminate={canTerminate}
            onBack={processes.clearSelection}
            onTerminate={() => void terminateProcess('term')}
            onForceTerminate={() => void terminateProcess('kill')}
          />
        ) : (
          <div className="process-list" aria-label={t('workbench.processes.processList')}>
            {items.length === 0 && !processes.loading ? (
              <WorkspaceEmptyState
                className="process-empty-list"
                icon={<ListFilter size={20} />}
                title={t(processes.list ? 'workbench.processes.noResults' : 'workbench.processes.loading')}
                description={processes.list ? undefined : t('workbench.processes.emptyListHint')}
              />
            ) : null}
            {items.map((item) => (
              <ProcessRow key={item.pid} item={item} selected={selectedPid === item.pid} onSelect={() => void processes.selectProcess(item.pid)} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

interface ProcessRowProps {
  item: RemoteProcessSummary
  selected: boolean
  onSelect: () => void
}

function ProcessRow({ item, selected, onSelect }: ProcessRowProps) {
  const { t } = useTranslation()
  const ports = item.listening_ports ?? []
  const visiblePorts = ports.slice(0, 2)
  const hiddenPortCount = ports.length - visiblePorts.length
  const portSummary = ports.map((port) => `:${port}`).join('  ')
  const compactPortSummary = visiblePorts.map((port) => port).join(' / ')
  const command = item.command_line || item.name
  return (
    <button
      type="button"
      className={`process-row ${selected ? 'is-selected' : ''} ${ports.length > 0 ? 'has-ports' : ''}`}
      onClick={onSelect}
    >
      <div className="process-row-main">
        <span className="process-row-icon">
          <Activity size={15} />
        </span>
        <div>
          <strong>{item.name || `PID ${item.pid}`}</strong>
          <Tooltip title={command}>
            <small>{command}</small>
          </Tooltip>
        </div>
      </div>
      {ports.length > 0 ? (
        <Tooltip title={portSummary} overlayClassName="termous-tooltip">
          <span className="process-row-port-summary" aria-label={t('workbench.processes.portsShort', { count: ports.length })}>
            <PlugZap size={12} />
            <span>{compactPortSummary}</span>
            {hiddenPortCount > 0 ? <em>{`+${hiddenPortCount}`}</em> : null}
          </span>
        </Tooltip>
      ) : null}
      <div className="process-row-statline">
        <span>{`PID ${item.pid}`}</span>
        <span>{`${t('workbench.processes.cpu')} ${formatPercent(item.cpu_percent)}`}</span>
        <span>{`${t('workbench.processes.memory')} ${formatPercent(item.memory_percent)}`}</span>
      </div>
    </button>
  )
}

interface ProcessDetailViewProps {
  detail: RemoteProcessDetail | null
  loading: boolean
  error: string
  selectedPid: number | null
  terminatingPid: number | null
  canTerminate: boolean
  onBack: () => void
  onTerminate: () => void
  onForceTerminate: () => void
}

function ProcessDetailView({
  detail,
  loading,
  error,
  selectedPid,
  terminatingPid,
  canTerminate,
  onBack,
  onTerminate,
  onForceTerminate,
}: ProcessDetailViewProps) {
  const { t } = useTranslation()
  if (!detail && !loading && !error) {
    return (
      <WorkspaceEmptyState
        className="process-detail-empty"
        icon={<Gauge size={20} />}
        title={t('workbench.processes.noSelection')}
      />
    )
  }
  if (loading) {
    return (
      <div className="process-detail-card is-loading">
        <Button type="text" className="process-detail-back" icon={<ArrowLeft size={14} />} onClick={onBack}>
          {t('workbench.processes.backToList')}
        </Button>
        <span className="process-detail-spinner" />
        <strong>{t('workbench.processes.detailLoading')}</strong>
        {selectedPid ? <small>{`PID ${selectedPid}`}</small> : null}
      </div>
    )
  }
  if (error) {
    return (
      <div className="process-detail-card">
        <Button type="text" className="process-detail-back" icon={<ArrowLeft size={14} />} onClick={onBack}>
          {t('workbench.processes.backToList')}
        </Button>
        <WorkspaceEmptyState
          className="process-detail-empty"
          tone="danger"
          icon={<AlertTriangle size={20} />}
          title={t('workbench.processes.loadFailed')}
          description={error}
        />
      </div>
    )
  }
  if (!detail) {
    return null
  }
  const summary = detail.summary
  const warnings = [...(summary.warnings ?? []), ...(detail.warnings ?? [])]
  const stateText = summary.state || t('fields.none')
  const stateTooltip = summary.state ? getProcessStateTooltip(summary.state, t) : t('workbench.processes.stateEmptyHint')
  return (
    <article className="process-detail-card">
      <Button type="text" className="process-detail-back" icon={<ArrowLeft size={14} />} onClick={onBack}>
        {t('workbench.processes.backToList')}
      </Button>
      <div className="process-detail-head">
        <div>
          <strong>{summary.name || `PID ${summary.pid}`}</strong>
          <small>{`PID ${summary.pid} · ${summary.user || t('fields.none')}`}</small>
        </div>
        <Tooltip title={stateTooltip} placement="left" overlayClassName="termous-tooltip">
          <Tag className="process-state-tag">{stateText}</Tag>
        </Tooltip>
      </div>
      <div className="process-detail-kpis">
        <ProcessKpi label={t('workbench.processes.cpu')} value={formatPercent(summary.cpu_percent)} />
        <ProcessKpi label={t('workbench.processes.memory')} value={formatPercent(summary.memory_percent)} />
        <ProcessKpi label={t('workbench.processes.runtime')} value={formatDuration(summary.runtime_seconds)} />
      </div>
      <dl className="process-detail-list">
        <ProcessDetailItem label={t('workbench.processes.parentPid')} value={String(summary.ppid || '-')} />
        <ProcessDetailItem label={t('workbench.processes.memory')} value={formatBytes(summary.rss_bytes)} />
        <ProcessDetailItem label={t('workbench.processes.workingDirectory')} value={detail.cwd || t('fields.none')} />
        <ProcessDetailItem label={t('workbench.processes.executable')} value={detail.executable || t('fields.none')} />
        <ProcessDetailItem label={t('workbench.processes.commandLine')} value={detail.full_command_line || summary.command_line || t('fields.none')} />
      </dl>
      <ProcessPorts ports={detail.ports ?? []} />
      {warnings.length > 0 ? (
        <div className="process-warning-strip">
          <AlertTriangle size={14} />
          <span>{warnings.join(' · ')}</span>
        </div>
      ) : null}
      <div className="process-detail-actions">
        <Popconfirm
          title={t('workbench.processes.terminateTitle', { pid: summary.pid })}
          description={t('workbench.processes.terminateContent', { pid: summary.pid })}
          okText={t('workbench.processes.terminate')}
          cancelText={t('app.cancel')}
          onConfirm={onTerminate}
        >
          <Button
            className={`${uiStyles['secondary-button']} secondary-button process-terminate-button`}
            disabled={!canTerminate}
            loading={terminatingPid === summary.pid}
            icon={<Square size={13} />}
          >
            {t('workbench.processes.terminate')}
          </Button>
        </Popconfirm>
        <Popconfirm
          title={t('workbench.processes.forceTerminateTitle', { pid: summary.pid })}
          description={t('workbench.processes.forceTerminateContent', { pid: summary.pid })}
          okText={t('workbench.processes.forceTerminate')}
          cancelText={t('app.cancel')}
          okButtonProps={{ danger: true }}
          onConfirm={onForceTerminate}
        >
          <Button
            danger
            className={`${uiStyles['danger-button']} danger-button process-terminate-button`}
            disabled={!canTerminate}
            loading={terminatingPid === summary.pid}
            icon={<XOctagon size={14} />}
          >
            {t('workbench.processes.forceTerminate')}
          </Button>
        </Popconfirm>
      </div>
    </article>
  )
}

const processStateCodeKeys: Record<string, string> = {
  R: 'running',
  S: 'sleeping',
  D: 'uninterruptibleSleep',
  I: 'idleKernelThread',
  T: 'stopped',
  t: 'tracingStopped',
  Z: 'zombie',
  X: 'dead',
  x: 'dead',
  K: 'wakeKill',
  W: 'paging',
  P: 'parked',
  '<': 'highPriority',
  N: 'lowPriority',
  L: 'lockedMemory',
  s: 'sessionLeader',
  l: 'multiThreaded',
  '+': 'foregroundGroup',
}

function getProcessStateTooltip(state: string, t: TFunction) {
  const explanations = Array.from(state).map((code) => {
    const key = processStateCodeKeys[code] ?? 'unknown'
    return t(`workbench.processes.stateCodes.${key}`, { code })
  })
  return (
    <div className="process-state-tooltip">
      <strong>{t('workbench.processes.stateTooltipTitle', { state })}</strong>
      <span>{t('workbench.processes.stateTooltipHint')}</span>
      <ul>
        {explanations.map((text, index) => (
          <li key={`${state}-${index}`}>{text}</li>
        ))}
      </ul>
    </div>
  )
}

function ProcessKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="process-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ProcessDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <Tooltip title={value}>
        <dd>{value}</dd>
      </Tooltip>
    </div>
  )
}

function ProcessPorts({ ports }: { ports: RemoteProcessPort[] }) {
  const { t } = useTranslation()
  if (ports.length === 0) {
    return <div className="process-port-empty">{t('workbench.processes.noPorts')}</div>
  }
  return (
    <div className="process-port-list">
      {ports.map((port, index) => (
        <span key={`${port.protocol}-${port.local_address}-${port.local_port}-${index}`}>
          <PlugZap size={12} />
          {`${port.protocol.toUpperCase()} ${port.local_address}:${port.local_port}`}
        </span>
      ))}
    </div>
  )
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return '0%'
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}%`
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '-'
  }
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) {
    return `${days}d ${hours}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
