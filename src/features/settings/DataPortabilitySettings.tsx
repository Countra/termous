import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Alert, App as AntdApp, Button, Checkbox, Input, Modal, Progress, Segmented, Steps, Tree } from 'antd'
import {
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  FileArchive,
  KeyRound,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createApiFromRuntime, type TermousApi } from '../../api/client'
import type {
  DataPortabilityDatasetKey,
  DataPortabilityImport,
  DataPortabilityItemRef,
  DataPortabilityPlanItemPage,
  DataPortabilityPlanStatus,
  DataPortabilityProgress,
  DataPortabilityResolution,
  DataPortabilityRestoreMode,
  DataPortabilityRestorePlan,
  DataPortabilitySummary,
} from '../../types/domain'
import { DataPortabilityPlanView } from './DataPortabilityPlanView'
import {
  errorMessage,
  formatPortabilityBytes,
  itemSelectionKey,
  normalizePortabilityImport,
  normalizePortabilityPlan,
  normalizePortabilitySummary,
  portabilityDatasets,
  portabilityProgressPercent,
} from './dataPortability'
import '../../styles/data-portability.css'

type PlanStatusFilter = 'all' | DataPortabilityPlanStatus

const PAGE_SIZE = 20

export function DataPortabilitySettings() {
  const { t, i18n } = useTranslation()
  const { notification, modal } = AntdApp.useApp()
  const apiRef = useRef<Promise<TermousApi> | null>(null)
  const activeImportIdRef = useRef('')
  const [summary, setSummary] = useState<DataPortabilitySummary | null>(null)
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [exportConfirm, setExportConfirm] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [exportBusy, setExportBusy] = useState(false)
  const [importBusy, setImportBusy] = useState(false)
  const [progress, setProgress] = useState<DataPortabilityProgress | null>(null)
  const [inspection, setInspection] = useState<DataPortabilityImport | null>(null)
  const [mode, setMode] = useState<DataPortabilityRestoreMode>('merge_all')
  const [selectedDatasets, setSelectedDatasets] = useState<DataPortabilityDatasetKey[]>([])
  const [plan, setPlan] = useState<DataPortabilityRestorePlan | null>(null)
  const [page, setPage] = useState<DataPortabilityPlanItemPage | null>(null)
  const [statusFilter, setStatusFilter] = useState<PlanStatusFilter>('all')
  const [currentCursor, setCurrentCursor] = useState('')
  const [cursorStack, setCursorStack] = useState<string[]>([])
  const [planBusy, setPlanBusy] = useState(false)
  const [selectionOpen, setSelectionOpen] = useState(false)
  const [selectedItemKeys, setSelectedItemKeys] = useState<string[]>([])
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false)
  const [restorePrepared, setRestorePrepared] = useState(false)

  const getApi = useCallback(() => {
    apiRef.current ??= createApiFromRuntime()
    return apiRef.current
  }, [])

  const loadSummary = useCallback(async () => {
    setSummaryBusy(true)
    try {
      const api = await getApi()
      setSummary(normalizePortabilitySummary(await api.dataPortabilitySummary()))
    } catch (error) {
      notification.error({ title: t('settings.data.summaryFailed'), description: errorMessage(error) })
    } finally {
      setSummaryBusy(false)
    }
  }, [getApi, notification, t])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  useEffect(() => {
    const removeListener = window.termous?.portability?.onProgress((value) => setProgress(value))
    return () => removeListener?.()
  }, [])

  useEffect(() => {
    if (progress?.phase !== 'complete') return
    const timer = window.setTimeout(() => setProgress(null), 900)
    return () => window.clearTimeout(timer)
  }, [progress])

  useEffect(() => () => {
    const importId = activeImportIdRef.current
    if (!importId) return
    void getApi().then((api) => api.cancelDataPortabilityImport(importId)).catch(() => undefined)
  }, [getApi])

  const resetImportState = useCallback(() => {
    activeImportIdRef.current = ''
    setInspection(null)
    setPlan(null)
    setPage(null)
    setSelectedDatasets([])
    setSelectedItemKeys([])
    setCursorStack([])
    setCurrentCursor('')
    setStatusFilter('all')
    setImportPassword('')
    setRestorePrepared(false)
  }, [])

  const cancelImport = useCallback(async () => {
    const importId = activeImportIdRef.current
    resetImportState()
    if (!importId) return
    try {
      const api = await getApi()
      await api.cancelDataPortabilityImport(importId)
    } catch (error) {
      notification.warning({ title: t('settings.data.cancelFailed'), description: errorMessage(error) })
    }
  }, [getApi, notification, resetImportState, t])

  const handleExport = async () => {
    if (!exportPassword || exportPassword !== exportConfirm) {
      notification.warning({ title: t('settings.data.passwordMismatch') })
      return
    }
    const bridge = window.termous?.portability
    if (!bridge) {
      notification.error({ title: t('settings.data.nativeUnavailable') })
      return
    }
    setExportBusy(true)
    try {
      const result = await bridge.exportBackup(exportPassword)
      if (!result.canceled) {
        notification.success({ title: t('settings.data.exportComplete'), description: result.file_name })
      }
    } catch (error) {
      notification.error({ title: t('settings.data.exportFailed'), description: errorMessage(error) })
    } finally {
      setExportPassword('')
      setExportConfirm('')
      setExportBusy(false)
    }
  }

  const handleInspect = async () => {
    if (!importPassword) {
      notification.warning({ title: t('settings.data.passwordRequired') })
      return
    }
    const bridge = window.termous?.portability
    if (!bridge) {
      notification.error({ title: t('settings.data.nativeUnavailable') })
      return
    }
    setImportBusy(true)
    try {
      const result = await bridge.inspectBackup(importPassword)
      if (result.canceled || !result.inspection) return
      const nextInspection = normalizePortabilityImport(result.inspection)
      activeImportIdRef.current = nextInspection.import_id
      setInspection(nextInspection)
      setSelectedDatasets(nextInspection.datasets.filter((dataset) => dataset.count > 0).map((dataset) => dataset.key))
      setMode('merge_all')
      setPlan(null)
      setPage(null)
    } catch (error) {
      notification.error({ title: t('settings.data.inspectFailed'), description: errorMessage(error) })
    } finally {
      setImportPassword('')
      setImportBusy(false)
    }
  }

  const fetchPlanPage = useCallback(async (
    targetPlan: DataPortabilityRestorePlan,
    cursor = '',
    filter: PlanStatusFilter = statusFilter,
  ) => {
    if (!inspection) return
    const api = await getApi()
    const result = await api.dataPortabilityPlanItems(inspection.import_id, targetPlan.id, {
      cursor: cursor || undefined,
      status: filter === 'all' ? undefined : filter,
      limit: PAGE_SIZE,
    })
    setPage({ ...result, items: Array.isArray(result.items) ? result.items : [] })
    setCurrentCursor(cursor)
  }, [getApi, inspection, statusFilter])

  const analyze = async (selectedItems?: DataPortabilityItemRef[]) => {
    if (!inspection) return
    if (mode === 'selective' && !selectedItems && selectedDatasets.length === 0) {
      notification.warning({ title: t('settings.data.selectDatasetRequired') })
      return
    }
    setPlanBusy(true)
    try {
      const api = await getApi()
      const result = normalizePortabilityPlan(await api.createDataPortabilityPlan(inspection.import_id, {
        mode,
        selected_datasets: mode === 'selective' && !selectedItems ? selectedDatasets : undefined,
        selected_items: mode === 'selective' ? selectedItems : undefined,
      }))
      setPlan(result)
      setStatusFilter(result.summary.unresolved > 0 ? 'conflict' : 'all')
      setCursorStack([])
      const initialFilter = result.summary.unresolved > 0 ? 'conflict' : 'all'
      await fetchPlanPage(result, '', initialFilter)
      if (mode === 'selective') {
        setSelectedItemKeys(result.items.filter((item) => item.status !== 'removed' && item.status !== 'skipped').map(itemSelectionKey))
      }
    } catch (error) {
      notification.error({ title: t('settings.data.planFailed'), description: errorMessage(error) })
    } finally {
      setPlanBusy(false)
    }
  }

  const resolvePlan = async (action: DataPortabilityResolution, itemKeys?: string[]) => {
    if (!inspection || !plan) return
    setPlanBusy(true)
    try {
      const api = await getApi()
      const updated = normalizePortabilityPlan(await api.resolveDataPortabilityPlan(inspection.import_id, plan.id, {
        expected_revision: plan.revision,
        action,
        item_keys: itemKeys,
      }))
      setPlan(updated)
      setCursorStack([])
      await fetchPlanPage(updated, '', statusFilter)
    } catch (error) {
      notification.error({ title: t('settings.data.resolveFailed'), description: errorMessage(error) })
    } finally {
      setPlanBusy(false)
    }
  }

  const restartAfterRestore = async () => {
    const bridge = window.termous?.portability
    if (!bridge) {
      notification.warning({ title: t('settings.data.manualRestartTitle'), description: t('settings.data.manualRestartHint') })
      return
    }
    try {
      const result = await bridge.restartAfterRestore()
      if (result.requires_manual_restart) {
        modal.info({ title: t('settings.data.manualRestartTitle'), content: t('settings.data.manualRestartHint') })
        return
      }
      window.location.reload()
    } catch (error) {
      notification.error({ title: t('settings.data.restartFailed'), description: errorMessage(error), duration: 0 })
    }
  }

  const applyRestore = async () => {
    if (!inspection || !plan || plan.summary.unresolved > 0) return
    setApplyConfirmOpen(false)
    setPlanBusy(true)
    try {
      const api = await getApi()
      await api.applyDataPortabilityPlan(inspection.import_id, plan.id)
      activeImportIdRef.current = ''
      setRestorePrepared(true)
      notification.success({ title: t('settings.data.restorePrepared') })
      await restartAfterRestore()
    } catch (error) {
      notification.error({ title: t('settings.data.applyFailed'), description: errorMessage(error), duration: 6 })
    } finally {
      setPlanBusy(false)
    }
  }

  const changeStatusFilter = async (value: PlanStatusFilter) => {
    if (!plan) return
    setStatusFilter(value)
    setCursorStack([])
    setPlanBusy(true)
    try {
      await fetchPlanPage(plan, '', value)
    } catch (error) {
      notification.error({ title: t('settings.data.pageFailed'), description: errorMessage(error) })
    } finally {
      setPlanBusy(false)
    }
  }

  const nextPage = async () => {
    if (!plan || !page?.next_cursor) return
    setCursorStack((value) => [...value, currentCursor])
    setPlanBusy(true)
    try {
      await fetchPlanPage(plan, page.next_cursor)
    } catch (error) {
      notification.error({ title: t('settings.data.pageFailed'), description: errorMessage(error) })
      setCursorStack((value) => value.slice(0, -1))
    } finally {
      setPlanBusy(false)
    }
  }

  const previousPage = async () => {
    if (!plan || cursorStack.length === 0) return
    const previous = cursorStack[cursorStack.length - 1]
    setCursorStack((value) => value.slice(0, -1))
    setPlanBusy(true)
    try {
      await fetchPlanPage(plan, previous)
    } catch (error) {
      notification.error({ title: t('settings.data.pageFailed'), description: errorMessage(error) })
      setCursorStack((value) => [...value, previous])
    } finally {
      setPlanBusy(false)
    }
  }

  const selectableItems = useMemo(
    () => (plan?.items ?? []).filter((item) => item.status !== 'removed'),
    [plan?.items],
  )
  const selectionTree = useMemo(() => portabilityDatasets.map((dataset) => {
    const children = selectableItems.filter((item) => item.reference.dataset === dataset)
    if (children.length === 0) return null
    return {
      key: `group:${dataset}`,
      title: `${t(`settings.data.datasets.${dataset}`)} (${children.length})`,
      children: children.map((item) => ({ key: itemSelectionKey(item), title: item.label })),
    }
  }).filter((node): node is NonNullable<typeof node> => Boolean(node)), [selectableItems, t])

  const applyItemSelection = async () => {
    const keys = new Set(selectedItemKeys)
    const selected = selectableItems
      .filter((item) => keys.has(itemSelectionKey(item)))
      .map((item) => item.reference)
    if (selected.length === 0) {
      notification.warning({ title: t('settings.data.selectItemRequired') })
      return
    }
    setSelectionOpen(false)
    await analyze(selected)
  }

  const currentStep = restorePrepared ? 3 : plan ? 2 : inspection ? 1 : 0

  return (
    <div className="data-portability-section">
      <section className="data-portability-band">
        <BandHeader icon={<DatabaseBackup size={18} />} title={t('settings.data.exportTitle')} hint={t('settings.data.exportHint')} />
        <SummaryStrip summary={summary} busy={summaryBusy} onReload={loadSummary} />
        <div className="data-portability-password-grid">
          <Input.Password id="data-portability-export-password" autoComplete="off" value={exportPassword} maxLength={1024} prefix={<KeyRound size={15} />} placeholder={t('settings.data.password')} onChange={(event) => setExportPassword(event.target.value)} />
          <Input.Password id="data-portability-export-confirm" autoComplete="off" value={exportConfirm} maxLength={1024} prefix={<ShieldCheck size={15} />} placeholder={t('settings.data.confirmPassword')} onChange={(event) => setExportConfirm(event.target.value)} />
          <Button type="primary" icon={<FileArchive size={16} />} loading={exportBusy} onClick={() => void handleExport()}>
            {t('settings.data.exportAction')}
          </Button>
        </div>
        {progress?.operation === 'export' ? <OperationProgress progress={progress} /> : null}
      </section>

      <section className="data-portability-band">
        <BandHeader
          icon={<ArchiveRestore size={18} />}
          title={t('settings.data.importTitle')}
          hint={t('settings.data.importHint')}
          action={inspection && !restorePrepared ? <Button icon={<RotateCcw size={15} />} onClick={() => void cancelImport()}>{t('settings.data.resetImport')}</Button> : undefined}
        />
        <Steps
          className="data-portability-steps"
          current={currentStep}
          size="small"
          items={['select', 'review', 'resolve', 'apply'].map((key) => ({ title: t(`settings.data.steps.${key}`) }))}
        />

        {!inspection ? (
          <div className="data-portability-import-start">
            <Input.Password id="data-portability-import-password" autoComplete="off" value={importPassword} maxLength={1024} prefix={<KeyRound size={15} />} placeholder={t('settings.data.password')} onChange={(event) => setImportPassword(event.target.value)} />
            <Button type="primary" icon={<FileArchive size={16} />} loading={importBusy} onClick={() => void handleInspect()}>
              {t('settings.data.chooseBackup')}
            </Button>
          </div>
        ) : (
          <>
            <ImportOverview inspection={inspection} locale={i18n.language} />
            {inspection.warnings.length > 0 ? (
              <Alert type="warning" showIcon message={t('settings.data.pathWarnings', { count: inspection.warnings.length })} description={inspection.warnings.map((warning) => warning.label).filter(Boolean).join(' · ')} />
            ) : null}
            {!plan && !restorePrepared ? (
              <div className="data-portability-mode-panel">
                <Segmented<DataPortabilityRestoreMode>
                  block
                  value={mode}
                  options={(['replace_all', 'merge_all', 'selective'] as const).map((value) => ({ value, label: t(`settings.data.modes.${value}.title`) }))}
                  onChange={(value) => setMode(value)}
                />
                <p>{t(`settings.data.modes.${mode}.hint`)}</p>
                {mode === 'selective' ? (
                  <DatasetSelection inspection={inspection} value={selectedDatasets} onChange={setSelectedDatasets} />
                ) : null}
                <Button type="primary" icon={<SlidersHorizontal size={16} />} loading={planBusy} onClick={() => void analyze()}>
                  {t('settings.data.analyzeRestore')}
                </Button>
              </div>
            ) : null}
          </>
        )}
        {progress?.operation === 'import' ? <OperationProgress progress={progress} /> : null}
        {plan && inspection && !restorePrepared ? (
          <DataPortabilityPlanView
            plan={plan}
            page={page}
            statusFilter={statusFilter}
            pageNumber={cursorStack.length + 1}
            busy={planBusy}
            canGoBack={cursorStack.length > 0}
            canGoForward={Boolean(page?.next_cursor)}
            onStatusFilterChange={(value) => void changeStatusFilter(value)}
            onPreviousPage={() => void previousPage()}
            onNextPage={() => void nextPage()}
            onResolve={(action, keys) => void resolvePlan(action, keys)}
            onEditSelection={mode === 'selective' ? () => setSelectionOpen(true) : undefined}
            onApply={() => setApplyConfirmOpen(true)}
          />
        ) : null}
        {restorePrepared ? (
          <Alert type="success" showIcon message={t('settings.data.restorePrepared')} description={t('settings.data.restorePreparedHint')} action={<Button onClick={() => void restartAfterRestore()}>{t('settings.data.retryRestart')}</Button>} />
        ) : null}
      </section>

      <Modal open={selectionOpen} centered width={700} title={t('settings.data.itemSelectionTitle')} onCancel={() => setSelectionOpen(false)} onOk={() => void applyItemSelection()} okText={t('settings.data.reanalyze')} cancelText={t('app.cancel')}>
        <p className="data-portability-modal-hint">{t('settings.data.itemSelectionHint')}</p>
        <Tree
          className="data-portability-selection-tree"
          checkable
          virtual
          height={340}
          treeData={selectionTree}
          checkedKeys={selectedItemKeys}
          onCheck={(keys) => setSelectedItemKeys((Array.isArray(keys) ? keys : keys.checked).map(String).filter((key) => !key.startsWith('group:')))}
        />
      </Modal>

      <Modal open={applyConfirmOpen} centered title={t('settings.data.confirmRestoreTitle')} okText={t('settings.data.confirmRestore')} cancelText={t('app.cancel')} okButtonProps={{ danger: mode === 'replace_all' }} onCancel={() => setApplyConfirmOpen(false)} onOk={() => void applyRestore()}>
        <Alert type={mode === 'replace_all' ? 'warning' : 'info'} showIcon message={t(`settings.data.modes.${mode}.title`)} description={t('settings.data.confirmRestoreHint', { count: plan?.summary.total ?? 0 })} />
      </Modal>
    </div>
  )
}

function BandHeader({ icon, title, hint, action }: { icon: ReactNode; title: string; hint: string; action?: ReactNode }) {
  return <div className="data-portability-band-header"><div className="data-portability-band-icon">{icon}</div><div><h2>{title}</h2><p>{hint}</p></div>{action ? <div className="data-portability-band-action">{action}</div> : null}</div>
}

function SummaryStrip({ summary, busy, onReload }: { summary: DataPortabilitySummary | null; busy: boolean; onReload: () => void }) {
  const { t } = useTranslation()
  return <div className="data-portability-summary"><div><span>{t('settings.data.totalItems')}</span><strong>{summary?.total_items ?? '—'}</strong></div><div><span>{t('settings.data.datasetsCount')}</span><strong>{summary?.datasets.filter((item) => item.count > 0).length ?? '—'}</strong></div><div><span>{t('settings.data.assets')}</span><strong>{summary ? `${summary.asset_count} · ${formatPortabilityBytes(summary.asset_bytes)}` : '—'}</strong></div><Button aria-label={t('app.reload')} icon={<RefreshCw size={15} />} loading={busy} onClick={onReload} /></div>
}

function ImportOverview({ inspection, locale }: { inspection: DataPortabilityImport; locale: string }) {
  const { t } = useTranslation()
  return <div className="data-portability-import-overview"><div className="data-portability-file-mark"><FileArchive size={20} /></div><div><span>{t('settings.data.sourceVersion')}</span><strong>{inspection.source_app_version}</strong></div><div><span>{t('settings.data.createdAt')}</span><strong>{new Date(inspection.created_at).toLocaleString(locale)}</strong></div><div><span>{t('settings.data.totalItems')}</span><strong>{inspection.total_items}</strong></div><div><span>{t('settings.data.assets')}</span><strong>{inspection.asset_count} · {formatPortabilityBytes(inspection.asset_bytes)}</strong></div></div>
}

function DatasetSelection({ inspection, value, onChange }: { inspection: DataPortabilityImport; value: DataPortabilityDatasetKey[]; onChange: (value: DataPortabilityDatasetKey[]) => void }) {
  const { t } = useTranslation()
  const counts = new Map(inspection.datasets.map((dataset) => [dataset.key, dataset.count]))
  return <div className="data-portability-dataset-grid">{portabilityDatasets.map((dataset) => <Checkbox key={dataset} checked={value.includes(dataset)} disabled={(counts.get(dataset) ?? 0) === 0} onChange={(event) => onChange(event.target.checked ? [...value, dataset] : value.filter((item) => item !== dataset))}><span>{t(`settings.data.datasets.${dataset}`)}</span><small>{counts.get(dataset) ?? 0}</small></Checkbox>)}</div>
}

function OperationProgress({ progress }: { progress: DataPortabilityProgress }) {
  const { t } = useTranslation()
  const percent = portabilityProgressPercent(progress)
  return <div className="data-portability-progress"><div>{progress.phase === 'complete' ? <CheckCircle2 size={16} /> : <RefreshCw className="is-spinning" size={16} />}<span>{t(`settings.data.progress.${progress.phase}`)}</span><strong>{percent}%</strong></div><Progress percent={percent} showInfo={false} size="small" /></div>
}
