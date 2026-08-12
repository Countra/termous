import type {
  CommandDispatchTask,
  CommandDispatchTaskInput,
} from '#entities/command-dispatch'

export interface CommandDispatchRequestOptions {
  signal?: AbortSignal
}

export interface CommandDispatchLatestRequestOptions extends CommandDispatchRequestOptions {
  fresh?: boolean
}

export interface CommandDispatchGateway {
  createTask(
    input: CommandDispatchTaskInput,
    options?: CommandDispatchRequestOptions,
  ): Promise<CommandDispatchTask>
  latestTask(options?: CommandDispatchLatestRequestOptions): Promise<CommandDispatchTask | null>
  task(taskId: string, options?: CommandDispatchRequestOptions): Promise<CommandDispatchTask>
  interruptTask(
    taskId: string,
    options?: CommandDispatchRequestOptions,
  ): Promise<CommandDispatchTask>
  interruptTarget(
    taskId: string,
    sessionId: string,
    options?: CommandDispatchRequestOptions,
  ): Promise<CommandDispatchTask>
  taskEventsUrl(taskId: string): string
  targetOutputUrl(taskId: string, sessionId: string, cursor?: {
    streamEpoch: string
    lastOffset: string
  }): string
}
