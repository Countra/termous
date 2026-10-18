import type { WorkflowGateway } from '#entities/desktop-workflow'
import { newDefinition } from '../steps'
import { sessionTarget } from '../target'
import { WorkflowExecution } from './WorkflowExecution'
import { workflowFailure, type WorkflowActions, type WorkflowEnvironment, type WorkflowState, type WorkflowSurfaceModel } from './types'
import type { WorkflowMediaGateway } from './types'

export class WorkflowController {
  private state: WorkflowState = { dirty: false, view: 'scripts', busy: false,
    presentation: { propertiesVisible: true, queries: { scripts: '', runs: '' }, runFilter: 'all' } }
  private data: Pick<WorkflowSurfaceModel, 'scripts' | 'runs' | 'loading' | 'dataError'> = { scripts: [], runs: [], loading: true }
  private environment: WorkflowEnvironment = { sessions: [], profiles: [] }
  private listeners = new Set<() => void>()
  private snapshot: WorkflowSurfaceModel
  private serial = 0
  private edits = 0
  private mediaTasks = new Set<Promise<unknown>>()
  readonly execution: WorkflowExecution
  reload = () => {}
  onViewDesktop: (id: string) => void | Promise<void> = () => {}

  constructor(private readonly gateway: WorkflowGateway) {
    this.execution = new WorkflowExecution(gateway, run => { this.update({ selectedRun: run.id, view: 'runs' }); this.reload() })
    this.execution.subscribe(() => this.publish())
    this.snapshot = this.project()
  }
  readonly media: WorkflowMediaGateway = {
    openPreview: (...args) => this.gateway.openPreview(...args), closePreview: id => this.gateway.closePreview(id),
    capture: (...args) => this.gateway.capture(...args), match: (...args) => this.gateway.match(...args), asset: (...args) => this.gateway.asset(...args),
    upload: blob => {
      const task = this.gateway.upload(blob); this.trackMediaTask(task)
      return task
    },
  }
  readonly trackMediaTask = (task: Promise<unknown>) => {
    this.mediaTasks.add(task)
    void task.then(() => this.mediaTasks.delete(task), () => this.mediaTasks.delete(task))
  }
  async settleMedia() { while (this.mediaTasks.size) await Promise.allSettled([...this.mediaTasks]) }
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getSnapshot = () => this.snapshot
  private project(): WorkflowSurfaceModel {
    return { state: this.state, ...this.data, environment: this.environment, execution: this.execution.getSnapshot(),
      target: this.state.chosenTarget ?? sessionTarget(this.environment.sessions, this.environment.activeSessionId), actions: this.actions }
  }
  private publish() { this.snapshot = this.project(); for (const listener of this.listeners) listener() }
  private update(patch: Partial<WorkflowState>) { this.state = { ...this.state, ...patch }; this.publish() }
  configure(environment: WorkflowEnvironment, data: typeof this.data) {
    this.environment = environment; this.execution.environment = environment; this.data = data; this.publish()
  }
  private async work(action: () => Promise<void>) {
    if (this.state.busy) return
    this.update({ busy: true })
    try { await action() } catch (reason) { this.update({ notice: { id: crypto.randomUUID(), kind: 'error', error: workflowFailure(reason) } }) }
    finally { this.update({ busy: false }) }
  }
  readonly actions: WorkflowActions = {
    create: name => {
      if (this.state.busy) return
      this.serial++
      this.update({ view: 'scripts', draft: { editingID: crypto.randomUUID(), name, description: '', tags: [], definition: newDefinition() },
        dirty: true, selected: undefined, presentation: { ...this.state.presentation, foldedSteps: [] } })
    },
    load: async id => {
      if (this.state.busy) return
      const serial = ++this.serial
      await this.work(async () => {
        const value = await this.gateway.get(id)
        if (serial === this.serial) this.update({ view: 'scripts', draft: { editingID: crypto.randomUUID(), script: value.script, name: value.script.name,
          description: value.script.description, tags: value.script.tags ?? [], definition: value.version.definition }, dirty: false, selected: undefined,
          presentation: { ...this.state.presentation, foldedSteps: [] } })
      })
    },
    change: patch => {
      if (!this.state.draft) return
      this.edits++; this.update({ draft: { ...this.state.draft, ...patch }, dirty: true })
    },
    selectStep: selected => this.update({ selected }),
    target: target => { this.update({ chosenTarget: target }); this.execution.change({ target }) },
    view: view => this.update({ view }),
    showRun: selectedRun => this.update({ selectedRun, view: 'runs' }),
    save: async () => {
      const draft = this.state.draft
      if (!draft) return
      const edits = this.edits
      await this.work(async () => {
        const script = await this.gateway.save(draft.script?.id, { expected_revision: draft.script?.revision ?? 0,
          name: draft.name, description: draft.description, tags: draft.tags, definition: draft.definition })
        // 保存期间模板上传仍可能完成，只更新版本信息，保留之后的草稿修改。
        if (this.state.draft?.editingID === draft.editingID) this.update({ draft: { ...this.state.draft, script }, dirty: this.edits !== edits })
        this.reload()
      })
    },
    validate: async () => {
      const draft = this.state.draft
      if (draft) await this.work(async () => {
        const diagnostics = await this.gateway.validate(draft.definition)
        this.update({ notice: { id: crypto.randomUUID(), kind: 'validation', editor: draft.editingID, diagnostics } })
      })
    },
    history: async () => { if (this.state.draft?.script) await this.work(async () => this.update({ versions: await this.gateway.versions(this.state.draft!.script!.id) })) },
    closeHistory: () => this.update({ versions: undefined }),
    restore: async number => {
      const script = this.state.draft?.script
      if (!script) return
      let restored = false
      await this.work(async () => { await this.gateway.restore(script.id, number, script.revision); this.update({ versions: undefined }); this.reload(); restored = true })
      if (restored) await this.actions.load(script.id)
    },
    remove: async () => {
      const script = this.state.draft?.script
      if (!script) return
      if (this.state.busy) return
      this.update({ busy: true })
      try { await this.gateway.remove(script.id, script.revision); this.update({ draft: undefined, dirty: false }); this.reload() }
      catch (reason) { this.update({ notice: { id: crypto.randomUUID(), kind: 'error', error: workflowFailure(reason) } }); throw reason }
      finally { this.update({ busy: false }) }
    },
    copy: name => {
      if (this.state.draft && !this.state.busy) this.update({ draft: { ...structuredClone(this.state.draft), editingID: crypto.randomUUID(), script: undefined, name }, dirty: true })
    },
    openRun: debug => {
      const draft = this.state.draft
      if (!draft?.script || this.state.dirty || this.state.busy || this.execution.getSnapshot().launch) return
      const target = this.snapshot.target
      this.update({ chosenTarget: target }); this.execution.open(draft.script, draft.definition, target, debug)
    },
    closeRun: () => this.execution.close(),
    changeRun: patch => this.execution.change(patch),
    start: () => this.execution.start(),
    control: action => this.execution.control(action),
    refresh: () => this.reload(),
    refreshReport: () => this.execution.refreshReport(true),
    viewDesktop: async id => { try { await this.onViewDesktop(id) } catch (reason) { this.execution.reportError(reason) } },
    dismissNotice: id => { if (this.state.notice?.id === id) this.update({ notice: undefined }) },
    presentation: patch => this.update({ presentation: { ...this.state.presentation, ...patch } }),
  }
  dispose() { this.serial++; this.execution.dispose() }
}
