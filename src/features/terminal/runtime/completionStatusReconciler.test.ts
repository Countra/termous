import assert from 'node:assert/strict'
import test from 'node:test'
import type { CompletionStatus } from '#entities/session'
import type { TerminalGateway } from '../api/terminalGateway'
import { TerminalCompletionRuntime } from '../model/terminalCompletionRuntime.ts'
import { TerminalCompletionStatusReconciler } from './completionStatusReconciler.ts'

const sessionId = 'session-1'
const promptBoundary = {
  source_generation: 2,
  shell_id: 'shell-1',
  prompt_generation: 3,
  shell: 'bash',
  cwd: '/srv/app',
  input_epoch: 4,
}

function completionStatus(
  promptStatus: CompletionStatus['prompt_observation']['status'],
  retryable = false,
): CompletionStatus {
  return {
    status: 'building',
    index_generation: 1,
    source_generation: 1,
    prompt_observation: {
      status: promptStatus,
      retryable: retryable || undefined,
    },
    provider_states: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}

class ManualScheduler {
  private nextId = 1
  private readonly tasks = new Map<number, { callback: () => void; delay: number }>()

  readonly schedule = (callback: () => void, delay: number) => {
    const id = this.nextId
    this.nextId += 1
    this.tasks.set(id, { callback, delay })
    return id
  }

  readonly clear = (id: number) => {
    this.tasks.delete(id)
  }

  get size() {
    return this.tasks.size
  }

  runNext() {
    const next = this.tasks.entries().next().value
    if (!next) {
      throw new Error('没有待执行的补全状态定时任务')
    }
    const [id, task] = next
    this.tasks.delete(id)
    task.callback()
    return task.delay
  }
}

interface HarnessOptions {
  refreshStatus?: Pick<TerminalGateway, 'refreshSessionCompletions'>['refreshSessionCompletions']
  sessionStatus?: Pick<TerminalGateway, 'sessionCompletionStatus'>['sessionCompletionStatus']
}

function createHarness(options: HarnessOptions = {}) {
  const completionRuntime = new TerminalCompletionRuntime()
  const scheduler = new ManualScheduler()
  const entry = {
    disposed: false,
    transport: { isLive: () => true },
  }
  const session = {
    kind: 'ssh' as const,
    status: 'connected' as const,
  }
  const api: Pick<
    TerminalGateway,
    'refreshSessionCompletions' | 'sessionCompletionStatus'
  > = {
    refreshSessionCompletions: options.refreshStatus ?? (async () => completionStatus('ready')),
    sessionCompletionStatus: options.sessionStatus ?? (async () => completionStatus('ready')),
  }
  const controller = new TerminalCompletionStatusReconciler({
    completionRuntime,
    getApi: () => api,
    getEntry: (targetSessionId) => targetSessionId === sessionId ? entry : undefined,
    getSession: (targetSessionId) => targetSessionId === sessionId ? session : undefined,
    schedule: scheduler.schedule,
    clearScheduled: scheduler.clear,
  })
  return {
    completionRuntime,
    controller,
    scheduler,
  }
}

test('补全状态对账保持既定退避序列并在耗尽后标记不可用', async () => {
  let requests = 0
  const harness = createHarness({
    sessionStatus: async () => {
      requests += 1
      return completionStatus('waiting')
    },
  })

  harness.controller.start(sessionId)
  await flushAsyncWork()
  const delays: number[] = []
  while (harness.scheduler.size > 0) {
    delays.push(harness.scheduler.runNext())
    await flushAsyncWork()
  }

  assert.equal(requests, 7)
  assert.deepEqual(delays, [1_000, 2_000, 4_000, 8_000, 16_000, 18_000])
  assert.equal(harness.completionRuntime.getSnapshot(sessionId).readiness, 'unavailable')
  assert.deepEqual(harness.completionRuntime.getSnapshot(sessionId).promptObservation, {
    status: 'degraded',
    error_code: 'COMPLETION_UNAVAILABLE',
    retryable: true,
  })
})

test('停止对账会中止在途请求并清除尚未执行的重试', async () => {
  const inFlight = deferred<CompletionStatus>()
  let requestSignal: AbortSignal | undefined
  const inFlightHarness = createHarness({
    sessionStatus: (_targetSessionId, options) => {
      requestSignal = options?.signal
      return inFlight.promise
    },
  })

  inFlightHarness.controller.start(sessionId)
  assert.equal(requestSignal?.aborted, false)
  inFlightHarness.controller.stop(sessionId)
  assert.equal(requestSignal?.aborted, true)
  inFlight.resolve(completionStatus('ready'))
  await flushAsyncWork()
  assert.equal(
    inFlightHarness.completionRuntime.getSnapshot(sessionId).promptObservation.status,
    'waiting',
  )

  const scheduledHarness = createHarness({
    sessionStatus: async () => completionStatus('waiting'),
  })
  scheduledHarness.controller.start(sessionId)
  await flushAsyncWork()
  assert.equal(scheduledHarness.scheduler.size, 1)
  scheduledHarness.controller.stopAll()
  assert.equal(scheduledHarness.scheduler.size, 0)
})

test('手动刷新对同一会话去重并在等待状态后继续自动对账', async () => {
  const refresh = deferred<CompletionStatus>()
  let refreshRequests = 0
  let statusRequests = 0
  const harness = createHarness({
    refreshStatus: () => {
      refreshRequests += 1
      return refresh.promise
    },
    sessionStatus: async () => {
      statusRequests += 1
      return completionStatus('ready')
    },
  })
  assert.equal(harness.completionRuntime.markPromptObservationUnavailable(sessionId), true)

  const first = harness.controller.retry(sessionId)
  const duplicate = harness.controller.retry(sessionId)
  assert.strictEqual(duplicate, first)
  assert.equal(refreshRequests, 1)

  refresh.resolve(completionStatus('waiting'))
  assert.equal(await first, 'succeeded')
  await flushAsyncWork()
  assert.equal(statusRequests, 1)
  assert.equal(
    harness.completionRuntime.getSnapshot(sessionId).promptObservation.status,
    'ready',
  )
})

test('手动刷新稳定区分失败、取消和已由提示符恢复的成功', async () => {
  const failedHarness = createHarness({
    refreshStatus: async () => {
      throw new Error('refresh failed')
    },
  })
  failedHarness.completionRuntime.markPromptObservationUnavailable(sessionId)
  assert.equal(await failedHarness.controller.retry(sessionId), 'failed')

  const cancelledRefresh = deferred<CompletionStatus>()
  let cancelledSignal: AbortSignal | undefined
  const cancelledHarness = createHarness({
    refreshStatus: (_targetSessionId, options) => {
      cancelledSignal = options?.signal
      return cancelledRefresh.promise
    },
  })
  cancelledHarness.completionRuntime.markPromptObservationUnavailable(sessionId)
  const cancelled = cancelledHarness.controller.retry(sessionId)
  cancelledHarness.controller.stop(sessionId)
  assert.equal(cancelledSignal?.aborted, true)
  cancelledRefresh.reject(new Error('aborted'))
  assert.equal(await cancelled, 'cancelled')

  const recoveredRefresh = deferred<CompletionStatus>()
  const recoveredHarness = createHarness({
    refreshStatus: () => recoveredRefresh.promise,
  })
  recoveredHarness.completionRuntime.markPromptObservationUnavailable(sessionId)
  const recovered = recoveredHarness.controller.retry(sessionId)
  recoveredHarness.completionRuntime.applyPromptBoundary(sessionId, promptBoundary)
  recoveredHarness.controller.stop(sessionId)
  recoveredRefresh.reject(new Error('aborted after prompt'))
  assert.equal(await recovered, 'succeeded')
})
