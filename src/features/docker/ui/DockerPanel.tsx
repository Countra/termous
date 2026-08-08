import { App, Button, Input, Modal, Popconfirm, Popover, Select, Tag, Tooltip } from 'antd'
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  CirclePause,
  Container,
  CornerDownRight,
  FileText,
  ListFilter,
  LoaderCircle,
  Play,
  PlugZap,
  RotateCcw,
  Search,
  Square,
  Undo2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { DockerAction, DockerContainerDetail, DockerContainerPort, DockerContainerSummary } from '#entities/docker'
import { customSelectStyles, uiStyles, WorkspaceDetectionLoading, WorkspaceEmptyState, termousNotificationClassName } from '#shared/ui'
import type { DockerGateway, DockerSessionContext } from '../model/contracts'
import { defaultDockerQuery, type SessionDockerQueryState, useSessionDocker } from '../model/useSessionDocker'
import styles from './DockerPanel.module.scss'

export interface DockerPanelProps {
  api: DockerGateway
  session: DockerSessionContext | null
  enabled: boolean
}

const stateOptions = ['', 'running', 'exited', 'paused', 'restarting', 'created', 'dead']
const healthOptions = ['', 'healthy', 'unhealthy', 'starting', 'none']

export function DockerPanel({ api, session, enabled }: DockerPanelProps) {
  const { t } = useTranslation()
  const { notification } = App.useApp()
  const docker = useSessionDocker({ api, session, enabled })
  const interactionScopeRef = useRef({ enabled, sessionId: session?.id, supported: docker.supported })
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

  interactionScopeRef.current = { enabled, sessionId: session?.id, supported: docker.supported }

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
    const expectedSessionId = session?.id
    const scope = interactionScopeRef.current
    if (!scope.enabled || !scope.supported || !expectedSessionId || scope.sessionId !== expectedSessionId) {
      return
    }
    try {
      const result = await docker.runAction(ref, action)
      notification.success({
        title: t('workbench.docker.actionSuccess'),
        description: result?.message,
        duration: 3,
        role: 'status',
        className: termousNotificationClassName,
      })
    } catch (error) {
      notification.error({
        title: t('workbench.docker.actionFailed'),
        description: error instanceof Error ? error.message : undefined,
        duration: 4,
        role: 'alert',
        className: termousNotificationClassName,
      })
    }
  }

  if (!docker.supported) {
    const unavailableKey = !session || session.kind !== 'ssh' || session.status !== 'connected' ? 'empty' : 'unsupported'
    return (
      <WorkspaceEmptyState
        icon={<Boxes size={20} />}
        title={t(unavailableKey === 'empty' ? 'workbench.docker.emptyTitle' : 'workbench.docker.unsupportedTitle')}
        description={t(unavailableKey === 'empty' ? 'workbench.docker.emptyHint' : 'workbench.docker.unsupportedHint')}
      />
    )
  }

  if (!capability || (capability.available && !docker.list && !docker.error)) {
    return <WorkspaceDetectionLoading icon={<Boxes size={15} />} label={t('workbench.docker.detecting')} />
  }

  return (
    <section className={[styles['docker-panel'], styles.root].join(' ')}>
      <div className={styles['docker-toolbar']}>
        <div className={[
          styles['docker-capability'],
          capabilityReady
            ? styles['is-ready']
            : capability
              ? styles['is-error']
              : styles['is-loading'],
        ].filter(Boolean).join(' ')}>
          <span className={styles['docker-capability-icon']}>
            {capabilityReady ? <Container size={17} /> : capability ? <AlertTriangle size={17} /> : <Boxes size={17} />}
          </span>
          <div className={styles['docker-capability-copy']}>
            <strong>{t('workbench.docker.managerTitle')}</strong>
            <span>{capabilityMessage}</span>
          </div>
          <span className={[
            styles['docker-capability-status'],
            capabilityReady
              ? styles['is-ready']
              : capability
                ? styles['is-error']
                : styles['is-loading'],
          ].filter(Boolean).join(' ')}>
            {capabilityStatusText}
          </span>
        </div>
        <Tooltip title={t('workbench.docker.refresh')}>
          <Button
            type="text"
            className={styles['docker-icon-button']}
            aria-label={t('workbench.docker.refresh')}
            loading={docker.loadingCapability || docker.loadingList}
            icon={<RotateCcw size={15} />}
            onClick={() => void docker.refreshAll()}
          />
        </Tooltip>
      </div>

      {!capabilityReady && capability ? (
        <WorkspaceEmptyState
          className={styles['docker-unavailable-state']}
          tone={capability.status === 'permission_denied' ? 'warning' : 'danger'}
          icon={<AlertTriangle size={20} />}
          title={getCapabilityTitle(capability.status, t)}
          description={capability.message || t('workbench.docker.unknownStatus')}
        />
      ) : null}

      {capabilityReady ? (
        <>
          <div className={styles['docker-filter-panel']}>
            <Input
              id="docker-container-search"
              name="docker-container-search"
              className={`host-search-input ${uiStyles['search-input']} termous-search-input ${styles['docker-search-input']}`}
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
              classNames={{ root: styles['docker-filter-popover'] }}
              content={
                <div className={styles['docker-filter-popover-content']}>
                  <div className={styles['docker-filter-popover-head']}>
                    <strong>{t('workbench.docker.filters')}</strong>
                    <Button type="text" size="small" onClick={resetFilters}>
                      {t('workbench.docker.resetFilters')}
                    </Button>
                  </div>
                  <Input
                    id="docker-port-filter"
                    name="docker-port-filter"
                    className={styles['docker-compact-input']}
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
                className={[
                  styles['docker-filter-button'],
                  hasActiveFilters ? styles['is-active'] : '',
                ].filter(Boolean).join(' ')}
                icon={<ListFilter size={15} />}
              >
                {t('workbench.docker.filters')}
              </Button>
            </Popover>
          </div>

          {docker.error ? (
            <WorkspaceEmptyState
              className={styles['docker-error-state']}
              tone="danger"
              icon={<AlertTriangle size={20} />}
              title={t('workbench.docker.loadFailed')}
              description={docker.error}
            />
          ) : null}

          <div className={styles['docker-content']}>
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
                logsError={docker.logsError}
                logTail={docker.query.logTail}
                logsCollectedAt={docker.logs?.collected_at ?? detail?.collected_at ?? ''}
                enabled={enabled}
                onBack={docker.clearSelection}
                onRefreshLogs={(tail) => {
                  const nextTail = tail ?? docker.query.logTail
                  if (nextTail !== docker.query.logTail) {
                    docker.updateQuery({ logTail: nextTail })
                  }
                  void docker.refreshLogs(undefined, nextTail)
                }}
                onAction={runAction}
              />
            ) : (
              <div className={styles['docker-list']} aria-label={t('workbench.docker.containerList')}>
                <div className={styles['docker-list-summary']}>
                  <strong>{listSummary}</strong>
                  <span>{updatedText}</span>
                </div>
                {items.length === 0 && !docker.loadingList ? (
                  <WorkspaceEmptyState
                    className={styles['docker-empty-list']}
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
    <div className={styles['docker-filter-field']}>
      <span>{label}</span>
      <div className={styles['docker-filter-options']}>
        {options.map((option) => (
          <button
            key={option.value || 'all'}
            type="button"
            className={[
              styles['docker-filter-chip'],
              option.value === value ? styles['is-selected'] : '',
            ].filter(Boolean).join(' ')}
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
    <button
      type="button"
      className={[styles['docker-row'], selected ? styles['is-selected'] : ''].filter(Boolean).join(' ')}
      onClick={onSelect}
    >
      <div className={styles['docker-row-top']}>
        <div className={styles['docker-row-main']}>
          <span className={styles['docker-row-icon']}>
            <Container size={15} />
          </span>
          <div>
            <strong>{item.name || item.short_id || item.id}</strong>
            <Tooltip title={item.image} classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}>
              <small>{item.image}</small>
            </Tooltip>
          </div>
        </div>
        <Tag className={[
          styles['docker-state-tag'],
          styles[`is-${normalizeStateClass(item.state)}`],
        ].filter(Boolean).join(' ')}>{formatDockerState(item.state)}</Tag>
      </div>
      <div className={styles['docker-row-statline']}>
        <span>
          <small>CPU</small>
          <strong>{stats?.cpu_percent || '-'}</strong>
        </span>
        <span>
          <small>{t('workbench.docker.memory')}</small>
          <strong>{stats?.memory_percent || '-'}</strong>
        </span>
        <Tooltip title={ports || t('workbench.docker.noPorts')} classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}>
          <span>
            <small>{t('workbench.docker.ports')}</small>
            <strong>{ports || t('workbench.docker.noPorts')}</strong>
          </span>
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
  logsError: string
  logTail: number
  logsCollectedAt: string
  enabled: boolean
  onBack: () => void
  onRefreshLogs: (tail?: number) => void
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
  logsError,
  logTail,
  logsCollectedAt,
  enabled,
  onBack,
  onRefreshLogs,
  onAction,
}: DockerDetailViewProps) {
  const { t } = useTranslation()
  const [logsOpen, setLogsOpen] = useState(false)
  const [actionConfirm, setActionConfirm] = useState<'stop' | 'restart' | null>(null)
  const interactionScopeRef = useRef({ enabled, selectedRef })
  interactionScopeRef.current = { enabled, selectedRef }
  useEffect(() => {
    if (!enabled) {
      setLogsOpen(false)
    }
    setActionConfirm(null)
  }, [enabled, selectedRef])

  const confirmAction = (ref: string, action: 'stop' | 'restart') => {
    setActionConfirm(null)
    const scope = interactionScopeRef.current
    if (!scope.enabled || scope.selectedRef !== ref) {
      return
    }
    onAction(ref, action)
  }
  if (loading && !detail) {
    return (
      <div className={[styles['docker-detail-card'], styles['is-loading']].join(' ')}>
        <div className={styles['docker-detail-topbar']}>
          <Button type="text" className={styles['docker-detail-back']} icon={<ArrowLeft size={14} />} onClick={onBack}>
            {t('workbench.docker.backToList')}
          </Button>
        </div>
        <div className={styles['docker-detail-loading-body']}>
          <span className={styles['docker-detail-spinner']} />
          <strong>{t('workbench.docker.detailLoading')}</strong>
          <small>{selectedLabel || selectedRef}</small>
        </div>
      </div>
    )
  }
  if (error && !detail) {
    return (
      <div className={styles['docker-detail-card']}>
        <Button type="text" className={styles['docker-detail-back']} icon={<ArrowLeft size={14} />} onClick={onBack}>
          {t('workbench.docker.backToList')}
        </Button>
        <WorkspaceEmptyState
          className={styles['docker-detail-empty']}
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

  const openLogs = () => {
    setLogsOpen(true)
    onRefreshLogs(logTail)
  }

  return (
    <>
      <article className={styles['docker-detail-card']}>
        <div className={styles['docker-detail-topbar']}>
          <Button type="text" className={styles['docker-detail-back']} icon={<ArrowLeft size={14} />} onClick={onBack}>
            {t('workbench.docker.backToList')}
          </Button>
          {loading ? (
            <span className={styles['docker-detail-refreshing']}>
              <LoaderCircle size={13} />
              {t('workbench.docker.detailRefreshing')}
            </span>
          ) : null}
          {!loading && error ? (
            <span className={[styles['docker-detail-refreshing'], styles['is-error']].join(' ')}>
              <AlertTriangle size={13} />
              {t('workbench.docker.detailRefreshFailed')}
            </span>
          ) : null}
        </div>
        <div className={styles['docker-detail-head']}>
          <span className={styles['docker-detail-icon']}>
            <Container size={18} />
          </span>
          <div>
            <strong>{summary.name || summary.short_id || summary.id}</strong>
            <small>{summary.image}</small>
          </div>
          <Tag className={[
            styles['docker-state-tag'],
            styles[`is-${normalizeStateClass(summary.state)}`],
          ].filter(Boolean).join(' ')}>{formatDockerState(summary.state)}</Tag>
        </div>
        <div className={styles['docker-action-row']}>
          {stopped ? (
            <Button className={`${uiStyles['secondary-button']} secondary-button ${styles['docker-action-button']}`} loading={busy} icon={<Play size={13} />} onClick={() => onAction(ref, 'start')}>
              {t('workbench.docker.start')}
            </Button>
          ) : null}
          {running ? (
            <>
              <Popconfirm
                open={actionConfirm === 'stop'}
                title={t('workbench.docker.confirmStopTitle')}
                description={t('workbench.docker.confirmStopContent')}
                okText={t('workbench.docker.stop')}
                cancelText={t('app.cancel')}
                onOpenChange={(open) => setActionConfirm(open ? 'stop' : null)}
                onConfirm={() => confirmAction(ref, 'stop')}
              >
                <Button className={`${uiStyles['danger-button']} danger-button ${styles['docker-action-button']}`} loading={busy} icon={<Square size={13} />}>
                  {t('workbench.docker.stop')}
                </Button>
              </Popconfirm>
              <Popconfirm
                open={actionConfirm === 'restart'}
                title={t('workbench.docker.confirmRestartTitle')}
                description={t('workbench.docker.confirmRestartContent')}
                okText={t('workbench.docker.restart')}
                cancelText={t('app.cancel')}
                onOpenChange={(open) => setActionConfirm(open ? 'restart' : null)}
                onConfirm={() => confirmAction(ref, 'restart')}
              >
                <Button className={`${uiStyles['secondary-button']} secondary-button ${styles['docker-action-button']}`} loading={busy} icon={<Undo2 size={13} />}>
                  {t('workbench.docker.restart')}
                </Button>
              </Popconfirm>
              <Button className={`${uiStyles['secondary-button']} secondary-button ${styles['docker-action-button']}`} loading={busy} icon={<CirclePause size={13} />} onClick={() => onAction(ref, 'pause')}>
                {t('workbench.docker.pause')}
              </Button>
            </>
          ) : null}
          {paused ? (
            <Button className={`${uiStyles['secondary-button']} secondary-button ${styles['docker-action-button']}`} loading={busy} icon={<Play size={13} />} onClick={() => onAction(ref, 'unpause')}>
              {t('workbench.docker.unpause')}
            </Button>
          ) : null}
        </div>
        <div className={styles['docker-detail-kpis']}>
          <DockerKpi label="CPU" value={detail.stats?.cpu_percent || '-'} />
          <DockerKpi label={t('workbench.docker.memory')} value={detail.stats?.memory_percent || detail.stats?.memory || '-'} />
          <DockerKpi label="PIDs" value={detail.stats?.pids || '-'} />
          <DockerKpi label="Net" value={detail.stats?.net_io || '-'} />
        </div>
        <dl className={styles['docker-detail-list']}>
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
        <div className={styles['docker-log-section']}>
          <div className={styles['docker-section-head']}>
            <span>
              <FileText size={13} />
              {t('workbench.docker.logs')}
            </span>
            <div className={styles['docker-log-actions']}>
              <Button
                type="text"
                className={styles['docker-mini-button']}
                loading={logsLoading}
                icon={<RotateCcw size={13} />}
                onClick={() => onRefreshLogs(logTail)}
              >
                {t('app.reload')}
              </Button>
              <Button type="text" className={styles['docker-mini-button']} icon={<CornerDownRight size={13} />} onClick={openLogs}>
                {t('workbench.docker.logsOpen')}
              </Button>
            </div>
          </div>
          {logs.length > 0 ? (
            <pre>{logs.slice(-24).join('\n')}</pre>
          ) : (
            <span className={styles['docker-muted-line']}>{t('workbench.docker.noLogs')}</span>
          )}
        </div>
      </article>
      <DockerLogsModal
        open={logsOpen}
        containerName={summary.name || summary.short_id || summary.id}
        logs={logs}
        loading={logsLoading}
        error={logsError}
        tail={logTail}
        collectedAt={logsCollectedAt}
        onClose={() => setLogsOpen(false)}
        onRefresh={onRefreshLogs}
      />
    </>
  )
}

interface DockerLogsModalProps {
  open: boolean
  containerName: string
  logs: string[]
  loading: boolean
  error: string
  tail: number
  collectedAt: string
  onClose: () => void
  onRefresh: (tail?: number) => void
}

const dockerLogTailValues = [100, 500, 1000]
const maxDockerLogTail = 1000

function normalizeDockerLogTailValue(tail: number) {
  if (!Number.isFinite(tail) || tail <= 0) {
    return 200
  }
  return Math.min(Math.trunc(tail), maxDockerLogTail)
}

function getDockerLogTailOptions(tail: number) {
  const normalizedTail = normalizeDockerLogTailValue(tail)
  const values = dockerLogTailValues.includes(normalizedTail)
    ? dockerLogTailValues
    : [...dockerLogTailValues, normalizedTail].sort((left, right) => left - right)
  return values.map((value) => ({ value, label: `${value}` }))
}

function DockerLogsModal({ open, containerName, logs, loading, error, tail, collectedAt, onClose, onRefresh }: DockerLogsModalProps) {
  const { t } = useTranslation()
  const consoleRef = useRef<HTMLDivElement | null>(null)
  const normalizedTail = normalizeDockerLogTailValue(tail)
  const [query, setQuery] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regexMode, setRegexMode] = useState(false)
  const [wrapLines, setWrapLines] = useState(false)
  const [followTail, setFollowTail] = useState(true)
  const [activeMatch, setActiveMatch] = useState(0)
  const searchResult = useMemo(() => buildLogSearchResult(logs, query, caseSensitive, regexMode), [caseSensitive, logs, query, regexMode])
  const matchCount = searchResult.matches.length
  const visibleActiveMatch = matchCount > 0 ? Math.min(activeMatch, matchCount - 1) : 0

  useEffect(() => {
    setActiveMatch(0)
  }, [caseSensitive, logs, query, regexMode])

  useEffect(() => {
    if (!followTail || !consoleRef.current) {
      return
    }
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight
  }, [followTail, logs])

  useEffect(() => {
    if (!query || matchCount === 0 || !consoleRef.current) {
      return
    }
    const target = consoleRef.current.querySelector<HTMLElement>(`[data-log-match-index="${visibleActiveMatch}"]`)
    target?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [matchCount, query, visibleActiveMatch])

  const moveMatch = (direction: number) => {
    if (matchCount === 0) {
      return
    }
    setActiveMatch((current) => (current + direction + matchCount) % matchCount)
  }

  const statusText = searchResult.invalidRegex
    ? t('workbench.docker.logsInvalidRegex')
    : query
      ? t('workbench.docker.logsMatchPosition', {
          current: matchCount > 0 ? visibleActiveMatch + 1 : 0,
          total: matchCount,
        })
      : t('workbench.docker.logsMatchCount', { count: 0 })
  const headerStatusClass = loading ? 'is-loading' : error ? 'is-error' : 'is-ready'
  const headerStatusText = loading
    ? t('workbench.docker.logsLoading')
    : error
      ? t('workbench.docker.logsFailed')
      : collectedAt
        ? t('workbench.docker.collectedAt', { time: formatTime(collectedAt) })
        : t('workbench.processes.updatedNever')

  return (
    <Modal
      centered
      className={styles['docker-logs-modal']}
      rootClassName={styles['docker-logs-modal-root']}
      open={open}
      width="min(1120px, calc(100vw - 80px))"
      footer={null}
      title={null}
      closable={false}
      onCancel={onClose}
    >
      <article className={styles['docker-logs-view']}>
        <header className={styles['docker-logs-modal-header']}>
          <div className={styles['docker-logs-title']}>
            <span className={styles['docker-logs-title-icon']}>
              <FileText size={19} />
            </span>
            <div className={styles['docker-logs-title-copy']}>
              <strong>{t('workbench.docker.logsViewerTitle')}</strong>
              <span>{containerName}</span>
            </div>
          </div>
          <div className={styles['docker-logs-header-actions']}>
            <span className={[styles['docker-logs-state'], styles[headerStatusClass]].filter(Boolean).join(' ')}>
              {loading ? <LoaderCircle size={13} /> : error ? <AlertTriangle size={13} /> : <FileText size={13} />}
              {headerStatusText}
            </span>
            <Button type="text" className={styles['docker-logs-close']} icon={<X size={16} />} onClick={onClose} aria-label={t('app.close')} />
          </div>
        </header>
        <section className={styles['docker-logs-shell']}>
          <div className={styles['docker-logs-control-surface']}>
            <div className={styles['docker-logs-primary-row']}>
              <Input
                className={`host-search-input ${uiStyles['search-input']} termous-search-input ${styles['docker-logs-search']}`}
                value={query}
                allowClear
                variant="borderless"
                prefix={<Search size={14} aria-hidden="true" />}
                placeholder={t('workbench.docker.logsSearchPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
                onPressEnter={(event) => {
                  event.preventDefault()
                  moveMatch(event.shiftKey ? -1 : 1)
                }}
              />
              <div className={styles['docker-logs-match-controls']}>
                <Button type="text" className={styles['docker-log-tool-button']} disabled={matchCount === 0} onClick={() => moveMatch(-1)}>
                  {t('workbench.docker.logsPrevious')}
                </Button>
                <Button type="text" className={styles['docker-log-tool-button']} disabled={matchCount === 0} onClick={() => moveMatch(1)}>
                  {t('workbench.docker.logsNext')}
                </Button>
              </div>
              <Select
                className={styles['docker-log-tail-select']}
                popupClassName={`${customSelectStyles['select-dropdown']} termous-select-dropdown`}
                value={normalizedTail}
                options={getDockerLogTailOptions(normalizedTail)}
                onChange={(value) => onRefresh(value)}
              />
            </div>
            <div className={styles['docker-logs-secondary-row']}>
              <div className={styles['docker-logs-options']} aria-label={t('workbench.docker.logsOptions')}>
                <button type="button" className={caseSensitive ? styles['is-active'] : ''} onClick={() => setCaseSensitive((value) => !value)}>
                  Aa
                </button>
                <button type="button" className={regexMode ? styles['is-active'] : ''} onClick={() => setRegexMode((value) => !value)}>
                  .*
                </button>
                <button type="button" className={wrapLines ? styles['is-active'] : ''} onClick={() => setWrapLines((value) => !value)}>
                  {t('workbench.docker.logsWrap')}
                </button>
                <button type="button" className={followTail ? styles['is-active'] : ''} onClick={() => setFollowTail((value) => !value)}>
                  {t('workbench.docker.logsFollowTail')}
                </button>
              </div>
              <Button
                type="text"
                className={[styles['docker-log-tool-button'], styles['is-refresh']].join(' ')}
                loading={loading}
                icon={<RotateCcw size={13} />}
                onClick={() => onRefresh(normalizedTail)}
              >
                {t('app.reload')}
              </Button>
            </div>
          </div>
          <div
            ref={consoleRef}
            className={[
              styles['docker-logs-console'],
              wrapLines ? styles['is-wrap'] : '',
            ].filter(Boolean).join(' ')}
            role="log"
            aria-live="polite"
          >
            {logs.length > 0 ? (
              logs.map((line, lineIndex) => (
                <div
                  key={`line-${lineIndex}`}
                  className={[
                    styles['docker-log-line'],
                    styles[getLogToneClass(line)],
                  ].filter(Boolean).join(' ')}
                >
                  <span className={styles['docker-log-line-number']}>{lineIndex + 1}</span>
                  <code>{renderLogLine(line, searchResult.lineMatches[lineIndex] ?? [], visibleActiveMatch)}</code>
                </div>
              ))
            ) : (
              <div className={styles['docker-logs-empty']}>
                <FileText size={18} />
                <strong>{t('workbench.docker.noLogs')}</strong>
              </div>
            )}
          </div>
          <footer className={styles['docker-logs-status']}>
            <span>{t('workbench.docker.logsLineCount', { count: logs.length })}</span>
            <span>{statusText}</span>
            <span>{collectedAt ? t('workbench.docker.collectedAt', { time: formatTime(collectedAt) }) : t('workbench.processes.updatedNever')}</span>
          </footer>
        </section>
      </article>
    </Modal>
  )
}

interface DockerLogMatch {
  start: number
  end: number
  index: number
}

interface DockerLogSearchResult {
  matches: Array<{ lineIndex: number; match: DockerLogMatch }>
  lineMatches: Record<number, DockerLogMatch[]>
  invalidRegex: boolean
}

function buildLogSearchResult(lines: string[], query: string, caseSensitive: boolean, regexMode: boolean): DockerLogSearchResult {
  if (!query) {
    return { matches: [], lineMatches: {}, invalidRegex: false }
  }

  if (regexMode) {
    try {
      return buildRegexLogSearchResult(lines, query, caseSensitive)
    } catch {
      return { matches: [], lineMatches: {}, invalidRegex: true }
    }
  }

  return buildTextLogSearchResult(lines, query, caseSensitive)
}

function buildTextLogSearchResult(lines: string[], query: string, caseSensitive: boolean): DockerLogSearchResult {
  const matches: DockerLogSearchResult['matches'] = []
  const lineMatches: DockerLogSearchResult['lineMatches'] = {}
  const needle = caseSensitive ? query : query.toLowerCase()
  lines.forEach((line, lineIndex) => {
    const haystack = caseSensitive ? line : line.toLowerCase()
    let position = haystack.indexOf(needle)
    while (position >= 0) {
      const match = { start: position, end: position + query.length, index: matches.length }
      matches.push({ lineIndex, match })
      const matchesInLine = lineMatches[lineIndex] ?? []
      matchesInLine.push(match)
      lineMatches[lineIndex] = matchesInLine
      position = haystack.indexOf(needle, position + Math.max(query.length, 1))
    }
  })
  return { matches, lineMatches, invalidRegex: false }
}

function buildRegexLogSearchResult(lines: string[], query: string, caseSensitive: boolean): DockerLogSearchResult {
  const matches: DockerLogSearchResult['matches'] = []
  const lineMatches: DockerLogSearchResult['lineMatches'] = {}
  const expression = new RegExp(query, caseSensitive ? 'g' : 'gi')
  lines.forEach((line, lineIndex) => {
    expression.lastIndex = 0
    let result = expression.exec(line)
    while (result) {
      const value = result[0]
      if (!value) {
        break
      }
      const match = { start: result.index, end: result.index + value.length, index: matches.length }
      matches.push({ lineIndex, match })
      const matchesInLine = lineMatches[lineIndex] ?? []
      matchesInLine.push(match)
      lineMatches[lineIndex] = matchesInLine
      result = expression.exec(line)
    }
  })
  return { matches, lineMatches, invalidRegex: false }
}

function renderLogLine(line: string, matches: DockerLogMatch[], activeMatch: number) {
  if (matches.length === 0) {
    return line || ' '
  }

  const nodes: ReactNode[] = []
  let cursor = 0
  matches.forEach((match) => {
    if (match.start > cursor) {
      nodes.push(line.slice(cursor, match.start))
    }
    nodes.push(
      <mark
        key={`${match.start}-${match.end}-${match.index}`}
        className={match.index === activeMatch ? styles['is-active'] : ''}
        data-log-match-index={match.index}
      >
        {line.slice(match.start, match.end)}
      </mark>,
    )
    cursor = match.end
  })
  if (cursor < line.length) {
    nodes.push(line.slice(cursor))
  }
  return nodes
}

function getLogToneClass(line: string): string {
  const normalized = line.toLowerCase()
  if (normalized.includes('error') || normalized.includes('failed') || normalized.includes('fatal')) {
    return 'is-error'
  }
  if (normalized.includes('warn')) {
    return 'is-warning'
  }
  return ''
}

function DockerKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles['docker-kpi']}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DockerDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <Tooltip title={value} classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}>
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
    <section className={styles['docker-compact-section']}>
      <strong>{title}</strong>
      <div>
        {values.slice(0, 4).map((value) => (
          <Tooltip key={value} title={value} classNames={{ root: `${uiStyles.tooltip} termous-tooltip` }}>
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
