import { Alert, App, Button, Drawer, Empty, Input, Modal, Select, Tag } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Definition, Diagnostic, Run, Script, Step, Version, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import { copyStep, editStep, findStep, insertStep, moveStep, newDefinition, newStep } from '../model/steps'
import { useWorkflowData } from '../model/useWorkflowData'
import { isRunActive, workflowError } from '../model/messages'
import { ParameterDialog } from './ParameterDialog'
import { RunDialog } from './RunDialog'
import { RunReport } from './RunReport'
import { ScreenshotEditor } from './ScreenshotEditor'
import { StepProperties } from './StepProperties'
import { StepTree } from './StepTree'
import { WorkflowOrigin } from './WorkflowOrigin'
import { workflowAuthor } from '../model/author'
import styles from './WorkflowWorkspace.module.scss'

export interface WorkflowWorkspaceProps {
  gateway: WorkflowGateway; sessions: RemoteDesktopSession[]; profiles: RemoteDesktopAccessProfile[]
  view: 'scripts' | 'runs'; onViewChange: (view: 'scripts' | 'runs') => void
  onDirtyChange: (dirty: boolean) => void; onViewDesktop: (session: string) => void | Promise<void>
}
interface Draft { editingID: string; script?: Script; name: string; description: string; tags: string[]; definition: Definition }
export function WorkflowWorkspace({ gateway, sessions, profiles, view, onViewChange, onDirtyChange, onViewDesktop }: WorkflowWorkspaceProps) {
  const { t } = useTranslation(); const { modal } = App.useApp()
  const data = useWorkflowData(gateway)
  const [draft, setDraft] = useState<Draft>()
  const [dirty, setDirty] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>()
  const [selectedRun, setSelectedRun] = useState<string>()
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>()
  const [error, setError] = useState<unknown>()
  const [busy, setBusy] = useState(false)
  const [parametersOpen, setParametersOpen] = useState(false)
  const [propertiesOpen, setPropertiesOpen] = useState(false)
  const [versions, setVersions] = useState<Version[]>()
  const [runDialog, setRunDialog] = useState<{ debug: boolean }>()
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
    const observer = new ResizeObserver(([entry]) => setNarrow((entry?.contentRect.width ?? 1200) < 1050))
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
  const create = () => guard(() => { serial.current++; setBusy(false); setDraft({ editingID: crypto.randomUUID(), name: t('desktopWorkflow.newScript'), description: '', tags: [], definition: newDefinition() }); setDirty(true); setSelected(undefined); setDiagnostics(undefined); setError(undefined) })
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
  const started = (run: Run) => { setRunDialog(undefined); setSelectedRun(run.id); onViewChange('runs'); void data.reload() }
  const properties = step && <StepProperties step={step} parameters={draft?.definition.parameters ?? []} onChange={changeStep} />
  const latest = data.scripts.find((item) => item.id === draft?.script?.id)
  const externallyUpdated = !!draft?.script && !!latest && latest.revision > draft.script.revision
  const filtered = data.scripts.filter((item) => `${item.name} ${item.description} ${(item.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return <div ref={root} className={styles.workspace}>
    {view === 'scripts' ? <>
      <aside className={styles.catalog}>
        <div className={styles.toolbar}><Input.Search placeholder={t('desktopWorkflow.search')} value={search} onChange={(e) => setSearch(e.target.value)} /><Button disabled={busy} onClick={create}>{t('desktopWorkflow.create')}</Button></div>
        <div className={styles.scroll}>{filtered.map((item) => <button key={item.id} className={`${styles['catalog-item']} ${draft?.script?.id === item.id ? styles.selected : ''}`} disabled={busy} onClick={() => guard(() => void load(item.id))}><strong className={styles['script-title']}><WorkflowOrigin author={item.creator} />{item.name}</strong><span className={styles.hint}>v{item.revision}{item.tags?.length ? ` · ${item.tags.join(' / ')}` : ''}</span></button>)}</div>
      </aside>
      <main className={styles.editor}>
        {(error ?? data.error) != null && <Alert type="error" title={workflowError(error ?? data.error, t)} closable onClose={() => setError(undefined)} />}
        {externallyUpdated && <Alert type="info" title={t('desktopWorkflow.externalUpdate')} description={t('desktopWorkflow.externalUpdateHint')} action={<Button size="small" disabled={busy} onClick={() => guard(() => void load(draft!.script!.id))}>{t('desktopWorkflow.loadLatest')}</Button>} />}
        {draft ? <>
          <header className={styles['editor-header']}>
            <Input aria-label={t('desktopWorkflow.scriptName')} maxLength={120} value={draft.name} disabled={busy} onChange={(e) => change({ name: e.target.value })} />
            <Tag>{draft.script ? `v${draft.script.revision}` : t('desktopWorkflow.draft')}{dirty ? ' *' : ''}</Tag>
            <Button type="primary" disabled={!dirty || busy || !draft.name.trim()} onClick={() => void save()}>{t('desktopWorkflow.save')}</Button>
            <Button disabled={busy} onClick={() => void validate()}>{t('desktopWorkflow.validate')}</Button>
            <Button disabled={dirty || busy || !draft.script} onClick={() => setRunDialog({ debug: false })}>{t('desktopWorkflow.run')}</Button>
            <Button disabled={dirty || busy || !draft.script} onClick={() => setRunDialog({ debug: true })}>{t('desktopWorkflow.debug')}</Button>
            {narrow && <Button disabled={!step} onClick={() => setPropertiesOpen(true)}>{t('desktopWorkflow.properties')}</Button>}
          </header>
          <div className={styles.metadata}>
            <Input placeholder={t('desktopWorkflow.description')} value={draft.description} maxLength={1000} disabled={busy} onChange={(e) => change({ description: e.target.value })} />
            <Select mode="tags" maxCount={16} value={draft.tags} disabled={busy} placeholder={t('desktopWorkflow.tags')} onChange={(tags) => change({ tags })} />
            <Button size="small" disabled={busy} onClick={() => setParametersOpen(true)}>{t('desktopWorkflow.parameters')}</Button>
            <Button size="small" disabled={!draft.script || busy} onClick={() => void history()}>{t('desktopWorkflow.history')}</Button>
            <Button size="small" disabled={busy} onClick={() => guard(() => { setDraft({ ...structuredClone(draft), editingID: crypto.randomUUID(), script: undefined, name: t('desktopWorkflow.copyName', { name: draft.name }) }); setDirty(true) })}>{t('desktopWorkflow.copy')}</Button>
            <Button size="small" danger disabled={!draft.script || busy} onClick={remove}>{t('desktopWorkflow.delete')}</Button>
          </div>
          {diagnostics && <Alert type={diagnostics.length ? 'warning' : 'success'} title={t(diagnostics.length ? 'desktopWorkflow.validationFailed' : 'desktopWorkflow.validationPassed')} description={diagnostics.length ? diagnostics.map((item, i) => <button key={i} className={styles.diagnostic} onClick={() => setSelected(item.step_id)}>{findStep(draft.definition.steps, item.step_id)?.name || item.field}: {t(`desktopWorkflow.diagnostics.${item.code}`, { defaultValue: item.code })}</button>) : undefined} />}
          <div inert={busy} className={styles['editor-grid']} data-narrow={narrow || undefined}>
            <StepTree steps={draft.definition.steps} selected={selected} onSelect={setSelected}
              onAdd={(kind, parent, branch) => { const value = newStep(kind); change({ definition: { ...draft.definition, steps: insertStep(draft.definition.steps, value, parent, branch) } }); setSelected(value.id) }}
              onMove={(id, delta) => change({ definition: { ...draft.definition, steps: moveStep(draft.definition.steps, id, delta) } })}
              onCopy={(id) => change({ definition: { ...draft.definition, steps: copyStep(draft.definition.steps, id) } })}
              onRemove={(id) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, () => undefined) } })}
              onToggle={(id, disabled) => change({ definition: { ...draft.definition, steps: editStep(draft.definition.steps, id, (value) => ({ ...value, disabled })) } })} />
            <ScreenshotEditor key={draft.editingID} gateway={gateway} sessions={sessions} step={step} onChange={(id, edit) => { edits.current++; setDraft((value) => value ? { ...value, definition: { ...value.definition, steps: editStep(value.definition.steps, id, edit) } } : value); setDirty(true); setDiagnostics(undefined) }} />
            {!narrow && <aside className={styles['property-panel']}><header className={styles['panel-header']}><strong>{t('desktopWorkflow.properties')}</strong></header>{properties || <p className={styles.hint}>{t('desktopWorkflow.selectStep')}</p>}</aside>}
          </div>
          {parametersOpen && <ParameterDialog value={draft.definition.parameters} onSave={(parameters) => change({ definition: { ...draft.definition, parameters } })} onClose={() => setParametersOpen(false)} />}
          {runDialog && draft.script && <RunDialog gateway={gateway} script={draft.script} definition={draft.definition} sessions={sessions} profiles={profiles} debug={runDialog.debug} onStarted={started} onClose={() => setRunDialog(undefined)} />}
        </> : <Empty description={t('desktopWorkflow.createHint')}><Button type="primary" onClick={create}>{t('desktopWorkflow.create')}</Button></Empty>}
      </main>
    </> : <>
      <aside className={styles.catalog}><header className={styles['panel-header']}><strong>{t('desktopWorkflow.runs')}</strong><Button size="small" onClick={() => void data.reload()}>{t('desktopWorkflow.refresh')}</Button></header><div className={styles.scroll}>{data.runs.map((run) => <button key={run.id} className={`${styles['catalog-item']} ${selectedRun === run.id ? styles.selected : ''}`} onClick={() => setSelectedRun(run.id)}><strong>{run.name}</strong><span><Tag color={isRunActive(run.state) ? 'processing' : undefined}>{t(`desktopWorkflow.states.${run.state}`)}</Tag></span><span className={styles.hint}>{new Date(run.started_at).toLocaleString()}</span></button>)}</div></aside>
      <RunReport gateway={gateway} id={selectedRun} revision={data.revision} onView={onViewDesktop} />
    </>}
    <Drawer open={narrow && propertiesOpen && !busy} title={t('desktopWorkflow.properties')} onClose={() => setPropertiesOpen(false)} size={340}>{properties}</Drawer>
    <Modal open={!!versions} title={t('desktopWorkflow.history')} footer={null} onCancel={() => setVersions(undefined)}><div className={styles['version-list']}>{versions?.map((version) => <div key={version.number}><strong>v{version.number}</strong><span>{workflowAuthor(version.author, t)} · {new Date(version.created_at).toLocaleString()}</span><Button disabled={busy || version.number === draft?.script?.revision} onClick={() => restore(version.number)}>{t('desktopWorkflow.restore')}</Button></div>)}</div></Modal>
  </div>
}
