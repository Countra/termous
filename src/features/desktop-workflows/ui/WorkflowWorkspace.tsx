import { Alert, App, Button, Drawer, Modal } from 'antd'
import { ChevronRight, History, Workflow } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { Definition, Diagnostic, Run, Script, Step, Version, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import { copyStep, editStep, findStep, insertStep, moveStep, newDefinition, newStep } from '../model/steps'
import { useWorkflowData } from '../model/useWorkflowData'
import { isRunActive, workflowError } from '../model/messages'
import { ParameterDialog } from './editor/ParameterDialog'
import { RunDialog } from './execution/RunDialog'
import { RunReport } from './execution/RunReport'
import { ScreenshotEditor } from './editor/ScreenshotEditor'
import { StepProperties } from './editor/StepProperties'
import { StepTree } from './editor/StepTree'
import { WorkflowCatalog } from './catalog/WorkflowCatalog'
import { WorkflowEditorToolbar } from './editor/WorkflowEditorToolbar'
import { WorkflowOverview } from './catalog/WorkflowOverview'
import { workflowAuthor } from '../model/author'
import { sessionTarget, type WorkflowTarget } from '../model/target'
import styles from './WorkflowWorkspace.module.scss'

export interface WorkflowWorkspaceProps {
  gateway: WorkflowGateway; sessions: RemoteDesktopSession[]; profiles: RemoteDesktopAccessProfile[]
  activeSessionId?: string
  headerActions?: ReactNode
  onDirtyChange: (dirty: boolean) => void; onViewDesktop: (session: string) => void | Promise<void>
}
interface Draft { editingID: string; script?: Script; name: string; description: string; tags: string[]; definition: Definition }
export function WorkflowWorkspace({ gateway, sessions, activeSessionId, profiles, headerActions, onDirtyChange, onViewDesktop }: WorkflowWorkspaceProps) {
  const { t } = useTranslation(); const { modal } = App.useApp()
  const data = useWorkflowData(gateway)
  const [draft, setDraft] = useState<Draft>()
  const [dirty, setDirty] = useState(false)
  const [view, setView] = useState<'scripts' | 'runs'>('scripts')
  const [selected, setSelected] = useState<string>()
  const [selectedRun, setSelectedRun] = useState<string>()
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>()
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [parametersOpen, setParametersOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [versions, setVersions] = useState<Version[]>()
  const [runDialog, setRunDialog] = useState<{ debug: boolean }>()
  const [chosenTarget, setChosenTarget] = useState<WorkflowTarget>()
  // 手动选择或打开运行对话框后固定目标；后台遥测不能替换会话及代次。
  const target = chosenTarget ?? sessionTarget(sessions, activeSessionId)
  const openRun = (debug: boolean) => { setChosenTarget(target); setRunDialog({ debug }) }
  const serial = useRef(0)
  const edits = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const [narrow, setNarrow] = useState(false)
  const step = findStep(draft?.definition.steps ?? [], selected)
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
  useEffect(() => {
    if (!root.current) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 1200
      if (width > 0) setNarrow(width < 1180)
    })
    observer.observe(root.current); return () => observer.disconnect()
  }, [])
  const guard = (next: () => void) => {
    if (!dirty) { next(); return }
    modal.confirm({ title: t('desktopWorkflow.unsavedTitle'), content: t('desktopWorkflow.unsavedDescription'), okText: t('desktopWorkflow.discard'), onOk: next })
  }
  const change = (patch: Partial<Draft>) => { edits.current++; setDraft((value) => value ? { ...value, ...patch } : value); setDirty(true); setDiagnostics(undefined) }
  const changeStep = useCallback((value: Step) => {
    edits.current++
    setDraft((item) => item ? { ...item, definition: { ...item.definition, steps: editStep(item.definition.steps, value.id, () => value) } } : item)
    setDirty(true); setDiagnostics(undefined)
  }, [])
  const load = async (id: string) => {
    const version = ++serial.current; setBusy(true); setError(undefined)
    try {
      const value = await gateway.get(id)
      if (version === serial.current) { setDraft({ editingID: crypto.randomUUID(), script: value.script, name: value.script.name, description: value.script.description, tags: value.script.tags ?? [], definition: value.version.definition }); setDirty(false); setSelected(undefined); setDiagnostics(undefined) }
    } catch (reason) { if (version === serial.current) setError(reason) } finally { if (version === serial.current) setBusy(false) }
  }
  const create = () => guard(() => { serial.current++; setBusy(false); setView('scripts'); setDraft({ editingID: crypto.randomUUID(), name: t('desktopWorkflow.newScript'), description: '', tags: [], definition: newDefinition() }); setDirty(true); setSelected(undefined); setDiagnostics(undefined); setError(undefined) })
  const save = async () => {
    if (!draft || busy) return
    const savedEdits = edits.current
    setBusy(true); setError(undefined)
    try {
      const script = await gateway.save(draft.script?.id, { expected_revision: draft.script?.revision ?? 0, name: draft.name, description: draft.description, tags: draft.tags, definition: draft.definition })
      // 保存期间模板上传仍可能完成，只更新版本信息，保留之后的草稿修改。
      setDraft((current) => current?.editingID === draft.editingID ? { ...current, script } : current)
      setDirty(edits.current !== savedEdits); void data.reload()
    } catch (reason) { setError(reason) } finally { setBusy(false) }
  }
  const validate = async () => {
    if (!draft || busy) return
    setBusy(true); setError(undefined)
    try { setDiagnostics(await gateway.validate(draft.definition)) } catch (reason) { setError(reason) } finally { setBusy(false) }
  }
  const history = async () => {
    if (!draft?.script || busy) return
    setBusy(true); setError(undefined)
    try { setVersions(await gateway.versions(draft.script.id)) } catch (reason) { setError(reason) } finally { setBusy(false) }
  }
  const restore = (number: number) => guard(() => {
    if (!draft?.script) return
    const { id, revision } = draft.script
    setBusy(true)
    void gateway.restore(id, number, revision).then(() => { setVersions(undefined); void data.reload(); return load(id) }).catch(setError).finally(() => setBusy(false))
  })
  const remove = () => {
    if (!draft?.script) return
    const { id, revision } = draft.script
    modal.confirm({ title: t('desktopWorkflow.deleteScript'), content: t('desktopWorkflow.deleteHint'), okButtonProps: { danger: true }, onOk: async () => { try { await gateway.remove(id, revision); setDraft(undefined); setDirty(false); void data.reload() } catch (reason) { setError(reason); throw reason } } })
  }
  const started = (run: Run) => { setRunDialog(undefined); setSelectedRun(run.id); setView('runs'); void data.reload() }
  const showRun = (id: string) => { setSelectedRun(id); setView('runs') }
  const properties = step && <StepProperties step={step} parameters={draft?.definition.parameters ?? []} onChange={changeStep} />
  const latest = data.scripts.find((item) => item.id === draft?.script?.id)
  const externallyUpdated = !!draft?.script && !!latest && latest.revision > draft.script.revision
  const activeCount = data.runs.filter((run) => isRunActive(run.state)).length
  return <div ref={root} className={styles.workspace} data-narrow={narrow || undefined}>
    <header className={styles['workspace-header']}>
      <div className={styles.breadcrumb}><Workflow size={18} /><strong>{t('desktopWorkflow.workflow')}</strong><ChevronRight size={13} /><span>{t(view === 'scripts' ? 'desktopWorkflow.compose' : 'desktopWorkflow.executionHistory')}</span></div>
      <div className={styles['workspace-actions']}>
        {activeCount > 0 && <button type="button" className={styles['active-runs']} onClick={() => { const first = data.runs.find((run) => isRunActive(run.state)); if (first) showRun(first.id) }}>{t('desktopWorkflow.activeRuns', { count: activeCount })}</button>}
        <Button size="small" type="text" icon={<History size={15} />} onClick={() => setView(view === 'scripts' ? 'runs' : 'scripts')}>{t(view === 'scripts' ? 'desktopWorkflow.executionHistory' : 'desktopWorkflow.backToEditor')}</Button>
        {headerActions && <div className={styles['header-extension']}>{headerActions}</div>}
      </div>
    </header>
    <div className={styles.body}>
      <WorkflowCatalog scripts={data.scripts} runs={data.runs} view={view} selectedScript={draft?.script?.id} selectedRun={selectedRun} busy={busy} loading={data.loading} onCreate={create} onSelectScript={(id) => guard(() => void load(id))} onSelectRun={showRun} onViewChange={setView} onRefresh={() => void data.reload()} />
      <main className={styles.main}>
        {(error ?? data.error) != null && <Alert type="error" title={workflowError(error ?? data.error, t)} closable onClose={() => setError(undefined)} />}
        {view === 'scripts' ? draft ? <>
          {externallyUpdated && <Alert type="info" title={t('desktopWorkflow.externalUpdate')} description={t('desktopWorkflow.externalUpdateHint')} action={<Button size="small" disabled={busy} onClick={() => guard(() => void load(draft!.script!.id))}>{t('desktopWorkflow.loadLatest')}</Button>} />}
          <WorkflowEditorToolbar name={draft.name} description={draft.description} tags={draft.tags} revision={draft.script?.revision} dirty={dirty} busy={busy} narrow={narrow} hasStep={!!step} onChange={change} onSave={() => void save()} onValidate={() => void validate()} onRun={openRun} onProperties={() => setPropertiesOpen(true)} onParameters={() => setParametersOpen(true)} onHistory={() => void history()} onCopy={() => guard(() => { setDraft({ ...structuredClone(draft), editingID: crypto.randomUUID(), script: undefined, name: t('desktopWorkflow.copyName', { name: draft.name }) }); setDirty(true) })} onRemove={remove} />
          {diagnostics && <Alert type={diagnostics.length ? 'warning' : 'success'} title={t(diagnostics.length ? 'desktopWorkflow.validationFailed' : 'desktopWorkflow.validationPassed')} description={diagnostics.length ? diagnostics.map((item, i) => <button key={i} className={styles.diagnostic} onClick={() => setSelected(item.step_id)}>{findStep(draft.definition.steps, item.step_id)?.name || item.field}: {t(`desktopWorkflow.diagnostics.${item.code}`, { defaultValue: item.code })}</button>) : undefined} />}
          <div inert={busy} className={styles['editor-grid']} data-narrow={narrow || undefined}>
            <StepTree steps={draft.definition.steps} selected={selected} onSelect={setSelected}
              onAdd={(kind, parent, branch) => { const value = newStep(kind); change({ definition: { ...draft.definition, steps: insertStep(draft.definition.steps, value, parent, branch) } }); setSelected(value.id) }}
              onMove={(id, delta) => change({ definition: { ...draft.definition, steps: moveStep(draft.definition.steps, id, delta) } })}
              onCopy={(id) => change({ definition: { ...draft.definition, steps: copyStep(draft.definition.steps, id) } })}
              onRemove={(id) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, () => undefined) } })}
              onToggle={(id, disabled) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, (value) => ({ ...value, disabled })) } })} />
            <ScreenshotEditor key={draft.editingID} gateway={gateway} sessions={sessions} target={target} onTargetChange={setChosenTarget} step={step} onChange={(id, edit) => { edits.current++; setDraft((value) => value ? { ...value, definition: { ...value.definition, steps: editStep(value.definition.steps, id, edit) } } : value); setDirty(true); setDiagnostics(undefined) }} />
            {!narrow && <aside className={styles['property-panel']}><header className={styles['panel-header']}><strong>{t('desktopWorkflow.properties')}</strong></header>{properties || <p className={styles.hint}>{t('desktopWorkflow.selectStep')}</p>}</aside>}
          </div>
          {parametersOpen && <ParameterDialog value={draft.definition.parameters} onSave={(parameters) => change({ definition: { ...draft.definition, parameters } })} onClose={() => setParametersOpen(false)} />}
          {runDialog && draft.script && <RunDialog gateway={gateway} target={target} onTargetChange={setChosenTarget} script={draft.script} definition={draft.definition} sessions={sessions} profiles={profiles} debug={runDialog.debug} onStarted={started} onClose={() => setRunDialog(undefined)} />}
        </> : <div className={styles['overview-scroll']}><WorkflowOverview scriptCount={data.scripts.length} runs={data.runs} onCreate={create} onRun={showRun} /></div> : null}
        {/* 保留未确认控制请求的标识；隐藏报告只暂停读取，不取消远端执行。 */}
        <RunReport gateway={gateway} id={selectedRun} revision={data.revision} active={view === 'runs'} onView={onViewDesktop} />
      </main>
    </div>
    <Drawer open={narrow && propertiesOpen && !busy} title={t('desktopWorkflow.properties')} onClose={() => setPropertiesOpen(false)} size={340}>{properties}</Drawer>
    <Modal open={!!versions} title={t('desktopWorkflow.history')} footer={null} onCancel={() => setVersions(undefined)}><div className={styles['version-list']}>{versions?.map((version) => <div key={version.number}><strong>v{version.number}</strong><span>{workflowAuthor(version.author, t)} · {new Date(version.created_at).toLocaleString()}</span><Button disabled={busy || version.number === draft?.script?.revision} onClick={() => restore(version.number)}>{t('desktopWorkflow.restore')}</Button></div>)}</div></Modal>
  </div>
}
