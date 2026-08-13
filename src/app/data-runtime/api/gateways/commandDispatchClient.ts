import type { AppConfig } from '#common/contracts'
import type {
  CommandDispatchTask,
  CommandDispatchTaskInput,
} from '#entities/command-dispatch'
import { decodeCommandDispatchTask } from '#features/command-dispatch'
import { TermousApiError, TermousApiTransport } from '#shared/api'

interface RequestOptions {
  signal?: AbortSignal
}

interface LatestRequestOptions extends RequestOptions {
  fresh?: boolean
}

const commandDispatchTasksPath = '/api/v1/command-dispatch-tasks'

export class CommandDispatchClient extends TermousApiTransport {
  private latestTaskInFlight: Promise<CommandDispatchTask | null> | null = null

  constructor(config: Partial<AppConfig> = {}) {
    super(config)
  }

  createTask(input: CommandDispatchTaskInput, options: RequestOptions = {}) {
    return this.request<unknown>(commandDispatchTasksPath, {
      method: 'POST',
      body: {
        client_request_id: input.client_request_id,
        scope: input.scope,
        command: input.command,
        target_session_ids: [...input.target_session_ids],
      },
      signal: options.signal,
      timeoutMs: 20_000,
    }).then(decodeCommandDispatchTask)
  }

  latestTask(options: LatestRequestOptions = {}) {
    if (options.fresh) {
      return waitForCommandDispatchRequest(this.fetchLatestTask(), options.signal)
    }
    if (!this.latestTaskInFlight) {
      const request = this.fetchLatestTask()
      this.latestTaskInFlight = request
      void request.then(
        () => this.clearLatestTaskRequest(request),
        () => this.clearLatestTaskRequest(request),
      )
    }
    return waitForCommandDispatchRequest(this.latestTaskInFlight, options.signal)
  }

  private async fetchLatestTask() {
    try {
      const value = await this.request<unknown | undefined>(`${commandDispatchTasksPath}/latest`)
      if (value === undefined) return null
      return decodeCommandDispatchTask(value)
    } catch (error) {
      // 兼容尚未升级到 204 空响应的旧 Core。
      if (error instanceof TermousApiError && error.status === 404) {
        return null
      }
      throw error
    }
  }

  private clearLatestTaskRequest(request: Promise<CommandDispatchTask | null>) {
    if (this.latestTaskInFlight === request) {
      this.latestTaskInFlight = null
    }
  }

  task(taskId: string, options: RequestOptions = {}) {
    return this.request<unknown>(`${commandDispatchTasksPath}/${encodeURIComponent(taskId)}`, {
      signal: options.signal,
    }).then(decodeCommandDispatchTask)
  }

  interruptTask(taskId: string, options: RequestOptions = {}) {
    return this.request<unknown>(
      `${commandDispatchTasksPath}/${encodeURIComponent(taskId)}/interrupt`,
      { method: 'POST', signal: options.signal },
    ).then(decodeCommandDispatchTask)
  }

  interruptTarget(taskId: string, sessionId: string, options: RequestOptions = {}) {
    return this.request<unknown>(
      `${commandDispatchTasksPath}/${encodeURIComponent(taskId)}/targets/${encodeURIComponent(sessionId)}/interrupt`,
      { method: 'POST', signal: options.signal },
    ).then(decodeCommandDispatchTask)
  }

  taskEventsUrl(taskId: string) {
    return this.websocketUrl(
      `${commandDispatchTasksPath}/${encodeURIComponent(taskId)}/events`,
    )
  }

  latestTasksEventsUrl() {
    return this.websocketUrl(`${commandDispatchTasksPath}/events`)
  }

  targetOutputUrl(
    taskId: string,
    sessionId: string,
    cursor?: { streamEpoch: string; lastOffset: string },
  ) {
    const url = new URL(this.websocketUrl(
      `${commandDispatchTasksPath}/${encodeURIComponent(taskId)}/targets/${encodeURIComponent(sessionId)}/output`,
    ))
    if (cursor) {
      url.searchParams.set('stream_epoch', cursor.streamEpoch)
      url.searchParams.set('last_offset', cursor.lastOffset)
    }
    return url.toString()
  }
}

function waitForCommandDispatchRequest<T>(request: Promise<T>, signal?: AbortSignal) {
  if (!signal) return request
  if (signal.aborted) {
    return Promise.reject(commandDispatchAbortError())
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(commandDispatchAbortError())
    signal.addEventListener('abort', abort, { once: true })
    void request.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', abort)
    })
  })
}

function commandDispatchAbortError() {
  return new TermousApiError('请求已取消', 'REQUEST_ABORTED', 0)
}
