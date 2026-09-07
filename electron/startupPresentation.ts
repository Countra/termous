import type { CoreStartupFailure, CoreStartupSnapshot } from '#common/contracts'

export type StartupPresentationPhase =
  | 'core'
  | 'checking'
  | 'database-running'
  | 'database-completed'
  | 'workspace'
  | 'error'

export interface StartupPresentationView {
  attemptId: string
  sequence: number
  presentationId: number
  phase: StartupPresentationPhase
  database: CoreStartupSnapshot['database']
  failure: CoreStartupSnapshot['failure']
  attention: CoreStartupSnapshot['attention']
  windowVisible: boolean
  coreVersion?: string
  canComplete: boolean
}

export interface StartupWindowState {
  view: StartupPresentationView
  theme: 'light' | 'dark'
  locale: string
}

export interface StartupPresentationAcknowledgement {
  attemptId: string
  presentationId: number
}

export interface StartupWindowBridge {
  status: () => Promise<StartupWindowState>
  onChanged: (callback: (state: StartupWindowState) => void) => () => void
  presented: (acknowledgement: StartupPresentationAcknowledgement) => void
  copyDiagnostics: () => Promise<void>
  openLogs: () => Promise<void>
  exit: () => Promise<void>
}

interface StartupPresentationOptions {
  onChange: (view: StartupPresentationView) => void
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => unknown
  clearTimer?: (handle: unknown) => void
}

const windowMinimumMs = 650
const databaseRunningMinimumMs = 600
const databaseCompletedMinimumMs = 500

export class StartupPresentation {
  private readonly options: StartupPresentationOptions
  private readonly now: () => number
  private readonly setTimer: (callback: () => void, delayMs: number) => unknown
  private readonly clearTimer: (handle: unknown) => void
  private snapshot: CoreStartupSnapshot | null = null
  private rendererFailure: CoreStartupFailure | null = null
  private visible = false
  private visibleAt: number | null = null
  private workspaceReady = false
  private presentationSkipped = false
  private runningPresentedAt: number | null = null
  private completedPresentedAt: number | null = null
  private timer: unknown = null
  private disposed = false
  private view: StartupPresentationView = {
    attemptId: '',
    sequence: 0,
    presentationId: 0,
    phase: 'core',
    database: null,
    failure: null,
    attention: null,
    windowVisible: false,
    canComplete: false,
  }

  constructor(options: StartupPresentationOptions) {
    this.options = options
    this.now = options.now ?? Date.now
    this.setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  getView(): StartupPresentationView {
    return this.view
  }

  update(snapshot: CoreStartupSnapshot): void {
    if (this.disposed || (this.snapshot && snapshot.revision <= this.snapshot.revision)) return

    if (snapshot.attemptId !== this.snapshot?.attemptId) {
      this.presentationSkipped = false
      this.rendererFailure = null
      this.runningPresentedAt = null
      this.completedPresentedAt = null
      this.visibleAt = this.visible ? this.now() : null
      this.workspaceReady = false
    }
    this.snapshot = snapshot
    this.refresh()
  }

  setFailure(failure: CoreStartupFailure | null): void {
    if (this.disposed || failure === null || this.rendererFailure === failure) return
    this.rendererFailure = failure
    this.refresh()
  }

  setWorkspaceReady(ready: boolean): void {
    if (this.disposed || this.workspaceReady === ready) return
    this.workspaceReady = ready
    this.refresh()
  }

  setWindowVisible(visible: boolean): void {
    if (this.disposed || this.visible === visible) return
    this.visible = visible
    if (visible && this.visibleAt === null) this.visibleAt = this.now()
    this.refresh()
  }

  skipPresentation(): void {
    if (this.disposed || this.presentationSkipped) return
    this.presentationSkipped = true
    this.refresh()
  }

  presented(acknowledgement: StartupPresentationAcknowledgement): void {
    if (this.disposed || !this.visible
      || acknowledgement.attemptId !== this.view.attemptId
      || acknowledgement.presentationId !== this.view.presentationId) return

    if (this.view.phase === 'database-running' && this.runningPresentedAt === null) {
      this.runningPresentedAt = this.now()
    } else if (this.view.phase === 'database-completed' && this.completedPresentedAt === null) {
      this.completedPresentedAt = this.now()
    } else return
    this.refresh()
  }

  dispose(): void {
    this.disposed = true
    this.cancelTimer()
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.clearTimer(this.timer)
    this.timer = null
  }

  private refresh(): void {
    this.cancelTimer()
    const snapshot = this.snapshot
    const now = this.now()
    let phase: StartupPresentationPhase = 'core'
    let deadline: number | null = null

    if (snapshot?.phase === 'failed' || snapshot?.failure || this.rendererFailure) {
      phase = 'error'
    } else if (snapshot) {
      const database = snapshot.database
      if (database?.operation && (database.status === 'running' || database.status === 'completed')) {
        if (this.runningPresentedAt === null || now < this.runningPresentedAt + databaseRunningMinimumMs) {
          phase = 'database-running'
          if (this.runningPresentedAt !== null) deadline = this.runningPresentedAt + databaseRunningMinimumMs
        } else if (database.status === 'running') {
          phase = 'database-running'
        } else if (this.completedPresentedAt === null || now < this.completedPresentedAt + databaseCompletedMinimumMs) {
          phase = 'database-completed'
          if (this.completedPresentedAt !== null) deadline = this.completedPresentedAt + databaseCompletedMinimumMs
        } else {
          phase = 'workspace'
        }
      } else if (snapshot.phase === 'services' || snapshot.phase === 'ready' || snapshot.phase === 'external') {
        phase = 'workspace'
      } else if (snapshot.phase === 'database') {
        phase = 'checking'
      }
    }

    // 最短停留以真正可见的阶段为起点，不延迟数据库事务或重复累计启动时长。
    const coreReady = snapshot?.phase === 'ready' || snapshot?.phase === 'external'
    const presentationReady = phase !== 'database-running' && phase !== 'database-completed' && phase !== 'error'
    const windowDeadline = this.visibleAt === null ? null : this.visibleAt + windowMinimumMs
    const canComplete = Boolean(coreReady && this.workspaceReady && phase !== 'error'
      && (this.presentationSkipped || (this.visible && presentationReady
        && windowDeadline !== null && now >= windowDeadline)))
    if (coreReady && this.workspaceReady && presentationReady && windowDeadline !== null && now < windowDeadline) {
      deadline = deadline === null ? windowDeadline : Math.min(deadline, windowDeadline)
    }

    const stageChanged = this.view.phase !== phase || this.view.attemptId !== (snapshot?.attemptId ?? '')
    this.view = {
      attemptId: snapshot?.attemptId ?? '',
      sequence: this.view.sequence + 1,
      presentationId: this.view.presentationId + (stageChanged ? 1 : 0),
      phase,
      database: snapshot?.database ?? null,
      failure: snapshot?.failure ?? this.rendererFailure,
      attention: snapshot?.attention ?? null,
      windowVisible: this.visible,
      ...(snapshot?.coreVersion ? { coreVersion: snapshot.coreVersion } : {}),
      canComplete,
    }
    if (deadline !== null && deadline > now) {
      this.timer = this.setTimer(() => {
        this.timer = null
        if (!this.disposed) this.refresh()
      }, deadline - now)
    }
    this.options.onChange(this.view)
  }
}
