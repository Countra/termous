import type { AgentWorkerStartMessage } from './protocol.ts'
import type { RuntimeAuditEvent } from './runtimeEvents.ts'
import type { RuntimeBootstrap } from './runtimeBootstrap.ts'
import type { RuntimeEventInput, RuntimeSteerInput, RuntimeSteerResult } from './runtimeEvents.ts'
import type { RuntimeCheckpointInput, RuntimeCheckpointResult } from './runtimeCheckpoint.ts'

export interface WorkerCoreClientPort {
  callLocalTool?(start: AgentWorkerStartMessage, runtimeBearer: string, input: import('./localTools.ts').LocalToolCall, signal?: AbortSignal): Promise<unknown>
  readDesktopTasks?(start: AgentWorkerStartMessage, runtimeBearer: string, cursor: string, waitMS: number, signal?: AbortSignal): Promise<import('./desktopTasks.ts').DesktopTaskSnapshot>
  readToolPreparation?(start: AgentWorkerStartMessage, runtimeBearer: string, toolCallID: string, step: string, signal?: AbortSignal): Promise<import('./toolPreparation.ts').PreparedCall | undefined>
  readResourceText?(start: AgentWorkerStartMessage, runtimeBearer: string, reference: import('#common/contracts').TextResourceReference, signal?: AbortSignal): Promise<string>
  readResourceImage?(start: AgentWorkerStartMessage, runtimeBearer: string, reference: import('#common/contracts').ImageResourceReference, signal?: AbortSignal): Promise<string>
  readHistoryImage?(start: AgentWorkerStartMessage, runtimeBearer: string, reference: import('./runtimeCheckpoint.ts').RuntimeContextImageReference, signal?: AbortSignal): Promise<RuntimeHistoryImage>
  appendAuditEvents(start: AgentWorkerStartMessage, runtimeBearer: string, events: RuntimeAuditEvent[], signal: AbortSignal): Promise<void>
  bootstrap(start: AgentWorkerStartMessage, signal?: AbortSignal): Promise<RuntimeBootstrap>
  appendEvents(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    events: RuntimeEventInput[],
  ): Promise<number>
  appendSteer(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeSteerInput,
  ): Promise<RuntimeSteerResult>
  commitCheckpoint(
    start: AgentWorkerStartMessage,
    runtimeBearer: string,
    input: RuntimeCheckpointInput,
    signal?: AbortSignal,
  ): Promise<RuntimeCheckpointResult>
}

export type RuntimeHistoryImage = { data: string; mime_type: string; resource?: never } | { resource: import('#common/contracts').ImageResourceReference; mime_type: string; data?: never }

export class WorkerCoreError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, status = 0) {
    super(code)
    this.name = 'WorkerCoreError'
    this.code = code
    this.status = status
  }
}
