import type { Definition, Run, Script, WorkflowGateway } from '#entities/desktop-workflow'
import { isTargetAvailable, type WorkflowTarget } from '../target'
import { wasRequestRejected } from '../messages'
import { workflowFailure, type WorkflowEnvironment, type WorkflowExecutionState, type WorkflowLaunch } from './types'

export class WorkflowExecution {
  private state: WorkflowExecutionState = { report: { busy: false, loading: false } }
  private listeners = new Set<() => void>()
  private pending = new Map<string, string>()
  private request?: AbortController
  private definitionRequest?: { id: string; script: string; version: number }
  private reportID?: string
  private reportActive = false
  private controlling = false
  private launchSerial = 0
  environment: WorkflowEnvironment = { sessions: [], profiles: [] }
  constructor(private readonly gateway: WorkflowGateway, private readonly started: (run: Run) => void) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getSnapshot = () => this.state
  private update(patch: Partial<WorkflowExecutionState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener() }

  open(script: Script, definition: Definition, target: WorkflowTarget, debug: boolean) {
    this.launchSerial++
    this.update({ launch: { script, definition, target, debug, takeover: false, keep: true, busy: false,
      parameters: Object.fromEntries(definition.parameters.map(parameter => [parameter.id, parameter.sensitive ? '' : parameter.default ?? (parameter.type === 'boolean' ? false : parameter.type === 'number' ? 0 : '')])) } })
  }
  close = () => { if (!this.state.launch?.busy) { this.launchSerial++; this.update({ launch: undefined }) } }
  change = (patch: Partial<Pick<WorkflowLaunch, 'takeover' | 'keep' | 'parameters' | 'target'>>) => {
    const launch = this.state.launch
    if (!launch || launch.busy || launch.request) return
    this.update({ launch: { ...launch, ...patch } })
  }
  start = async () => {
    let launch = this.state.launch
    if (!launch || launch.busy) return
    if (!launch.request && !isTargetAvailable(launch.target, this.environment.sessions, this.environment.profiles)) return
    const serial = this.launchSerial
    const { target, script } = launch
    launch = { ...launch, busy: true, error: undefined, request: launch.request ?? {
      script_id: script.id, version: script.revision, parameters: launch.parameters, takeover: launch.takeover,
      keep_connection: launch.keep, debug: launch.debug, request_id: crypto.randomUUID(),
      ...(target.mode === 'session' ? { session_id: target.id, connection_generation: target.connectionGeneration } : { profile_id: target.id }),
    } }
    this.update({ launch })
    try {
      const run = await this.gateway.start(launch.request!)
      if (this.launchSerial !== serial) return
      this.update({ launch: undefined }); this.launchSerial++; this.started(run)
    } catch (reason) {
      if (this.launchSerial === serial) this.update({ launch: { ...launch, busy: false, error: workflowFailure(reason), request: wasRequestRejected(reason) ? undefined : launch.request } })
    }
  }
  selectReport(id: string | undefined, active: boolean) {
    if (this.reportID !== id) {
      this.definitionRequest = undefined
      this.update({ report: { busy: this.controlling, loading: false } })
    }
    this.reportID = id; this.reportActive = active
    void this.refreshReport()
  }
  readonly refreshReport = async (retryDefinition = false) => {
    this.request?.abort()
    const controller = new AbortController(); this.request = controller
    const id = this.reportID
    if (!id || !this.reportActive) {
      this.update({ report: { ...this.state.report, loading: false, ...(!id ? { value: undefined } : {}) } }); return
    }
    this.update({ report: { ...this.state.report, loading: true, error: undefined } })
    try {
      const value = await this.gateway.run(id, controller.signal)
      if (!controller.signal.aborted) {
        this.update({ report: { ...this.state.report, value, error: undefined, loading: false } })
        void this.loadDefinition(value.run, retryDefinition)
      }
    } catch (reason) { if (!controller.signal.aborted) this.update({ report: { ...this.state.report, error: workflowFailure(reason), loading: false } }) }
  }
  private async loadDefinition(run: Run, retry: boolean) {
    const previous = this.definitionRequest
    const status = this.state.report.definition?.status
    if (previous?.id === run.id && previous.script === run.script_id && previous.version === run.version
      && !(retry && (status === 'failed' || status === 'unavailable'))) return
    const request = { id: run.id, script: run.script_id, version: run.version }
    this.definitionRequest = request
    this.update({ report: { ...this.state.report, definition: { runID: run.id, status: 'loading' } } })
    try {
      // 历史详情只读取本次执行的固定版本，不能回退到当前草稿或最新版本。
      const versions = await this.gateway.versions(run.script_id)
      const definition = versions.find(item => item.script_id === run.script_id && item.number === run.version)?.definition
      if (this.definitionRequest === request && this.reportID === run.id) this.update({ report: { ...this.state.report,
        definition: { runID: run.id, status: definition ? 'ready' : 'unavailable', value: definition } } })
    } catch {
      // 流程可能已删除，或者版本请求失败；报告与运行控制仍保持可用，允许手动重试。
      if (this.definitionRequest === request && this.reportID === run.id) this.update({ report: { ...this.state.report, definition: { runID: run.id, status: 'failed' } } })
    }
  }
  control = async (action: 'pause' | 'resume' | 'step' | 'cancel') => {
    const id = this.reportID
    if (!id || this.controlling) return
    const key = `${id}:${action}`
    const requestID = this.pending.get(key) ?? crypto.randomUUID()
    this.pending.set(key, requestID); this.controlling = true
    this.update({ report: { ...this.state.report, busy: true, error: undefined } })
    try {
      await this.gateway.control(id, requestID, action); this.pending.delete(key)
      if (this.reportID === id && this.reportActive) await this.refreshReport()
    } catch (reason) {
      if (wasRequestRejected(reason)) this.pending.delete(key)
      if (this.reportID === id && this.reportActive) this.reportError(reason)
    } finally { this.controlling = false; this.update({ report: { ...this.state.report, busy: false } }) }
  }
  reportError(reason: unknown) { this.update({ report: { ...this.state.report, error: workflowFailure(reason) } }) }
  dispose() { this.request?.abort(); this.definitionRequest = undefined }
}
