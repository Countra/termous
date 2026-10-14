import type { AgentWorkerStartMessage } from './protocol.ts'
import type { RuntimeAuditEvent } from './runtimeEvents.ts'
import type { RuntimeBootstrap } from './runtimeBootstrap.ts'
import type { RuntimeEventInput, RuntimeSteerInput, RuntimeSteerResult } from './runtimeEvents.ts'
import type { RuntimeCheckpointInput, RuntimeCheckpointResult } from './runtimeCheckpoint.ts'

export interface WorkerCoreClientPort {
  readHistoryImage?(start: AgentWorkerStartMessage, runtimeBearer: string, reference: import('./runtimeCheckpoint.ts').RuntimeContextImageReference, signal?: AbortSignal): Promise<{ data: string; mime_type: string }>
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
