import { App, Button, Dropdown, Input, Popover, Segmented, Select, Tag, Tooltip, type MenuProps } from 'antd'
import {
  AlertTriangle,
  ArrowLeft,
  Cog,
  FileText,
  Gauge,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Square,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TermousApi } from '../../api/client'
import type {
  Session,
  SystemServiceAction,
  SystemServiceDetail,
  SystemServiceOperation,
  SystemServiceSummary,
} from '../../types/domain'
import { WorkbenchEmptyState } from './WorkbenchEmptyState'
import { ServiceLogsModal } from './ServiceLogsModal'
import {
  defaultServiceQuery,
  type SessionServiceQueryState,
  useSessionServices,
} from './useSessionServices'
import './service-panel.css'

interface ServicePanelProps {
  api: TermousApi
  session: Session | null
  enabled: boolean
}

const unitFileStates = ['', 'enabled', 'disabled', 'masked', 'static', 'indirect']
const serviceSorts: SessionServiceQueryState['sort'][] = ['name', 'description', 'runtime', 'unit_file']

export function ServicePanel({ api, session, enabled }: ServicePanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = App.useApp()
  const services = useSessionServices({ api, session, enabled })
  const [logsOpen, setLogsOpen] = useState(false)
  const items = services.list?.items ?? []
  const detail = services.detail
  const selectedUnitId = services.selectedUnitId
  const operation = selectedUnitId ? services.operations[selectedUnitId] : undefined
  const operationBusy = Boolean(
    (operation && !isTerminalOperation(operation)) || services.submittingUnits[selectedUnitId],
  )
  const hasFilters = Boolean(
    services.query.runtimeState ||
    services.query.unitFileState ||
    services.query.sort !== defaultServiceQuery.sort ||
    services.query.order !== defaultServiceQuery.order,
  )

  useEffect(() => {
    setLogsOpen(false)
  }, [session?.id, services.supported])

  const runtimeOptions = useMemo(
    () => [
      { value: '', label: t('workbench.services.filtersAll') },
      { value: 'running', label: t('workbench.services.filtersRunning') },
      { value: 'stopped', label: t('workbench.services.filtersStopped') },
      { value: 'failed', label: t('workbench.services.filtersFailed') },
    ],
    [t],
  )

  const applyQuery = (patch: Partial<SessionServiceQueryState>) => {
    const query = { ...services.query, ...patch }
    services.updateQuery(patch)
    void services.refreshList(query)
  }

  const resetFilters = () => {
    services.resetQuery()
    void services.refreshList(defaultServiceQuery)
  }

  const executeAction = async (unitId: string, action: SystemServiceAction) => {
    try {
      await services.runAction(unitId, action)
      notification.info({
        title: t('workbench.services.actionQueued'),
        description: t(`workbench.services.actions.${action}`),
        duration: 2.5,
        role: 'status',
        className: 'termous-notification',
      })
    } catch (error) {
      notification.error({
        title: t('workbench.services.actionFailed'),
        description: error instanceof Error ? error.message : undefined,
        duration: 4,
        role: 'alert',
        className: 'termous-notification',
      })
    }
  }

  const requestAction = (unitId: string, action: SystemServiceAction) => {
    const requiresConfirmation = isRiskyAction(action) || isCriticalService(unitId)
    if (!requiresConfirmation) {
      void executeAction(unitId, action)
      return
    }
    const critical = isCriticalService(unitId)
    modal.confirm({
      centered: true,
      className: 'service-action-confirm',
      title: t('workbench.services.confirmTitle', { action: t(`workbench.services.actions.${action}`) }),
      content: critical
        ? t('workbench.services.confirmCritical', { unit: unitId })
        : t('workbench.services.confirmContent', { unit: unitId }),
      okText: t(`workbench.services.actions.${action}`),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: action === 'mask' || action === 'stop' },
      onOk: () => executeAction(unitId, action),
    })
  }

  const openLogs = () => {
    if (!selectedUnitId) {
      return
    }
    setLogsOpen(true)
    void services.refreshLogs(selectedUnitId, services.logQuery, false)
  }

  if (!services.supported) {
    return (
      <WorkbenchEmptyState
        icon={<Cog size={20} />}
        title={t('workbench.services.emptyTitle')}
        description={t('workbench.services.emptyHint')}
      />
    )
  }

  if (!services.capability) {
    if (services.error && !services.loadingCapability) {
      return (
        <ServiceUnavailable
          title={t('workbench.services.detectFailed')}
          description={services.error}
          tone="danger"
          loading={false}
          onRefresh={() => void services.refreshAll()}
        />
      )
    }
    return (
      <ServiceUnavailable
        title={t('workbench.services.detecting')}
        description={t('workbench.services.detectingHint')}
        loading
        onRefresh={() => void services.refreshAll()}
      />
    )
  }

  if (!services.capability.available) {
    return (
      <ServiceUnavailable
        title={t(`workbench.services.capability.${services.capability.status}`)}
        description={services.capability.message || t('workbench.services.unavailableHint')}
        tone="warning"
        loading={services.loadingCapability}
        onRefresh={() => void services.refreshAll()}
      />
    )
  }

  const summary = services.list
    ? t('workbench.services.filtered', { count: services.list.filtered, total: services.list.total })
    : t('workbench.services.total', { count: 0 })

  return (
    <section className="service-panel">
      <div className="service-statusbar">
        <div className="service-statusbar-copy">
          <span className={`service-live-dot ${services.error ? 'is-danger' : services.loadingList ? 'is-loading' : 'is-ready'}`} />
          <div>
            <strong>{summary}</strong>
            <span>{services.lastUpdatedAt ? t('workbench.services.collectedAt', { time: formatTime(services.lastUpdatedAt) }) : t('workbench.services.updatedNever')}</span>
          </div>
        </div>
        <div className="service-statusbar-actions">
          {!services.capability.manageable ? <Tag className="service-readonly-tag">{t('workbench.services.readOnly')}</Tag> : null}
          <Tooltip title={t('workbench.services.refresh')}>
            <Button
              type="text"
              className="service-icon-button"
              loading={services.loadingList || services.loadingCapability}
              icon={<RefreshCw size={15} />}
              aria-label={t('workbench.services.refresh')}
              onClick={() => void services.refreshAll()}
            />
          </Tooltip>
        </div>
      </div>

      <div className="service-filterbar">
        <Input
          id="service-search"
          name="service-search"
          className="host-search-input termous-search-input service-search-input"
          value={services.query.text}
          allowClear
          variant="borderless"
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={t('workbench.services.searchPlaceholder')}
          onChange={(event) => services.updateQuery({ text: event.target.value })}
          onPressEnter={(event) => applyQuery({ text: event.currentTarget.value })}
        />
        <Popover
          trigger="click"
          placement="bottomRight"
          arrow={false}
          classNames={{ root: 'service-filter-popover' }}
          content={
            <div className="service-filter-content">
              <div className="service-filter-head">
                <strong>{t('workbench.services.filters')}</strong>
                <Button type="text" size="small" onClick={resetFilters}>{t('workbench.services.resetFilters')}</Button>
              </div>
              <label className="service-filter-field">
                <span>{t('workbench.services.runtimeState')}</span>
                <Segmented
                  block
                  size="small"
                  className="service-runtime-segment"
                  value={services.query.runtimeState}
                  options={runtimeOptions}
                  onChange={(value) => applyQuery({ runtimeState: String(value) as SessionServiceQueryState['runtimeState'] })}
                />
              </label>
              <div className="service-filter-grid">
                <label className="service-filter-field">
                  <span>{t('workbench.services.unitFileState')}</span>
                  <Select
                    value={services.query.unitFileState}
                    classNames={{ popup: { root: 'termous-select-dropdown' } }}
                    options={unitFileStates.map((state) => ({
                      value: state,
                      label: state ? t(`workbench.services.unitStates.${state}`) : t('workbench.services.filtersAll'),
                    }))}
                    onChange={(value) => applyQuery({ unitFileState: value })}
                  />
                </label>
                <label className="service-filter-field">
                  <span>{t('workbench.services.sort')}</span>
                  <Select
                    value={services.query.sort}
                    classNames={{ popup: { root: 'termous-select-dropdown' } }}
                    options={serviceSorts.map((sort) => ({ value: sort, label: t(`workbench.services.sortOptions.${sort}`) }))}
                    onChange={(value) => applyQuery({ sort: value })}
                  />
                </label>
              </div>
              <label className="service-filter-field">
                <span>{t('workbench.services.order')}</span>
                <Segmented
                  block
                  size="small"
                  value={services.query.order}
                  options={[
                    { value: 'asc', label: t('workbench.services.ascending') },
                    { value: 'desc', label: t('workbench.services.descending') },
                  ]}
                  onChange={(value) => applyQuery({ order: value as 'asc' | 'desc' })}
                />
              </label>
            </div>
          }
        >
          <Button type="text" className={`service-filter-button ${hasFilters ? 'is-active' : ''}`} icon={<SlidersHorizontal size={15} />}>
            {t('workbench.services.filters')}
          </Button>
        </Popover>
      </div>

      {services.error && services.list ? (
        <div className="service-inline-error"><AlertTriangle size={14} /><span>{services.error}</span></div>
      ) : null}

      <div className="service-content">
        {selectedUnitId ? (
          <ServiceDetailView
            detail={detail}
            loading={services.detailLoading}
            error={services.detailError}
            operation={operation}
            operationError={services.operationErrors[selectedUnitId] || ''}
            operationBusy={operationBusy}
            manageable={services.capability.manageable}
            journalReadable={services.capability.journal_readable}
            onBack={services.clearSelection}
            onLogs={openLogs}
            onAction={(action) => requestAction(selectedUnitId, action)}
          />
        ) : (
          <div className="service-list" aria-label={t('workbench.services.serviceList')}>
            {items.length === 0 ? (
              <WorkbenchEmptyState
                className="service-empty-list"
                tone={services.error && !services.list ? 'danger' : 'neutral'}
                icon={services.loadingList
                  ? <LoaderCircle className="service-spin" size={20} />
                  : services.error && !services.list
                    ? <AlertTriangle size={20} />
                    : <ListFilter size={20} />}
                title={t(services.loadingList
                  ? 'workbench.services.loading'
                  : services.error && !services.list
                    ? 'workbench.services.loadFailed'
                    : 'workbench.services.noResults')}
                description={services.loadingList
                  ? t('workbench.services.emptyListHint')
                  : services.error && !services.list
                    ? services.error
                    : undefined}
              />
            ) : null}
            {items.map((item) => (
              <ServiceRow key={item.id} item={item} onSelect={() => void services.selectService(item.id)} />
            ))}
          </div>
        )}
      </div>

      <ServiceLogsModal
        open={logsOpen}
        unitId={services.logsUnitId || selectedUnitId}
        logs={services.logs}
        loading={services.logsLoading}
        error={services.logsError}
        query={services.logQuery}
        onQueryChange={services.updateLogQuery}
        onRefresh={(query, append) => void services.refreshLogs(selectedUnitId, query, append)}
        onClose={() => {
          setLogsOpen(false)
          services.clearLogs()
        }}
      />
    </section>
  )
}

function ServiceUnavailable({
  title,
  description,
  tone = 'neutral',
  loading,
  onRefresh,
}: {
  title: string
  description: string
  tone?: 'neutral' | 'warning' | 'danger'
  loading: boolean
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="service-unavailable">
      <WorkbenchEmptyState
        tone={tone}
        icon={loading ? <LoaderCircle className="service-spin" size={20} /> : <Cog size={20} />}
        title={title}
        description={description}
      />
      {!loading ? <Button type="text" className="service-retry" icon={<RefreshCw size={14} />} onClick={onRefresh}>{t('workbench.services.retry')}</Button> : null}
    </div>
  )
}

function ServiceRow({ item, onSelect }: { item: SystemServiceSummary; onSelect: () => void }) {
  const { t } = useTranslation()
  return (
    <Tooltip
      title={item.template ? t('workbench.services.templateHint') : undefined}
      placement="left"
      mouseEnterDelay={0.3}
      classNames={{ root: 'service-row-tooltip' }}
    >
      <button
        type="button"
        className={`service-row is-${serviceTone(item.active_state)}`}
        disabled={item.template}
        onClick={onSelect}
      >
        <span className="service-row-state"><Cog size={15} /></span>
        <div className="service-row-copy">
          <Tooltip title={item.id} mouseEnterDelay={0.3} classNames={{ root: 'service-row-tooltip' }}>
            <strong>{displayUnitName(item.id)}</strong>
          </Tooltip>
          <Tooltip title={item.description || item.id} mouseEnterDelay={0.3} classNames={{ root: 'service-row-tooltip' }}>
            <small>{item.description || item.id}</small>
          </Tooltip>
        </div>
        <div className="service-row-meta">
          <span className={`service-runtime-pill is-${serviceTone(item.active_state)}`}>{serviceStateLabel(item.active_state, t)}</span>
          <span>{unitStateLabel(item.unit_file_state, t)}</span>
        </div>
      </button>
    </Tooltip>
  )
}

function ServiceDetailView({
  detail,
  loading,
  error,
  operation,
  operationError,
  operationBusy,
  manageable,
  journalReadable,
  onBack,
  onLogs,
  onAction,
}: {
  detail: SystemServiceDetail | null
  loading: boolean
  error: string
  operation?: SystemServiceOperation
  operationError: string
  operationBusy: boolean
  manageable: boolean
  journalReadable: boolean
  onBack: () => void
  onLogs: () => void
  onAction: (action: SystemServiceAction) => void
}) {
  const { t } = useTranslation()
  if (!detail && loading) {
    return (
      <div className="service-detail is-loading">
        <Button type="text" className="service-back" icon={<ArrowLeft size={14} />} onClick={onBack}>{t('workbench.services.backToList')}</Button>
        <span className="service-detail-spinner" />
        <strong>{t('workbench.services.detailLoading')}</strong>
      </div>
    )
  }
  if (!detail && error) {
    return (
      <div className="service-detail">
        <Button type="text" className="service-back" icon={<ArrowLeft size={14} />} onClick={onBack}>{t('workbench.services.backToList')}</Button>
        <WorkbenchEmptyState tone="danger" icon={<AlertTriangle size={20} />} title={t('workbench.services.loadFailed')} description={error} />
      </div>
    )
  }
  if (!detail) {
    return null
  }
  const summary = detail.summary
  const active = summary.active_state === 'active' || summary.active_state === 'reloading'
  const failed = summary.active_state === 'failed'
  const masked = summary.unit_file_state === 'masked' || summary.unit_file_state === 'masked-runtime'
  const enabled = summary.unit_file_state === 'enabled' || summary.unit_file_state === 'enabled-runtime' || summary.unit_file_state === 'linked'
  const canStart = manageable && !summary.template && detail.can_start && !detail.refuse_manual_start && !active
  const canStop = manageable && !summary.template && detail.can_stop && !detail.refuse_manual_stop && active
  const canRestart = manageable && !summary.template && detail.can_start && detail.can_stop && active
  const warnings = [...detail.warnings]
  const moreItems: MenuProps['items'] = [
    { key: 'reload', label: t('workbench.services.actions.reload'), disabled: !manageable || summary.template || !active || !detail.can_reload || operationBusy },
    { key: 'reset_failed', label: t('workbench.services.actions.reset_failed'), disabled: !manageable || summary.template || !failed || operationBusy },
    { type: 'divider' },
    { key: enabled ? 'disable' : 'enable', label: t(`workbench.services.actions.${enabled ? 'disable' : 'enable'}`), disabled: !manageable || summary.template || operationBusy },
    { key: masked ? 'unmask' : 'mask', label: t(`workbench.services.actions.${masked ? 'unmask' : 'mask'}`), danger: !masked, disabled: !manageable || summary.template || operationBusy },
  ]

  return (
    <article className="service-detail">
      <div className="service-detail-topbar">
        <Button type="text" className="service-back" icon={<ArrowLeft size={14} />} onClick={onBack}>{t('workbench.services.backToList')}</Button>
        {loading ? <span className="service-detail-refreshing"><LoaderCircle size={13} />{t('workbench.services.detailRefreshing')}</span> : null}
      </div>
      <header className="service-detail-head">
        <span className={`service-detail-icon is-${serviceTone(summary.active_state)}`}><Cog size={18} /></span>
        <div>
          <Tooltip title={summary.id}><strong>{displayUnitName(summary.id)}</strong></Tooltip>
          <Tooltip title={summary.description || summary.id}><span>{summary.description || summary.id}</span></Tooltip>
        </div>
        <div className="service-detail-tags">
          <Tag className={`service-state-tag is-${serviceTone(summary.active_state)}`}>{serviceStateLabel(summary.active_state, t)}</Tag>
          <Tag className="service-unit-tag">{unitStateLabel(summary.unit_file_state, t)}</Tag>
        </div>
      </header>

      {operation ? <OperationStrip operation={operation} error={operationError} /> : null}

      <div className="service-detail-kpis">
        <ServiceKpi label={t('workbench.services.mainPid')} value={detail.main_pid > 0 ? String(detail.main_pid) : '-'} />
        <ServiceKpi label={t('workbench.services.activeDuration')} value={formatDuration(detail.active_duration_seconds)} />
        <ServiceKpi label={t('workbench.services.restartCount')} value={String(detail.restart_count)} />
      </div>

      <dl className="service-detail-list">
        <ServiceDetailItem label={t('workbench.services.user')} value={detail.user || 'root'} />
        <ServiceDetailItem label={t('workbench.services.type')} value={detail.type || t('fields.none')} />
        <ServiceDetailItem label={t('workbench.services.result')} value={detail.result || t('fields.none')} />
        <ServiceDetailItem label={t('workbench.services.restartPolicy')} value={detail.restart_policy || t('fields.none')} />
        <ServiceDetailItem label={t('workbench.services.memory')} value={formatBytes(detail.memory_current_bytes)} />
        <ServiceDetailItem label={t('workbench.services.tasks')} value={detail.tasks_current === undefined ? t('fields.none') : String(detail.tasks_current)} />
        <ServiceDetailItem label={t('workbench.services.cpuTime')} value={formatNanoseconds(detail.cpu_usage_nanoseconds)} />
        <ServiceDetailItem label={t('workbench.services.workingDirectory')} value={detail.working_directory || t('fields.none')} />
        <ServiceDetailItem label={t('workbench.services.execStart')} value={detail.exec_start || t('fields.none')} />
        <ServiceDetailItem label={t('workbench.services.fragmentPath')} value={detail.fragment_path || t('fields.none')} />
        {detail.drop_in_paths.length > 0 ? <ServiceDetailItem label={t('workbench.services.dropIns')} value={detail.drop_in_paths.join(' · ')} /> : null}
      </dl>

      {warnings.length > 0 ? <div className="service-warning"><AlertTriangle size={14} /><span>{warnings.join(' · ')}</span></div> : null}

      <div className="service-detail-actions">
        <Button
          className="service-action-button"
          disabled={active ? !canStop : !canStart || masked}
          loading={operationBusy}
          icon={active ? <Square size={13} /> : <Play size={14} />}
          onClick={() => onAction(active ? 'stop' : 'start')}
        >
          {t(`workbench.services.actions.${active ? 'stop' : 'start'}`)}
        </Button>
        <Button className="service-action-button" disabled={!canRestart || operationBusy} icon={<RefreshCw size={14} />} onClick={() => onAction('restart')}>
          {t('workbench.services.actions.restart')}
        </Button>
        <Button className="service-action-button" disabled={!journalReadable} icon={<FileText size={14} />} onClick={onLogs}>
          {t('workbench.services.logs')}
        </Button>
        <Dropdown
          trigger={['click']}
          menu={{ items: moreItems, onClick: ({ key }) => onAction(key as SystemServiceAction) }}
          popupRender={(menu) => <div className="service-action-menu">{menu}</div>}
        >
          <Button className="service-action-button" icon={<MoreHorizontal size={15} />}>{t('workbench.services.moreActions')}</Button>
        </Dropdown>
      </div>
    </article>
  )
}

function OperationStrip({ operation, error }: { operation: SystemServiceOperation; error: string }) {
  const { t } = useTranslation()
  const terminal = isTerminalOperation(operation)
  const failed = operation.phase === 'failed' || operation.phase === 'uncertain' || operation.phase === 'cancelled'
  return (
    <div className={`service-operation ${terminal ? 'is-terminal' : 'is-running'} ${failed ? 'is-error' : ''}`}>
      <span>{terminal ? failed ? <ShieldAlert size={14} /> : <Gauge size={14} /> : <LoaderCircle className="service-spin" size={14} />}</span>
      <div>
        <strong>{t(`workbench.services.operationPhases.${operation.phase}`)}</strong>
        <small>{error || operation.message}</small>
      </div>
    </div>
  )
}

function ServiceKpi({ label, value }: { label: string; value: string }) {
  return <div className="service-kpi"><span>{label}</span><strong>{value}</strong></div>
}

function ServiceDetailItem({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><Tooltip title={value}><dd>{value}</dd></Tooltip></div>
}

function displayUnitName(unitId: string): string {
  return unitId.endsWith('.service') ? unitId.slice(0, -'.service'.length) : unitId
}

function serviceTone(state: string): 'success' | 'danger' | 'warning' | 'muted' {
  if (state === 'active') return 'success'
  if (state === 'failed') return 'danger'
  if (state === 'activating' || state === 'deactivating' || state === 'reloading') return 'warning'
  return 'muted'
}

function serviceStateLabel(state: string, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`workbench.services.runtimeStates.${state}`, { defaultValue: state || t('fields.none') })
}

function unitStateLabel(state: string, t: ReturnType<typeof useTranslation>['t']): string {
  return t(`workbench.services.unitStates.${state}`, { defaultValue: state || t('fields.none') })
}

function isRiskyAction(action: SystemServiceAction): boolean {
  return action === 'stop' || action === 'restart' || action === 'disable' || action === 'mask'
}

function isCriticalService(unitId: string): boolean {
  return /^(ssh|sshd|networking|networkmanager|systemd-networkd|dbus|systemd-logind)\.service$/i.test(unitId)
}

function isTerminalOperation(operation: SystemServiceOperation): boolean {
  return operation.phase === 'succeeded' || operation.phase === 'failed' || operation.phase === 'uncertain' || operation.phase === 'cancelled'
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '-'
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatBytes(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = value
  let index = 0
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`
}

function formatNanoseconds(value?: number): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '-'
  return `${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}s`
}
