import { Alert, App, Button, ConfigProvider, Modal, Segmented } from 'antd'
import { ChevronRight, Workflow } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Step } from '#entities/desktop-workflow'
import type { WorkflowMediaGateway, WorkflowSurfaceModel } from '../model/workspace/types'
import { copyStep, editStep, findStep, insertStep, moveStep, newStep } from '../model/steps'
import { isRunActive } from '../model/messages'
import { ParameterDialog } from './editor/ParameterDialog'
import { RunDialogView } from './execution/RunDialog'
import { RunReportView } from './execution/RunReport'
import { ScreenshotEditor } from './editor/ScreenshotEditor'
import { StepProperties } from './editor/StepProperties'
import { StepTree } from './editor/StepTree'
import { WorkflowCatalog } from './catalog/WorkflowCatalog'
import { editorCompactWidth } from '../model/editorLayout'
import { WorkflowEditorLayout } from './editor/WorkflowEditorLayout'
import { WorkflowEditorToolbar } from './editor/WorkflowEditorToolbar'
import { WorkflowOverview } from './catalog/WorkflowOverview'
import { workflowAuthor } from '../model/author'
import styles from './WorkflowWorkspace.module.scss'
import overlays from './shared/WorkflowOverlays.module.scss'
import { useWorkflowFeedback } from './shared/useWorkflowFeedback'
import { WorkflowAnalysis, type AnalysisTransfer } from './analysis/WorkflowAnalysis'
import type { ImageSlot } from '../model/images'
import { useOCRDefaults } from './editor/useOCRDefaults'
import { newOCRQuery } from '../model/ocr'
import { WorkflowExchangeDialog } from './exchange/WorkflowExchangeDialog'
import { WorkflowExportDialog } from './exchange/WorkflowExportDialog'
import { workflowSummary } from '../model/exchange/summary'

export function WorkflowWorkspaceView({ model, gateway, headerActions, windowAction, onMediaTask, active = true, guided = false }: {
  model: WorkflowSurfaceModel; gateway: WorkflowMediaGateway; headerActions?: ReactNode; windowAction?: ReactNode; onMediaTask: (task: Promise<unknown>) => void
  active?: boolean; guided?: boolean
}) {
  const { t } = useTranslation(); const { modal, message } = App.useApp()
  useWorkflowFeedback(model)
  const ocrDefaults = useOCRDefaults(gateway)
  const confirmations = useRef(new Set<ReturnType<typeof modal.confirm>>())
  useEffect(() => {
    const instances = confirmations.current
    return () => { for (const instance of instances) instance.destroy(); instances.clear() }
  }, [])
  const confirm = (options: Parameters<typeof modal.confirm>[0]) => {
    const instance = modal.confirm({ ...options, afterClose: () => { confirmations.current.delete(instance); options.afterClose?.() } })
    confirmations.current.add(instance)
    return instance
  }
  const { state, actions, target } = model
  const current = useRef(model); current.current = model
  const { draft, dirty, view, selected, selectedRun, busy, versions, presentation } = state
  const { sessions } = model.environment
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1400)
  const [parametersOpen, setParametersOpen] = useState(false)
  const [exportVersion, setExportVersion] = useState<{ number?: number; editingID: string }>()
  const [analysisSlot, setAnalysisSlot] = useState<ImageSlot>('target')
  const [analysisTransfer, setAnalysisTransfer] = useState<AnalysisTransfer>()
  const catalogCollapsed = presentation.catalogCollapsed ?? width < 1100
  const setCatalogPreference = (catalogCollapsed: boolean) => actions.presentation({ catalogCollapsed })
  const compact = width < 700
  const editorWidth = width - (catalogCollapsed || compact ? 48 : 248) - 24
  const narrow = editorWidth < editorCompactWidth
  const step = findStep(draft?.definition.steps ?? [], selected)
  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => { if (entry?.contentRect.width > 0) setWidth(entry.contentRect.width) })
    observer.observe(root.current); return () => observer.disconnect()
  }, [])
  const guard = (next: () => void) => {
    if (!dirty) { next(); return }
    confirm({ title: t('desktopWorkflow.unsavedTitle'), content: t('desktopWorkflow.unsavedDescription'), okText: t('desktopWorkflow.discard'), onOk: next })
  }
  const change: typeof actions.change = patch => actions.change({...patch,...(patch.definition ? {definition:{...patch.definition,schema_version:2}} : {})})
  const changeStep = (value: Step) => {
    if (draft) change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, value.id, () => value) } })
  }
  const create = () => guard(() => actions.create(t('desktopWorkflow.newScript')))
  const load = actions.load
  const save = actions.save
  const validate = actions.validate
  const history = actions.history
  const restore = (version: number) => guard(() => { void actions.restore(version) })
  const openRun = actions.openRun
  const openExport = (number?: number) => {
    if (!draft?.script) return
    if (number === undefined && dirty) { void message.warning(t('desktopWorkflow.exchange.saveFirst')); return }
    setExportVersion({ number, editingID: draft.editingID })
  }
  const remove = () => confirm({ title: t('desktopWorkflow.deleteScript'), content: t('desktopWorkflow.deleteHint'), okButtonProps: { danger: true }, onOk: actions.remove })
  const showRun = actions.showRun
  const properties = step && <StepProperties step={step} ocrDefaults={ocrDefaults.value} parameters={draft?.definition.parameters ?? []} onChange={changeStep} />
  const latest = model.scripts.find((item) => item.id === draft?.script?.id)
  const externallyUpdated = !!draft?.script && !!latest && latest.revision > draft.script.revision
  const activeCount = model.runs.filter((run) => isRunActive(run.state)).length
  return <ConfigProvider
    select={{ classNames: { popup: { root: overlays.select } } }}
    drawer={{ classNames: { section: overlays.drawer, header: overlays['overlay-header'], body: overlays['drawer-body'] } }}
    modal={{ classNames: { container: overlays.dialog, header: overlays['dialog-header'] } }}
  ><div ref={root} className={styles.workspace} data-narrow={narrow || undefined}>
    <header className={styles['workspace-header']}>
      <div className={styles.breadcrumb}><Workflow size={18} /><strong>{t('desktopWorkflow.workflow')}</strong><ChevronRight size={13} /><Segmented data-tour="automation-history" value={view} options={[{ value: 'scripts', label: t('desktopWorkflow.analysisWorkspace.workbench') }, { value: 'runs', label: t('desktopWorkflow.executionHistory') }]} onChange={actions.view} /></div>
      <div className={styles['workspace-actions']} data-tour="automation-actions">
        <WorkflowAnalysis model={model} gateway={gateway} active={active} guided={guided} slot={step?.kind.startsWith('image.') || step?.kind.startsWith('ocr.') || step?.kind === 'if' ? 'image' : step?.kind === 'pointer.drag' ? analysisSlot : 'target'} onMediaTask={onMediaTask} onApplied={setAnalysisTransfer} />
        {activeCount > 0 && <button type="button" className={styles['active-runs']} onClick={() => { const first = model.runs.find((run) => isRunActive(run.state)); if (first) showRun(first.id) }}>{t('desktopWorkflow.activeRuns', { count: activeCount })}</button>}
        {windowAction}{headerActions && <div className={styles['header-extension']}>{headerActions}</div>}
      </div>
    </header>
    <div className={styles.body} data-collapsed={catalogCollapsed || undefined} data-overlay={compact && !catalogCollapsed || undefined}>
      <WorkflowCatalog onImport={state.exchange?.available ? () => { void actions.exchange?.({ kind: 'import' }) } : undefined} scripts={model.scripts} runs={model.runs} view={view} selectedScript={draft?.script?.id} selectedRun={selectedRun} busy={busy} loading={model.loading} collapsed={catalogCollapsed} onToggle={() => setCatalogPreference(!catalogCollapsed)} onCreate={() => { create(); if (compact) setCatalogPreference(true) }} onSelectScript={(id) => guard(() => { void load(id); if (compact) setCatalogPreference(true) })} onSelectRun={(id) => { showRun(id); if (compact) setCatalogPreference(true) }} queries={presentation.queries} runFilter={presentation.runFilter} onQueriesChange={queries => actions.presentation({ queries })} onRunFilterChange={runFilter => actions.presentation({ runFilter })} onRefresh={actions.refresh} />
      {compact && !catalogCollapsed && <button type="button" className={styles['catalog-mask']} aria-label={t('desktopWorkflow.collapseLibrary')} onClick={() => setCatalogPreference(true)} />}
      <main className={styles.main} inert={compact && !catalogCollapsed}>
        {view === 'scripts' ? draft ? <>
          {ocrDefaults.error != null && <Alert type="warning" title={t('desktopWorkflow.ocr.settingsFailed')} action={<Button onClick={ocrDefaults.refresh}>{t('app.retry')}</Button>} />}
          {externallyUpdated && <Alert type="info" title={t('desktopWorkflow.externalUpdate')} description={t('desktopWorkflow.externalUpdateHint')} action={<Button size="small" disabled={busy} onClick={() => guard(() => void load(draft!.script!.id))}>{t('desktopWorkflow.loadLatest')}</Button>} />}
          <WorkflowEditorToolbar key={draft.editingID} name={draft.name} description={draft.description} tags={draft.tags} revision={draft.script?.revision} parameterCount={draft.definition.parameters.length} dirty={dirty} busy={busy} onChange={change} onSave={() => void save()} onValidate={() => void validate()} onRun={openRun} onParameters={() => setParametersOpen(true)} onHistory={() => void history()} onExport={state.exchange?.available ? () => openExport() : undefined} onCopy={() => guard(() => actions.copy(t('desktopWorkflow.copyName', { name: draft.name })))} onRemove={remove} />
          <WorkflowEditorLayout width={editorWidth} busy={busy} presentation={presentation} onPresentation={actions.presentation} properties={properties}
            chain={(onCollapse, onSelected) => <StepTree steps={draft.definition.steps} selected={selected} onCollapse={onCollapse} onSelect={id => { actions.selectStep(id); onSelected() }}
              foldedSteps={presentation.foldedSteps ?? []} onFoldChange={foldedSteps => actions.presentation({ foldedSteps })}
              onAdd={(kind, parent, branch) => { if (kind.startsWith('ocr.') && !ocrDefaults.value) { void message.warning(t('desktopWorkflow.ocr.settingsFailed')); return }; const value = newStep(kind); if (kind.startsWith('ocr.') && ocrDefaults.value) value.ocr = newOCRQuery(ocrDefaults.value); change({ definition: { ...draft.definition, steps: insertStep(draft.definition.steps, value, parent, branch) } }); actions.selectStep(value.id) }}
              onMove={(id, delta) => change({ definition: { ...draft.definition, steps: moveStep(draft.definition.steps, id, delta) } })}
              onCopy={(id) => change({ definition: { ...draft.definition, steps: copyStep(draft.definition.steps, id) } })}
              onRemove={(id) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, () => undefined) } })}
              onToggle={(id, disabled) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, (value) => ({ ...value, disabled })) } })} />} >
            <ScreenshotEditor slot={analysisSlot} onSlotChange={setAnalysisSlot} analysisTransfer={analysisTransfer?.editingID === draft.editingID ? analysisTransfer : undefined} onTransferApplied={() => setAnalysisTransfer(undefined)} key={draft.editingID} enabled={!guided} gateway={gateway} hostSources={model.environment.hostSources} sessions={sessions} target={target} onTargetChange={actions.target} step={step} onMediaTask={onMediaTask} onChange={(id, edit) => {
              const latest = current.current.state.draft
              if (latest?.editingID === draft.editingID) current.current.actions.change({ definition: { ...latest.definition, schema_version:2, steps: editStep(latest.definition.steps, id, edit) } })
            }} />
          </WorkflowEditorLayout>
          {parametersOpen && <ParameterDialog value={draft.definition.parameters} onSave={(parameters) => change({ definition: { ...draft.definition, parameters } })} onClose={() => setParametersOpen(false)} />}
          {model.execution.launch && <RunDialogView launch={model.execution.launch} environment={model.environment} onTargetChange={actions.target} onChange={actions.changeRun} onSubmit={actions.start} onClose={actions.closeRun} />}
        </> : <div className={styles['overview-scroll']}><WorkflowOverview scriptCount={model.scripts.length} runs={model.runs} onCreate={create} onRun={showRun} /></div> : null}
        {/* 保留未确认控制请求的标识；隐藏报告只暂停读取，不取消远端执行。 */}
        <RunReportView gateway={gateway} id={selectedRun} report={model.execution.report} active={view === 'runs'} onControl={actions.control} onRefresh={actions.refreshReport} onView={actions.viewDesktop}
          expansion={state.presentation.reportExpansion} onExpansionChange={reportExpansion => actions.presentation({ reportExpansion })} />
      </main>
    </div>
    <WorkflowExchangeDialog model={model} gateway={gateway} guard={guard} />
    {exportVersion && exportVersion.editingID === draft?.editingID && <WorkflowExportDialog hasAssets={workflowSummary(exportVersion.number === undefined ? draft?.definition : versions?.find(v => v.number === exportVersion.number)?.definition).hasAssets}
      onClose={() => setExportVersion(undefined)} onExport={layout => { void actions.exchange?.({ kind: 'export', version: exportVersion.number, layout }); setExportVersion(undefined) }} />}
    <Modal open={!!versions} title={t('desktopWorkflow.history')} footer={null} onCancel={actions.closeHistory}><div className={styles['version-list']}>{versions?.map((version) => <div key={version.number}><strong>v{version.number}</strong>{state.exchange?.available && <Button disabled={busy || state.exchange.busy} onClick={() => openExport(version.number)}>{t('desktopWorkflow.exchange.export')}</Button>}<span>{workflowAuthor(version.author, t)} · {new Date(version.created_at).toLocaleString()}</span><Button disabled={busy || version.number === draft?.script?.revision} onClick={() => restore(version.number)}>{t('desktopWorkflow.restore')}</Button></div>)}</div></Modal>
  </div></ConfigProvider>
}
