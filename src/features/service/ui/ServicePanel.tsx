import { App, Button, Dropdown, Input, Progress, Segmented, Select, Tag, Tooltip, type MenuProps } from 'antd'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Cog,
  FileText,
  ListFilter,
  LoaderCircle,
  MoreHorizontal,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Square,
  XCircle,
} from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  SystemServiceAction,
  SystemServiceDetail,
  SystemServiceOperation,
  SystemServiceOperationPhase,
  SystemServiceSummary,
} from '#entities/service'
import { customSelectStyles, FilterPopover, uiStyles, WorkspaceEmptyState, termousNotificationClassName } from '#shared/ui'
import type { ServiceGateway, ServiceSessionContext } from '../model/contracts'
import { ServiceLogsModal } from './ServiceLogsModal'
import {
  defaultServiceQuery,
  type SessionServiceQueryState,
  useSessionServices,
} from '../model/useSessionServices'
import styles from './ServicePanel.module.scss'

export interface ServicePanelProps {
  api: ServiceGateway
  session: ServiceSessionContext | null
  enabled: boolean
}

const unitFileStates = ['', 'enabled', 'disabled', 'masked', 'static', 'indirect']
const serviceSorts: SessionServiceQueryState['sort'][] = ['name', 'description', 'runtime', 'unit_file']
const filterSelectClassNames = {
  popup: { root: `${customSelectStyles['select-dropdown']} termous-select-dropdown ${styles['service-filter-select-dropdown']}` },
}
const rowTooltipClassNames = { root: styles['service-row-tooltip'] }

interface ServiceOperationNotificationEntry {
  operationId: string
  notificationKey: string
  progress: number
}

interface ServiceOperationNoticeConfig {
  unitId: string
  phase: SystemServiceOperationPhase
  message?: string
  notificationKey: string
  progress: number
}

type ServiceOperationTone = 'running' | 'success' | 'warning' | 'error'

export function ServicePanel({ api, session, enabled }: ServicePanelProps) {
  const { t } = useTranslation()
  const { modal, notification } = App.useApp()
  const services = useSessionServices({ api, session, enabled })
  const [logsOpen, setLogsOpen] = useState(false)
  const operationNotificationsRef = useRef(new Map<string, ServiceOperationNotificationEntry>())
  const actionConfirmRef = useRef<ReturnType<typeof modal.confirm> | null>(null)
  const interactionScopeRef = useRef({
    enabled,
    sessionId: session?.id,
    supported: services.supported,
    selectedUnitId: services.selectedUnitId,
  })
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

  interactionScopeRef.current = {
    enabled,
    sessionId: session?.id,
    supported: services.supported,
    selectedUnitId: services.selectedUnitId,
  }

  const destroyActionConfirm = useCallback(() => {
    actionConfirmRef.current?.destroy()
    actionConfirmRef.current = null
  }, [])

  useEffect(() => {
    setLogsOpen(false)
    destroyActionConfirm()
  }, [destroyActionConfirm, services.selectedUnitId, services.supported, session?.id])

  useEffect(() => {
    if (!enabled) {
      setLogsOpen(false)
      destroyActionConfirm()
    }
  }, [destroyActionConfirm, enabled])

  useEffect(() => () => destroyActionConfirm(), [destroyActionConfirm])

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

  const openOperationNotification = useCallback((notice: ServiceOperationNoticeConfig) => {
    const tone = serviceOperationTone(notice.phase)
    const config = {
      key: notice.notificationKey,
      title: <strong className={styles['service-operation-notification-title']}>{displayUnitName(notice.unitId)}</strong>,
      description: (
        <ServiceOperationNotice
          phaseLabel={t(`workbench.services.operationPhases.${notice.phase}`)}
          message={notice.message}
          progress={notice.progress}
          tone={tone}
        />
      ),
      duration: serviceOperationDuration(tone),
      role: (tone === 'error' || tone === 'warning' ? 'alert' : 'status') as 'alert' | 'status',
      className: [
        termousNotificationClassName,
        styles['service-operation-notification'],
        styles[`is-${tone}`] ?? '',
      ].filter(Boolean).join(' '),
      icon: serviceOperationStatusIcon(notice.phase),
    }

    if (tone === 'success') {
      notification.success(config)
      return
    }
    if (tone === 'warning') {
      notification.warning(config)
      return
    }
    if (tone === 'error') {
      notification.error(config)
      return
    }
    notification.open(config)
  }, [notification, t])

  const showOperationNotification = useCallback((nextOperation: SystemServiceOperation) => {
    const tracked = operationNotificationsRef.current.get(nextOperation.unit_id)
    const notificationKey = tracked?.notificationKey
      || serviceOperationNotificationKey(nextOperation.session_id, nextOperation.unit_id)
    const progress = Math.max(tracked?.progress ?? 0, serviceOperationProgress(nextOperation.phase))

    if (tracked) {
      operationNotificationsRef.current.set(nextOperation.unit_id, { ...tracked, progress })
    }
    openOperationNotification({
      unitId: nextOperation.unit_id,
      phase: nextOperation.phase,
      message: nextOperation.message,
      notificationKey,
      progress,
    })
    if (isTerminalOperation(nextOperation)) {
      operationNotificationsRef.current.delete(nextOperation.unit_id)
    }
  }, [openOperationNotification])

  useEffect(() => {
    for (const [unitId, tracked] of operationNotificationsRef.current) {
      const nextOperation = services.operations[unitId]
      if (!tracked.operationId || nextOperation?.id !== tracked.operationId) {
        continue
      }
      const operationError = services.operationErrors[unitId]
      if (operationError && !isTerminalOperation(nextOperation)) {
        showOperationNotification({
          ...nextOperation,
          phase: 'uncertain',
          message: operationError,
        })
        continue
      }
      showOperationNotification(nextOperation)
    }
  }, [services.operationErrors, services.operations, showOperationNotification])

  useEffect(() => () => {
    for (const tracked of operationNotificationsRef.current.values()) {
      notification.destroy(tracked.notificationKey)
    }
    operationNotificationsRef.current.clear()
  }, [notification, session?.id])

  const executeAction = async (unitId: string, action: SystemServiceAction, expectedSessionId = session?.id) => {
    const scope = interactionScopeRef.current
    if (
      !scope.enabled ||
      !scope.supported ||
      !expectedSessionId ||
      scope.sessionId !== expectedSessionId ||
      scope.selectedUnitId !== unitId
    ) {
      return
    }
    const notificationKey = serviceOperationNotificationKey(session?.id || '', unitId)
    const initialProgress = serviceOperationProgress('queued')
    operationNotificationsRef.current.set(unitId, {
      operationId: '',
      notificationKey,
      progress: initialProgress,
    })
    openOperationNotification({
      unitId,
      phase: 'queued',
      notificationKey,
      progress: initialProgress,
    })
    try {
      const nextOperation = await services.runAction(unitId, action)
      if (!nextOperation) {
        operationNotificationsRef.current.delete(unitId)
        notification.destroy(notificationKey)
        return
      }
      const tracked = operationNotificationsRef.current.get(unitId)
      operationNotificationsRef.current.set(unitId, {
        operationId: nextOperation.id,
        notificationKey,
        progress: tracked?.progress ?? initialProgress,
      })
      showOperationNotification(nextOperation)
    } catch (error) {
      operationNotificationsRef.current.delete(unitId)
      openOperationNotification({
        unitId,
        phase: 'failed',
        message: error instanceof Error ? error.message : t('workbench.services.actionFailed'),
        notificationKey,
        progress: 100,
      })
    }
  }

  const requestAction = (unitId: string, action: SystemServiceAction) => {
    const expectedSessionId = session?.id
    const scope = interactionScopeRef.current
    if (
      !scope.enabled ||
      !scope.supported ||
      !expectedSessionId ||
      scope.sessionId !== expectedSessionId ||
      scope.selectedUnitId !== unitId
    ) {
      return
    }
    const requiresConfirmation = isRiskyAction(action) || isCriticalService(unitId)
    if (!requiresConfirmation) {
      void executeAction(unitId, action, expectedSessionId)
      return
    }
    const critical = isCriticalService(unitId)
    destroyActionConfirm()
    const confirmation = modal.confirm({
      centered: true,
      className: styles['service-action-confirm'],
      title: t('workbench.services.confirmTitle', { action: t(`workbench.services.actions.${action}`) }),
      content: critical
        ? t('workbench.services.confirmCritical', { unit: unitId })
        : t('workbench.services.confirmContent', { unit: unitId }),
      okText: t(`workbench.services.actions.${action}`),
      cancelText: t('app.cancel'),
      okButtonProps: { danger: action === 'mask' || action === 'stop' },
      onOk: () => executeAction(unitId, action, expectedSessionId),
      onCancel: () => {
        if (actionConfirmRef.current === confirmation) {
          actionConfirmRef.current = null
        }
      },
      afterClose: () => {
        if (actionConfirmRef.current === confirmation) {
          actionConfirmRef.current = null
        }
      },
    })
    actionConfirmRef.current = confirmation
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
      <WorkspaceEmptyState
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
    <section className={`${styles['service-panel']} ${styles.root}`}>
      <div className={styles['service-statusbar']}>
        <div className={styles['service-statusbar-copy']}>
          <span className={`${styles['service-live-dot']} ${services.error ? styles['is-danger'] : services.loadingList ? styles['is-loading'] : ''}`} />
          <div>
            <strong>{summary}</strong>
            <span>{services.lastUpdatedAt ? t('workbench.services.collectedAt', { time: formatTime(services.lastUpdatedAt) }) : t('workbench.services.updatedNever')}</span>
          </div>
        </div>
        <div className={styles['service-statusbar-actions']}>
          {!services.capability.manageable ? <Tag className={styles['service-readonly-tag']}>{t('workbench.services.readOnly')}</Tag> : null}
          <Tooltip title={t('workbench.services.refresh')}>
            <Button
              type="text"
              className={styles['service-icon-button']}
              loading={services.loadingList || services.loadingCapability}
              icon={<RefreshCw size={15} />}
              aria-label={t('workbench.services.refresh')}
              onClick={() => void services.refreshAll()}
            />
          </Tooltip>
        </div>
      </div>

      <div className={styles['service-filterbar']}>
        <Input
          id="service-search"
          name="service-search"
          className={`host-search-input ${uiStyles['search-input']} termous-search-input ${styles['service-search-input']}`}
          value={services.query.text}
          allowClear
          variant="borderless"
          prefix={<Search size={14} aria-hidden="true" />}
          placeholder={t('workbench.services.searchPlaceholder')}
          onChange={(event) => services.updateQuery({ text: event.target.value })}
          onPressEnter={(event) => applyQuery({ text: event.currentTarget.value })}
        />
        <FilterPopover
          content={
            <div className={styles['service-filter-content']}>
              <div className={styles['service-filter-head']}>
                <strong>{t('workbench.services.filters')}</strong>
                <Button type="text" size="small" onClick={resetFilters}>{t('workbench.services.resetFilters')}</Button>
              </div>
              <label className={styles['service-filter-field']}>
                <span>{t('workbench.services.runtimeState')}</span>
                <Segmented
                  block
                  size="small"
                  value={services.query.runtimeState}
                  options={runtimeOptions}
                  onChange={(value) => applyQuery({ runtimeState: String(value) as SessionServiceQueryState['runtimeState'] })}
                />
              </label>
              <div className={styles['service-filter-grid']}>
                <label className={styles['service-filter-field']}>
                  <span>{t('workbench.services.unitFileState')}</span>
                  <Select
                    value={services.query.unitFileState}
                    classNames={filterSelectClassNames}
                    options={unitFileStates.map((state) => ({
                      value: state,
                      label: state ? t(`workbench.services.unitStates.${state}`) : t('workbench.services.filtersAll'),
                    }))}
                    onChange={(value) => applyQuery({ unitFileState: value })}
                  />
                </label>
                <label className={styles['service-filter-field']}>
                  <span>{t('workbench.services.sort')}</span>
                  <Select
                    value={services.query.sort}
                    classNames={filterSelectClassNames}
                    options={serviceSorts.map((sort) => ({ value: sort, label: t(`workbench.services.sortOptions.${sort}`) }))}
                    onChange={(value) => applyQuery({ sort: value })}
                  />
                </label>
              </div>
              <label className={styles['service-filter-field']}>
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
          <Button type="text" className={`${styles['service-filter-button']} ${hasFilters ? styles['is-active'] : ''}`} icon={<SlidersHorizontal size={15} />}>
            {t('workbench.services.filters')}
          </Button>
        </FilterPopover>
      </div>

      {services.error && services.list ? (
        <div className={styles['service-inline-error']}><AlertTriangle size={14} /><span>{services.error}</span></div>
      ) : null}

      <div className={styles['service-content']}>
        {selectedUnitId ? (
          <ServiceDetailView
            detail={detail}
            loading={services.detailLoading}
            error={services.detailError}
            operationBusy={operationBusy}
            manageable={services.capability.manageable}
            journalReadable={services.capability.journal_readable}
            enabled={enabled}
            onBack={services.clearSelection}
            onLogs={openLogs}
            onAction={(action) => requestAction(selectedUnitId, action)}
          />
        ) : (
          <div className={styles['service-list']} aria-label={t('workbench.services.serviceList')}>
            {items.length === 0 ? (
              <WorkspaceEmptyState
                tone={services.error && !services.list ? 'danger' : 'neutral'}
                icon={services.loadingList
                  ? <LoaderCircle className={styles['service-spin']} size={20} />
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
    <div className={styles['service-unavailable']}>
      <WorkspaceEmptyState
        tone={tone}
        icon={loading ? <LoaderCircle className={styles['service-spin']} size={20} /> : <Cog size={20} />}
        title={title}
        description={description}
      />
      {!loading ? <Button type="text" className={styles['service-retry']} icon={<RefreshCw size={14} />} onClick={onRefresh}>{t('workbench.services.retry')}</Button> : null}
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
      classNames={rowTooltipClassNames}
    >
      <button
        type="button"
        className={`${styles['service-row']} ${styles[`is-${serviceTone(item.active_state)}`] ?? ''}`}
        disabled={item.template}
        onClick={onSelect}
      >
        <span className={styles['service-row-state']}><Cog size={15} /></span>
        <div className={styles['service-row-copy']}>
          <Tooltip title={item.id} mouseEnterDelay={0.3} classNames={rowTooltipClassNames}>
            <strong>{displayUnitName(item.id)}</strong>
          </Tooltip>
          <Tooltip title={item.description || item.id} mouseEnterDelay={0.3} classNames={rowTooltipClassNames}>
            <small>{item.description || item.id}</small>
          </Tooltip>
        </div>
        <div className={styles['service-row-meta']}>
          <span className={`${styles['service-runtime-pill']} ${styles[`is-${serviceTone(item.active_state)}`] ?? ''}`}>{serviceStateLabel(item.active_state, t)}</span>
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
  operationBusy,
  manageable,
  journalReadable,
  enabled,
  onBack,
  onLogs,
  onAction,
}: {
  detail: SystemServiceDetail | null
  loading: boolean
  error: string
  operationBusy: boolean
  manageable: boolean
  journalReadable: boolean
  enabled: boolean
  onBack: () => void
  onLogs: () => void
  onAction: (action: SystemServiceAction) => void
}) {
  const { t } = useTranslation()
  const [moreActionsOpen, setMoreActionsOpen] = useState(false)
  const detailUnitId = detail?.summary.id
  useEffect(() => {
    setMoreActionsOpen(false)
  }, [detailUnitId, enabled])
  if (!detail && loading) {
    return (
      <div className={`${styles['service-detail']} ${styles['is-loading']}`}>
        <div className={styles['service-detail-topbar']}>
          <Button type="text" className={styles['service-back']} icon={<ArrowLeft size={14} />} onClick={onBack}>{t('workbench.services.backToList')}</Button>
        </div>
        <div className={styles['service-detail-loading-body']} role="status" aria-live="polite">
          <span className={styles['service-detail-loading-mark']} aria-hidden="true">
            <span className={styles['service-detail-spinner']} />
          </span>
          <strong>{t('workbench.services.detailLoading')}</strong>
          <span className={styles['service-detail-loading-track']} aria-hidden="true"><span /></span>
        </div>
      </div>
    )
  }
  if (!detail && error) {
    return (
      <div className={styles['service-detail']}>
        <Button type="text" className={styles['service-back']} icon={<ArrowLeft size={14} />} onClick={onBack}>{t('workbench.services.backToList')}</Button>
        <WorkspaceEmptyState tone="danger" icon={<AlertTriangle size={20} />} title={t('workbench.services.loadFailed')} description={error} />
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
  const unitEnabled = summary.unit_file_state === 'enabled' || summary.unit_file_state === 'enabled-runtime' || summary.unit_file_state === 'linked'
  const canStart = manageable && !summary.template && detail.can_start && !detail.refuse_manual_start && !active
  const canStop = manageable && !summary.template && detail.can_stop && !detail.refuse_manual_stop && active
  const canRestart = manageable && !summary.template && detail.can_start && detail.can_stop && active
  const warnings = [...detail.warnings]
  const moreItems: MenuProps['items'] = [
    { key: 'reload', label: t('workbench.services.actions.reload'), disabled: !manageable || summary.template || !active || !detail.can_reload || operationBusy },
    { key: 'reset_failed', label: t('workbench.services.actions.reset_failed'), disabled: !manageable || summary.template || !failed || operationBusy },
    { type: 'divider' },
    { key: unitEnabled ? 'disable' : 'enable', label: t(`workbench.services.actions.${unitEnabled ? 'disable' : 'enable'}`), disabled: !manageable || summary.template || operationBusy },
    { key: masked ? 'unmask' : 'mask', label: t(`workbench.services.actions.${masked ? 'unmask' : 'mask'}`), danger: !masked, disabled: !manageable || summary.template || operationBusy },
  ]

  return (
    <article className={styles['service-detail']}>
      <div className={styles['service-detail-topbar']}>
        <Button type="text" className={styles['service-back']} icon={<ArrowLeft size={14} />} onClick={onBack}>{t('workbench.services.backToList')}</Button>
        {loading ? <span className={styles['service-detail-refreshing']}><LoaderCircle size={13} />{t('workbench.services.detailRefreshing')}</span> : null}
      </div>
      <header className={styles['service-detail-head']}>
        <span className={`${styles['service-detail-icon']} ${styles[`is-${serviceTone(summary.active_state)}`] ?? ''}`}><Cog size={18} /></span>
        <div>
          <Tooltip title={summary.id}><strong>{displayUnitName(summary.id)}</strong></Tooltip>
          <Tooltip title={summary.description || summary.id}><span>{summary.description || summary.id}</span></Tooltip>
        </div>
        <div className={styles['service-detail-tags']}>
          <Tag className={`${styles['service-state-tag']} ${styles[`is-${serviceTone(summary.active_state)}`] ?? ''}`}>{serviceStateLabel(summary.active_state, t)}</Tag>
          <Tag>{unitStateLabel(summary.unit_file_state, t)}</Tag>
        </div>
      </header>

      <div className={styles['service-detail-kpis']}>
        <ServiceKpi label={t('workbench.services.mainPid')} value={detail.main_pid > 0 ? String(detail.main_pid) : '-'} />
        <ServiceKpi label={t('workbench.services.activeDuration')} value={formatDuration(detail.active_duration_seconds)} />
        <ServiceKpi label={t('workbench.services.restartCount')} value={String(detail.restart_count)} />
      </div>

      <dl className={styles['service-detail-list']}>
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

      {warnings.length > 0 ? <div className={styles['service-warning']}><AlertTriangle size={14} /><span>{warnings.join(' · ')}</span></div> : null}

      <div className={styles['service-detail-actions']}>
        <Button
          className={styles['service-action-button']}
          disabled={active ? !canStop : !canStart || masked}
          loading={operationBusy}
          icon={active ? <Square size={13} /> : <Play size={14} />}
          onClick={() => onAction(active ? 'stop' : 'start')}
        >
          {t(`workbench.services.actions.${active ? 'stop' : 'start'}`)}
        </Button>
        <Button className={styles['service-action-button']} disabled={!canRestart || operationBusy} icon={<RefreshCw size={14} />} onClick={() => onAction('restart')}>
          {t('workbench.services.actions.restart')}
        </Button>
        <Button className={styles['service-action-button']} disabled={!journalReadable} icon={<FileText size={14} />} onClick={onLogs}>
          {t('workbench.services.logs')}
        </Button>
        <Dropdown
          open={moreActionsOpen}
          trigger={['click']}
          menu={{
            items: moreItems,
            onClick: ({ key }) => {
              setMoreActionsOpen(false)
              onAction(key as SystemServiceAction)
            },
          }}
          popupRender={(menu) => <div className={styles['service-action-menu']}>{menu}</div>}
          onOpenChange={(open) => setMoreActionsOpen(enabled && open)}
        >
          <Button className={styles['service-action-button']} icon={<MoreHorizontal size={15} />}>{t('workbench.services.moreActions')}</Button>
        </Dropdown>
      </div>
    </article>
  )
}

function ServiceKpi({ label, value }: { label: string; value: string }) {
  return <div className={styles['service-kpi']}><span>{label}</span><strong>{value}</strong></div>
}

function ServiceDetailItem({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><Tooltip title={value}><dd>{value}</dd></Tooltip></div>
}

function ServiceOperationNotice({
  phaseLabel,
  message,
  progress,
  tone,
}: {
  phaseLabel: string
  message?: string
  progress: number
  tone: ServiceOperationTone
}) {
  const normalizedMessage = message?.trim()
  const progressStatus = tone === 'success' ? 'success' : tone === 'error' ? 'exception' : tone === 'running' ? 'active' : 'normal'
  return (
    <div className={`${styles['service-operation-notice']} ${styles[`is-${tone}`] ?? ''}`}>
      <div className={styles['service-operation-notice-state']}>
        <span>{phaseLabel}</span>
        <strong>{progress}%</strong>
      </div>
      <Progress
        className={styles['service-operation-notice-progress']}
        percent={progress}
        showInfo={false}
        size="small"
        status={progressStatus}
        strokeLinecap="round"
      />
      {normalizedMessage ? <Tooltip title={normalizedMessage}><p>{normalizedMessage}</p></Tooltip> : null}
    </div>
  )
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

function serviceOperationNotificationKey(sessionId: string, unitId: string): string {
  return `service-operation-${sessionId}-${unitId}`
}

function serviceOperationProgress(phase: SystemServiceOperationPhase): number {
  switch (phase) {
    case 'queued': return 12
    case 'enqueued': return 46
    case 'verifying': return 78
    default: return 100
  }
}

function serviceOperationTone(phase: SystemServiceOperationPhase): ServiceOperationTone {
  if (phase === 'succeeded') return 'success'
  if (phase === 'failed') return 'error'
  if (phase === 'uncertain' || phase === 'cancelled') return 'warning'
  return 'running'
}

function serviceOperationDuration(tone: ServiceOperationTone): number {
  if (tone === 'running') return 0
  if (tone === 'success') return 2.5
  return 4
}

function serviceOperationStatusIcon(phase: SystemServiceOperationPhase): ReactNode {
  if (phase === 'succeeded') return <CheckCircle2 size={18} />
  if (phase === 'failed' || phase === 'cancelled') return <XCircle size={18} />
  if (phase === 'uncertain') return <AlertTriangle size={18} />
  return <LoaderCircle className={styles['service-spin']} size={18} />
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
