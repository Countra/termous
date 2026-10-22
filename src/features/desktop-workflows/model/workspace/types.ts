import type { Definition, Diagnostic, Run, Script, StartInput, StepResult, Version, WorkflowGateway } from '#entities/desktop-workflow'
import type { RemoteDesktopAccessProfile, RemoteDesktopSession } from '#entities/remote-desktop'
import type { WorkflowTarget } from '../target'
import type { AIRuntimeStatus } from '#entities/ai-runtime'

export interface WorkflowDraft { editingID: string; script?: Script; name: string; description: string; tags: string[]; definition: Definition }
export interface WorkflowFailure { message: string; code?: string; status?: number }
export type WorkflowNotice = { id: string } & (
  | { kind: 'error'; error: WorkflowFailure }
  | { kind: 'validation'; editor: string; diagnostics: Diagnostic[] }
)
export interface WorkflowReportExpansion { runID: string; allExpanded: boolean; exceptions: string[] }
export interface WorkflowPresentation {
  catalogCollapsed?: boolean
  propertiesVisible: boolean
  foldedSteps?: string[]
  queries: { scripts: string; runs: string }
  runFilter: 'all' | 'active'
  reportExpansion?: WorkflowReportExpansion
}
export type WorkflowSession = Pick<RemoteDesktopSession, 'id' | 'profile_name' | 'protocol' | 'connection_generation' | 'status'>
export type WorkflowProfile = Pick<RemoteDesktopAccessProfile, 'id' | 'name' | 'protocol'>
export type WorkflowMediaGateway = Pick<WorkflowGateway, 'openPreview' | 'closePreview' | 'capture' | 'match' | 'upload' | 'asset' | 'analyze' | 'analysisImage' | 'deleteAnalysis'> & {
  runtimeStatus?: () => Promise<Pick<AIRuntimeStatus, 'service'>>
  openRuntimeSettings?: () => Promise<void>
}
export interface WorkflowLaunch {
  script: Script; definition: Definition; target: WorkflowTarget; debug: boolean
  takeover: boolean; keep: boolean; parameters: StartInput['parameters']
  busy: boolean; request?: StartInput; error?: WorkflowFailure
}
export interface WorkflowReport {
  value?: { run: Run; steps: StepResult[] }; error?: WorkflowFailure; busy: boolean; loading: boolean
  definition?: { runID: string; status: 'loading' | 'ready' | 'unavailable' | 'failed'; value?: Definition }
}
export interface WorkflowExecutionState { launch?: WorkflowLaunch; report: WorkflowReport }
export interface WorkflowState {
  draft?: WorkflowDraft; dirty: boolean; view: 'scripts' | 'runs'; selected?: string; selectedRun?: string
  notice?: WorkflowNotice; busy: boolean; versions?: Version[]; chosenTarget?: WorkflowTarget
  presentation: WorkflowPresentation
}
export interface WorkflowEnvironment { sessions: WorkflowSession[]; profiles: WorkflowProfile[]; activeSessionId?: string }
export interface WorkflowActions {
  create: (name: string) => void
  load: (id: string) => Promise<void>
  change: (patch: Partial<Pick<WorkflowDraft, 'name' | 'description' | 'tags' | 'definition'>>) => void
  selectStep: (id?: string) => void
  target: (target: WorkflowTarget) => void
  view: (view: 'scripts' | 'runs') => void
  showRun: (id: string) => void
  save: () => Promise<void>
  validate: () => Promise<void>
  history: () => Promise<void>
  closeHistory: () => void
  restore: (version: number) => Promise<void>
  remove: () => Promise<void>
  copy: (name: string) => void
  openRun: (debug: boolean) => void
  closeRun: () => void
  changeRun: (patch: Partial<Pick<WorkflowLaunch, 'takeover' | 'keep' | 'parameters'>>) => void
  start: () => Promise<void>
  control: (action: 'pause' | 'resume' | 'step' | 'cancel') => Promise<void>
  refresh: () => void
  refreshReport: () => Promise<void>
  viewDesktop: (session: string) => Promise<void>
  dismissNotice: (id: string) => void
  presentation: (patch: Partial<WorkflowPresentation>) => void
}
export interface WorkflowSurfaceModel {
  state: WorkflowState; execution: WorkflowExecutionState; environment: WorkflowEnvironment
  scripts: Script[]; runs: Run[]; loading: boolean; dataError?: WorkflowFailure
  target: WorkflowTarget; actions: WorkflowActions
}

export function workflowFailure(error: unknown): WorkflowFailure {
  return { message: error instanceof Error ? error.message : 'Request failed',
    ...(error && typeof error === 'object' && 'code' in error ? { code: String(error.code) } : {}),
    ...(error && typeof error === 'object' && 'status' in error ? { status: Number(error.status) } : {}) }
}
