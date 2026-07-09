import { App, Button, Input, Popconfirm, Popover, Tag, Tooltip } from 'antd'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CirclePause,
  Container,
  FileText,
  ListFilter,
  LoaderCircle,
  Play,
  PlugZap,
  RotateCcw,
  Search,
  Square,
  Undo2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import type { DockerAction, DockerContainerDetail, DockerContainerPort, DockerContainerSummary, Session } from '../../types/domain'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'
import { defaultDockerQuery, type SessionDockerQueryState, useSessionDocker } from './useSessionDocker'

interface DockerPanelProps {
  api: TermousApi
  session: Session | null
  enabled: boolean
}

const stateOptions = ['', 'running', 'exited', 'paused', 'restarting', 'created', 'dead']
const healthOptions = ['', 'healthy', 'unhealthy', 'starting', 'none']

export function DockerPanel({ api, session, enabled }: DockerPanelProps) {
  const { t } = useTranslation()
  const { notification } = App.useApp()
  const docker = useSessionDocker({ api, session, enabled })
  const items = docker.list?.items ?? []
  const detail = docker.detail
  const showingDetail = Boolean(docker.selectedRef)
  const capability = docker.capability
  const capabilityReady = Boolean(capability?.available)
  const capabilityStatusText = capability ? getCapabilityTitle(capability.status, t) : t('workbench.docker.detecting')
  const updatedText = docker.lastUpdatedAt
    ? t('workbench.docker.collectedAt', { time: formatTime(docker.lastUpdatedAt) })
    : t('workbench.processes.updatedNever')
  const capabilityMessage = capability?.message && capability.message !== capabilityStatusText ? capability.message : updatedText
  const listSummary = docker.list
    ? t('workbench.docker.filtered', { count: docker.list.filtered, total: docker.list.total })
    : t('workbench.docker.total', { count: 0 })
  const selectedLabel = getSelectedContainerLabel(docker.selectedRef, items, detail)
  const hasActiveFilters = Boolean(
    docker.query.text ||
      docker.query.port ||
      docker.query.state !== defaultDockerQuery.state ||
      docker.query.health !== defaultDockerQuery.health,
  )

  const resetFilters = () => {
    docker.resetQuery()
    void docker.refreshList(defaultDockerQuery)
  }

  const refreshWithQuery = (patch: Partial<SessionDockerQueryState>) => {
    const query = { ...docker.query, ...patch }
    docker.updateQuery(patch)
    void docker.refreshList(query)
  }

  const runAction = async (ref: string, action: DockerAction) => {
    try {
      const result = await docker.runAction(ref, action)
      notification.success({
        title: t('workbench.docker.actionSuccess'),
        description: result?.message,
        duration: 3,
        role: 'status',
        className: 'termous-notification',
      })
    } catch (error) {
      notification.error({
        title: t('workbench.docker.actionFailed'),
        description: error instanceof Error ? error.message : undefined,
        duration: 4,
        role: 'alert',
        className: 'termous-notification',
      })
    }
  }

  if (!docker.supported) {
    const unavailableKey = !session || session.kind !== 'ssh' || session.status !== 'connected' ? 'empty' : 'unsupported'
    return (
      <WorkbenchEmptyState
        icon={<Boxes size={20} />}
        title={t(unavailableKey === 'empty' ? 'workbench.docker.emptyTitle' : 'workbench.docker.unsupportedTitle')}
        description={t(unavailableKey === 'empty' ? 'workbench.docker.emptyHint' : 'workbench.docker.unsupportedHint')}
      />
    )
  }

  return (
    <section className="docker-panel">
      <div className="docker-toolbar">
        <div className={`docker-capability ${capabilityReady ? 'is-ready' : capability ? 'is-error' : 'is-loading'}`}>
          <span className="docker-capability-icon">
            {capabilityReady ? <Container size={17} /> : capability ? <AlertTriangle size={17} /> : <Boxes size={17} />}
          </span>
          <div className="docker-capability-copy">
            <strong>{t('workbench.docker.managerTitle')}</strong>
            <span>{capabilityMessage}</span>
          </div>
          <span className={`docker-capability-status ${capabilityReady ? 'is-ready' : capability ? 'is-error' : 'is-loading'}`}>
            {capabilityStatusText}
          </span>
        </div>
        <Tooltip title={t('workbench.docker.refresh')}>
          <Button
            type="text"
            className="docker-icon-button"
            aria-label={t('workbench.docker.refresh')}
            loading={docker.loadingCapability || docker.loadingList}
            icon={<RotateCcw size={15} />}
            onClick={() => void docker.refreshAll()}
          />
        </Tooltip>
      </div>

      {!capabilityReady && capability ? (
        <WorkbenchEmptyState
          className="docker-unavailable-state"
          tone={capability.status === 'permission_denied' ? 'warning' : 'danger'}
          icon={<AlertTriangle size={20} />}
          title={getCapabilityTitle(capability.status, t)}
          description={capability.message || t('workbench.docker.unknownStatus')}
        />
      ) : null}

      {capabilityReady ? (
        <>
          <div className="docker-filter-panel">
            <Input
              id="docker-container-search"
              name="docker-container-search"
              className="host-search-input termous-search-input docker-search-input"
              value={docker.query.text}
              allowClear
              variant="borderless"
              prefix={<Search size={14} aria-hidden="true" />}
              placeholder={t('workbench.docker.searchPlaceholder')}
              onChange={(event) => docker.updateQuery({ text: event.target.value })}
              onPressEnter={(event) => refreshWithQuery({ text: event.currentTarget.value })}
            />
            <Popover
              trigger="click"
              placement="bottomRight"
              arrow={false}
              classNames={{ root: 'docker-filter-popover' }}
              content={
                <div className="docker-filter-popover-content">
                  <div className="docker-filter-popover-head">
                    <strong>{t('workbench.docker.filters')}</strong>
                    <Button type="text" size="small" onClick={resetFilters}>
                      {t('workbench.docker.resetFilters')}
                    </Button>
                  </div>
                  <Input
                    id="docker-port-filter"
                    name="docker-port-filter"
                    className="docker-compact-input"
                    value={docker.query.port}
                    allowClear
                    variant="borderless"
                    prefix={<PlugZap size={13} aria-hidden="true" />}
                    placeholder={t('workbench.docker.portPlaceholder')}
                    onChange={(event) => docker.updateQuery({ port: event.target.value.replace(/[^\d]/g, '') })}
                    onPressEnter={(event) => refreshWithQuery({ port: event.currentTarget.value.replace(/[^\d]/g, '') })}
                  />
                  <DockerFilterOptionGroup
                    label={t('workbench.docker.state')}
                    value={docker.query.state}
                    options={stateOptions.map((value) => ({
                      value,
                      label: value ? formatDockerState(value) : t('workbench.docker.stateAll'),
                    }))}
                    onChange={(value) => refreshWithQuery({ state: value })}
                  />
                  <DockerFilterOptionGroup
                    label={t('workbench.docker.health')}
                    value={docker.query.health}
                    options={healthOptions.map((value) => ({
                      value,
                      label: value ? formatDockerState(value) : t('workbench.docker.healthAll'),
                    }))}
                    onChange={(value) => refreshWithQuery({ health: value })}
                  />
                </div>
              }
            >
              <Button
                type="text"
                className={`docker-filter-button ${hasActiveFilters ? 'is-active' : ''}`}
                icon={<ListFilter size={15} />}
              >
                {t('workbench.docker.filters')}
              </Button>
            </Popover>
          </div>

          {docker.error ? (
            <WorkbenchEmptyState
              className="docker-error-state"
              tone="danger"
              icon={<AlertTriangle size={20} />}
              title={t('workbench.docker.loadFailed')}
              description={docker.error}
            />
          ) : null}

          <div className="docker-content">
            {showingDetail ? (
              <DockerDetailView
                detail={detail}
                loading={docker.detailLoading}
                error={docker.detailError}
                selectedRef={docker.selectedRef}
                selectedLabel={selectedLabel}
                actionRef={docker.actionRef}
                logs={docker.logs?.lines ?? detail?.logs_preview ?? []}
                logsLoading={docker.logsLoading}
                onBack={docker.clearSelection}
                onRefreshLogs={() => void docker.refreshLogs()}
                onAction={runAction}
              />
            ) : (
              <div className="docker-list" aria-label={t('workbench.docker.containerList')}>
                <div className="docker-list-summary">
                  <strong>{listSummary}</strong>
                  <span>{updatedText}</span>
                </div>
                {items.length === 0 && !docker.loadingList ? (
                  <WorkbenchEmptyState
                    className="docker-empty-list"
                    icon={<ListFilter size={20} />}
                    title={t(docker.list ? 'workbench.docker.noResults' : 'workbench.docker.loading')}
                    description={docker.list ? undefined : t('workbench.docker.emptyListHint')}
                  />
                ) : null}
                {items.map((item) => (
                  <DockerRow
                    key={item.id || item.name}
                    item={item}
                    selected={docker.selectedRef === getContainerRef(item)}
                    onSelect={() => void docker.selectContainer(getContainerRef(item))}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </section>
  )
}

interface DockerFilterOptionGroupProps {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}

function DockerFilterOptionGroup({ label, value, options, onChange }: DockerFilterOptionGroupProps) {
  return (
    <div className="docker-filter-field">
      <span>{label}</span>
      <div className="docker-filter-options">
        {options.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={`docker-filter-chip ${option.value === value ? 'is-selected' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

interface DockerRowProps {
  item: DockerContainerSummary
  selected: boolean
  onSelect: () => void
}

function DockerRow({ item, selected, onSelect }: DockerRowProps) {
  const { t } = useTranslation()
  const ports = summarizePorts(item.ports ?? [], item.raw_ports)
  const stats = item.stats
  return (
    <button type="button" className={`docker-row ${selected ? 'is-selected' : ''}`} onClick={onSelect}>
      <div className="docker-row-top">
        <div className="docker-row-main">
          <span className="docker-row-icon">
            <Container size={15} />
          </span>
          <div>
            <strong>{item.name || item.short_id || item.id}</strong>
            <Tooltip title={item.image} classNames={{ root: 'termous-tooltip' }}>
              <small>{item.image}</small>
            </Tooltip>
          </div>
        </div>
        <Tag className={`docker-state-tag is-${normalizeStateClass(item.state)}`}>{formatDockerState(item.state)}</Tag>
      </div>
      <div className="docker-row-statline">
        <span>{stats?.cpu_percent || `${t('workbench.docker.stats')} -`}</span>
        <span>{stats?.memory_percent || `${t('workbench.docker.memory')} -`}</span>
        <Tooltip title={ports || t('workbench.docker.noPorts')} classNames={{ root: 'termous-tooltip' }}>
          <span>{ports || t('workbench.docker.noPorts')}</span>
        </Tooltip>
      </div>
    </button>
  )
}

interface DockerDetailViewProps {
  detail: DockerContainerDetail | null
  loading: boolean
  error: string
  selectedRef: string
  selectedLabel: string
  actionRef: string
  logs: string[]
  logsLoading: boolean
  onBack: () => void
  onRefreshLogs: () => void
  onAction: (ref: string, action: DockerAction) => void
}

function DockerDetailView({
  detail,
  loading,
  error,
  selectedRef,
  selectedLabel,
  actionRef,
  logs,
  logsLoading,
  onBack,
  onRefreshLogs,
  onAction,
}: DockerDetailViewProps) {
  const { t } = useTranslation()
  if (loading && !detail) {
    return (
      <div className="docker-detail-card is-loading">
        <div className="docker-detail-topbar">
          <Button type="text" className="docker-detail-back" icon={<ArrowLeft size={14} />} onClick={onBack}>
            {t('workbench.docker.backToList')}
          </Button>
        </div>
        <div className="docker-detail-loading-body">
          <span className="docker-detail-spinner" />
          <strong>{t('workbench.docker.detailLoading')}</strong>
          <small>{selectedLabel || selectedRef}</small>
        </div>
      </div>
    )
  }
  if (error && !detail) {
    return (
      <div className="docker-detail-card">
        <Button type="text" className="docker-detail-back" icon={<ArrowLeft size={14} />} onClick={onBack}>
          {t('workbench.docker.backToList')}
        </Button>
        <WorkbenchEmptyState
          className="docker-detail-empty"
          tone="danger"
          icon={<AlertTriangle size={20} />}
          title={t('workbench.docker.detailFailed')}
          description={error}
        />
      </div>
    )
  }
  if (!detail) {
    return null
  }
  const summary = detail.summary
  const ref = getContainerRef(summary)
  const running = summary.state === 'running'
  const paused = summary.state === 'paused'
  const stopped = summary.state === 'exited' || summary.state === 'created' || summary.state === 'dead'
  const busy = actionRef === ref
  return (
    <article className="docker-detail-card">
      <div className="docker-detail-topbar">
        <Button type="text" className="docker-detail-back" icon={<ArrowLeft size={14} />} onClick={onBack}>
          {t('workbench.docker.backToList')}
        </Button>
        {loading ? (
          <span className="docker-detail-refreshing">
            <LoaderCircle size={13} />
            {t('workbench.docker.detailRefreshing')}
          </span>
        ) : null}
        {!loading && error ? (
          <span className="docker-detail-refreshing is-error">
            <AlertTriangle size={13} />
            {t('workbench.docker.detailRefreshFailed')}
          </span>
        ) : null}
      </div>
      <div className="docker-detail-head">
        <span className="docker-detail-icon">
          <Container size={18} />
        </span>
        <div>
          <strong>{summary.name || summary.short_id || summary.id}</strong>
          <small>{summary.image}</small>
        </div>
        <Tag className={`docker-state-tag is-${normalizeStateClass(summary.state)}`}>{formatDockerState(summary.state)}</Tag>
      </div>
      <div className="docker-action-row">
        {stopped ? (
          <Button className="secondary-button docker-action-button" loading={busy} icon={<Play size={13} />} onClick={() => onAction(ref, 'start')}>
            {t('workbench.docker.start')}
          </Button>
        ) : null}
        {running ? (
          <>
            <Popconfirm
              title={t('workbench.docker.confirmStopTitle')}
              description={t('workbench.docker.confirmStopContent')}
              okText={t('workbench.docker.stop')}
              cancelText={t('app.cancel')}
              onConfirm={() => onAction(ref, 'stop')}
            >
              <Button className="danger-button docker-action-button" loading={busy} icon={<Square size={13} />}>
                {t('workbench.docker.stop')}
              </Button>
            </Popconfirm>
            <Popconfirm
              title={t('workbench.docker.confirmRestartTitle')}
              description={t('workbench.docker.confirmRestartContent')}
              okText={t('workbench.docker.restart')}
              cancelText={t('app.cancel')}
              onConfirm={() => onAction(ref, 'restart')}
            >
              <Button className="secondary-button docker-action-button" loading={busy} icon={<Undo2 size={13} />}>
                {t('workbench.docker.restart')}
              </Button>
            </Popconfirm>
            <Button className="secondary-button docker-action-button" loading={busy} icon={<CirclePause size={13} />} onClick={() => onAction(ref, 'pause')}>
              {t('workbench.docker.pause')}
            </Button>
          </>
        ) : null}
        {paused ? (
          <Button className="secondary-button docker-action-button" loading={busy} icon={<Play size={13} />} onClick={() => onAction(ref, 'unpause')}>
            {t('workbench.docker.unpause')}
          </Button>
        ) : null}
      </div>
      <div className="docker-detail-kpis">
        <DockerKpi label="CPU" value={detail.stats?.cpu_percent || '-'} />
        <DockerKpi label={t('workbench.docker.memory')} value={detail.stats?.memory_percent || detail.stats?.memory || '-'} />
        <DockerKpi label="PIDs" value={detail.stats?.pids || '-'} />
        <DockerKpi label="Net" value={detail.stats?.net_io || '-'} />
      </div>
      <dl className="docker-detail-list">
        <DockerDetailItem label="ID" value={summary.short_id || summary.id} />
        <DockerDetailItem label={t('workbench.docker.created')} value={detail.created || summary.created_at || t('fields.none')} />
        <DockerDetailItem label={t('workbench.docker.restartPolicy')} value={detail.restart_policy || t('fields.none')} />
        <DockerDetailItem label={t('workbench.docker.ports')} value={summarizePorts(summary.ports ?? [], summary.raw_ports) || t('workbench.docker.noPorts')} />
        <DockerDetailItem label={t('workbench.docker.command')} value={[detail.path, ...(detail.args ?? [])].filter(Boolean).join(' ') || summary.command || t('fields.none')} />
      </dl>
      <DockerCompactSection
        title={t('workbench.docker.mounts')}
        values={(detail.mounts ?? []).map((mount) => `${mount.source || '-'} → ${mount.destination || '-'}`)}
      />
      <DockerCompactSection
        title={t('workbench.docker.networks')}
        values={(detail.networks ?? []).map((network) => `${network.name}${network.ip_address ? ` · ${network.ip_address}` : ''}`)}
      />
      <div className="docker-log-section">
        <div className="docker-section-head">
          <span>
            <FileText size={13} />
            {t('workbench.docker.logs')}
          </span>
          <Button
            type="text"
            className="docker-mini-button"
            loading={logsLoading}
            icon={<RotateCcw size={13} />}
            onClick={onRefreshLogs}
          >
            {t('app.reload')}
          </Button>
        </div>
        {logs.length > 0 ? (
          <pre>{logs.slice(-80).join('\n')}</pre>
        ) : (
          <span className="docker-muted-line">{t('workbench.docker.noLogs')}</span>
        )}
      </div>
    </article>
  )
}

function DockerKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="docker-kpi">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DockerDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <Tooltip title={value} classNames={{ root: 'termous-tooltip' }}>
        <dd>{value}</dd>
      </Tooltip>
    </div>
  )
}

function DockerCompactSection({ title, values }: { title: string; values: string[] }) {
  if (values.length === 0) {
    return null
  }
  return (
    <section className="docker-compact-section">
      <strong>{title}</strong>
      <div>
        {values.slice(0, 4).map((value) => (
          <Tooltip key={value} title={value} classNames={{ root: 'termous-tooltip' }}>
            <span>{value}</span>
          </Tooltip>
        ))}
      </div>
    </section>
  )
}

function getContainerRef(item: DockerContainerSummary): string {
  return item.id || item.name || item.short_id
}

function getSelectedContainerLabel(ref: string, items: DockerContainerSummary[], detail: DockerContainerDetail | null): string {
  if (detail) {
    return detail.summary.name || detail.summary.short_id || detail.summary.id || ref
  }
  const matched = items.find((item) => getContainerRef(item) === ref || item.id === ref || item.short_id === ref || item.name === ref)
  return matched?.name || matched?.short_id || matched?.id || ref
}

function getCapabilityTitle(status: string, t: (key: string) => string) {
  switch (status) {
    case 'available':
      return t('workbench.docker.available')
    case 'missing_cli':
      return t('workbench.docker.missingCli')
    case 'daemon_unavailable':
      return t('workbench.docker.daemonUnavailable')
    case 'permission_denied':
      return t('workbench.docker.permissionDenied')
    default:
      return t('workbench.docker.unknownStatus')
  }
}

function summarizePorts(ports: DockerContainerPort[], rawPorts?: string): string {
  const mapped = ports
    .map((port) => {
      if (port.public_port && port.private_port) {
        const host = port.ip ? `${port.ip}:` : ''
        return `${host}${port.public_port}→${port.private_port}/${port.type || 'tcp'}`
      }
      if (port.private_port) {
        return `${port.private_port}/${port.type || 'tcp'}`
      }
      return port.raw || ''
    })
    .filter(Boolean)
  return mapped.join('  ') || rawPorts || ''
}

function normalizeStateClass(state: string): string {
  return (state || 'unknown').toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

function formatDockerState(state?: string): string {
  if (!state) {
    return '-'
  }
  return state.slice(0, 1).toUpperCase() + state.slice(1)
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
