import { Alert, App, Button, ConfigProvider, Drawer, Modal } from 'antd'
import { ChevronRight, History, PanelRightClose, SlidersHorizontal, Workflow } from 'lucide-react'
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
import { WorkflowEditorToolbar } from './editor/WorkflowEditorToolbar'
import { WorkflowOverview } from './catalog/WorkflowOverview'
import { workflowAuthor } from '../model/author'
import styles from './WorkflowWorkspace.module.scss'
import overlays from './shared/WorkflowOverlays.module.scss'
import { useWorkflowFeedback } from './shared/useWorkflowFeedback'

export function WorkflowWorkspaceView({ model, gateway, headerActions, windowAction, onMediaTask }: {
  model: WorkflowSurfaceModel; gateway: WorkflowMediaGateway; headerActions?: ReactNode; windowAction?: ReactNode; onMediaTask: (task: Promise<unknown>) => void
}) {
  const { t } = useTranslation(); const { modal } = App.useApp()
  useWorkflowFeedback(model)
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
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const catalogCollapsed = presentation.catalogCollapsed ?? width < 1100
  const propertiesVisible = presentation.propertiesVisible
  const setCatalogPreference = (catalogCollapsed: boolean) => actions.presentation({ catalogCollapsed })
  const setPropertiesVisible = (propertiesVisible: boolean) => actions.presentation({ propertiesVisible })
  const compact = width < 700
  const narrow = width - (catalogCollapsed || compact ? 48 : 248) < 1000
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
  const change = actions.change
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
  const remove = () => confirm({ title: t('desktopWorkflow.deleteScript'), content: t('desktopWorkflow.deleteHint'), okButtonProps: { danger: true }, onOk: actions.remove })
  const showRun = actions.showRun
  const properties = step && <StepProperties step={step} parameters={draft?.definition.parameters ?? []} onChange={changeStep} />
  const latest = model.scripts.find((item) => item.id === draft?.script?.id)
  const externallyUpdated = !!draft?.script && !!latest && latest.revision > draft.script.revision
  const activeCount = model.runs.filter((run) => isRunActive(run.state)).length
  return <ConfigProvider
    select={{ classNames: { popup: { root: overlays.select } } }}
    drawer={{ classNames: { section: overlays.drawer, header: overlays['overlay-header'], body: overlays['drawer-body'] } }}
    modal={{ classNames: { container: overlays.dialog, header: overlays['dialog-header'] } }}
  ><div ref={root} className={styles.workspace} data-narrow={narrow || undefined}>
    <header className={styles['workspace-header']}>
      <div className={styles.breadcrumb}><Workflow size={18} /><strong>{t('desktopWorkflow.workflow')}</strong><ChevronRight size={13} /><span>{t(view === 'scripts' ? 'desktopWorkflow.compose' : 'desktopWorkflow.executionHistory')}</span></div>
      <div className={styles['workspace-actions']}>
        {activeCount > 0 && <button type="button" className={styles['active-runs']} onClick={() => { const first = model.runs.find((run) => isRunActive(run.state)); if (first) showRun(first.id) }}>{t('desktopWorkflow.activeRuns', { count: activeCount })}</button>}
        <Button size="small" type="text" icon={<History size={15} />} onClick={() => actions.view(view === 'scripts' ? 'runs' : 'scripts')}>{t(view === 'scripts' ? 'desktopWorkflow.executionHistory' : 'desktopWorkflow.backToEditor')}</Button>
        {windowAction}{headerActions && <div className={styles['header-extension']}>{headerActions}</div>}
      </div>
    </header>
    <div className={styles.body} data-collapsed={catalogCollapsed || undefined} data-overlay={compact && !catalogCollapsed || undefined}>
      <WorkflowCatalog scripts={model.scripts} runs={model.runs} view={view} selectedScript={draft?.script?.id} selectedRun={selectedRun} busy={busy} loading={model.loading} collapsed={catalogCollapsed} onToggle={() => setCatalogPreference(!catalogCollapsed)} onCreate={() => { create(); if (compact) setCatalogPreference(true) }} onSelectScript={(id) => guard(() => { void load(id); if (compact) setCatalogPreference(true) })} onSelectRun={(id) => { showRun(id); if (compact) setCatalogPreference(true) }} onViewChange={actions.view} queries={presentation.queries} runFilter={presentation.runFilter} onQueriesChange={queries => actions.presentation({ queries })} onRunFilterChange={runFilter => actions.presentation({ runFilter })} onRefresh={actions.refresh} />
      {compact && !catalogCollapsed && <button type="button" className={styles['catalog-mask']} aria-label={t('desktopWorkflow.collapseLibrary')} onClick={() => setCatalogPreference(true)} />}
      <main className={styles.main} inert={compact && !catalogCollapsed}>
        {view === 'scripts' ? draft ? <>
          {externallyUpdated && <Alert type="info" title={t('desktopWorkflow.externalUpdate')} description={t('desktopWorkflow.externalUpdateHint')} action={<Button size="small" disabled={busy} onClick={() => guard(() => void load(draft!.script!.id))}>{t('desktopWorkflow.loadLatest')}</Button>} />}
          <WorkflowEditorToolbar key={draft.editingID} name={draft.name} description={draft.description} tags={draft.tags} revision={draft.script?.revision} parameterCount={draft.definition.parameters.length} dirty={dirty} busy={busy} propertiesVisible={narrow ? propertiesOpen : propertiesVisible} onChange={change} onSave={() => void save()} onValidate={() => void validate()} onRun={openRun} onProperties={() => narrow ? setPropertiesOpen((open) => !open) : setPropertiesVisible(!propertiesVisible)} onParameters={() => setParametersOpen(true)} onHistory={() => void history()} onCopy={() => guard(() => actions.copy(t('desktopWorkflow.copyName', { name: draft.name })))} onRemove={remove} />
          <div inert={busy} className={styles['editor-grid']} data-properties={!narrow && propertiesVisible || undefined}>
            <StepTree steps={draft.definition.steps} selected={selected} onSelect={actions.selectStep}
              foldedSteps={presentation.foldedSteps ?? []} onFoldChange={foldedSteps => actions.presentation({ foldedSteps })}
              onAdd={(kind, parent, branch) => { const value = newStep(kind); change({ definition: { ...draft.definition, steps: insertStep(draft.definition.steps, value, parent, branch) } }); actions.selectStep(value.id) }}
              onMove={(id, delta) => change({ definition: { ...draft.definition, steps: moveStep(draft.definition.steps, id, delta) } })}
              onCopy={(id) => change({ definition: { ...draft.definition, steps: copyStep(draft.definition.steps, id) } })}
              onRemove={(id) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, () => undefined) } })}
              onToggle={(id, disabled) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, (value) => ({ ...value, disabled })) } })} />
            <ScreenshotEditor key={draft.editingID} gateway={gateway} sessions={sessions} target={target} onTargetChange={actions.target} step={step} onMediaTask={onMediaTask} onChange={(id, edit) => {
              const latest = current.current.state.draft
              if (latest?.editingID === draft.editingID) current.current.actions.change({ definition: { ...latest.definition, steps: editStep(latest.definition.steps, id, edit) } })
            }} />
            {!narrow && propertiesVisible && <aside className={styles['property-panel']} aria-label={t('desktopWorkflow.properties')}><header className={styles['panel-header']}><SlidersHorizontal size={14} /><strong>{t('desktopWorkflow.properties')}</strong><Button type="text" size="small" aria-label={t('desktopWorkflow.collapseProperties')} icon={<PanelRightClose size={15} />} onClick={() => setPropertiesVisible(false)} /></header>{properties || <p className={styles.hint}>{t('desktopWorkflow.selectStep')}</p>}</aside>}
          </div>
          {parametersOpen && <ParameterDialog value={draft.definition.parameters} onSave={(parameters) => change({ definition: { ...draft.definition, parameters } })} onClose={() => setParametersOpen(false)} />}
          {model.execution.launch && <RunDialogView launch={model.execution.launch} environment={model.environment} onTargetChange={actions.target} onChange={actions.changeRun} onSubmit={actions.start} onClose={actions.closeRun} />}
        </> : <div className={styles['overview-scroll']}><WorkflowOverview scriptCount={model.scripts.length} runs={model.runs} onCreate={create} onRun={showRun} /></div> : null}
        {/* 保留未确认控制请求的标识；隐藏报告只暂停读取，不取消远端执行。 */}
        <RunReportView gateway={gateway} id={selectedRun} report={model.execution.report} active={view === 'runs'} onControl={actions.control} onRefresh={actions.refreshReport} onView={actions.viewDesktop}
          expansion={state.presentation.reportExpansion} onExpansionChange={reportExpansion => actions.presentation({ reportExpansion })} />
      </main>
    </div>
    <Drawer open={narrow && propertiesOpen && !busy} title={t('desktopWorkflow.properties')} onClose={() => setPropertiesOpen(false)} size={340}>{properties}</Drawer>
    <Modal open={!!versions} title={t('desktopWorkflow.history')} footer={null} onCancel={actions.closeHistory}><div className={styles['version-list']}>{versions?.map((version) => <div key={version.number}><strong>v{version.number}</strong><span>{workflowAuthor(version.author, t)} · {new Date(version.created_at).toLocaleString()}</span><Button disabled={busy || version.number === draft?.script?.revision} onClick={() => restore(version.number)}>{t('desktopWorkflow.restore')}</Button></div>)}</div></Modal>
  </div></ConfigProvider>
}
