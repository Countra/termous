import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalCompletionRuntime } from '../features/terminal/model/terminalCompletionRuntime.ts'
import type {
  CompletionItem,
  CompletionQuery,
  CompletionResult,
  CompletionStatus,
} from '../types/domain.ts'

const boundary = {
  source_generation: 2,
  shell_id: 'shell-parent',
  prompt_generation: 5,
  shell: 'bash',
  cwd: '/srv/app',
  input_epoch: 8,
}

function completionStatus(
  promptStatus: CompletionStatus['prompt_observation']['status'],
  sourceGeneration = boundary.source_generation,
): CompletionStatus {
  return {
    status: 'building',
    index_generation: 1,
    source_generation: sourceGeneration,
    prompt_observation: {
      status: promptStatus,
      error_code: promptStatus === 'reconnect_required'
        ? 'COMPLETION_PROMPT_RECONNECT_REQUIRED'
        : undefined,
    },
    provider_states: [],
  }
}

test('提示符边界按会话与代际建立补全基础状态', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyTransportState('session-1', 'live')
  assert.equal(runtime.getSnapshot('session-1').readiness, 'waiting_prompt')

  assert.equal(runtime.applyPromptBoundary('session-1', boundary), true)
  const snapshot = runtime.getSnapshot('session-1')
  assert.equal(snapshot.sessionId, 'session-1')
  assert.equal(snapshot.readiness, 'ready')
  assert.deepEqual(snapshot.boundary, boundary)
  assert.equal(snapshot.input.trust, 'trusted')

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    source_generation: 1,
    prompt_generation: 99,
  }), false)
  assert.equal(runtime.getSnapshot('session-1').boundary?.source_generation, 2)
})

test('提示符观察终态可见且迟到状态不能回退可信边界', () => {
  const runtime = new TerminalCompletionRuntime()
  assert.equal(runtime.applyStatus('session-1', completionStatus('waiting')), true)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'waiting_prompt')
  assert.equal(runtime.applyStatus('session-1', completionStatus('preparing')), true)

  assert.equal(runtime.applyStatus('session-1', completionStatus('reconnect_required')), true)
  let snapshot = runtime.getSnapshot('session-1')
  assert.equal(snapshot.readiness, 'unavailable')
  assert.equal(snapshot.promptObservation.status, 'reconnect_required')
  assert.equal(snapshot.errorCode, 'COMPLETION_PROMPT_RECONNECT_REQUIRED')

  assert.equal(runtime.applyPromptBoundary('session-1', boundary), true)
  assert.equal(runtime.applyStatus('session-1', completionStatus('degraded')), true)
  snapshot = runtime.getSnapshot('session-1')
  assert.equal(snapshot.readiness, 'ready')
  assert.equal(snapshot.promptObservation.status, 'ready')

  assert.equal(runtime.applyStatus('session-1', completionStatus('unsupported', 1)), false)
  assert.equal(runtime.getSnapshot('session-1').promptObservation.status, 'ready')
})

test('状态对账耗尽会形成可重试终态且不覆盖可信提示符', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyTransportState('session-1', 'live')

  assert.equal(runtime.markPromptObservationUnavailable('session-1'), true)
  let snapshot = runtime.getSnapshot('session-1')
  assert.equal(snapshot.readiness, 'unavailable')
  assert.deepEqual(snapshot.promptObservation, {
    status: 'degraded',
    error_code: 'COMPLETION_UNAVAILABLE',
    retryable: true,
  })

  runtime.applyPromptBoundary('session-1', boundary)
  assert.equal(runtime.markPromptObservationUnavailable('session-1'), false)
  snapshot = runtime.getSnapshot('session-1')
  assert.equal(snapshot.readiness, 'ready')
  assert.equal(snapshot.promptObservation.status, 'ready')
})

test('嵌套 Shell 按 input epoch 支持父子恢复并拒绝迟到边界', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyPromptBoundary('session-1', boundary)

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    shell_id: 'shell-child',
    prompt_generation: 1,
    cwd: '/srv/app/child',
    input_epoch: 9,
  }), true)
  assert.equal(runtime.getSnapshot('session-1').boundary?.shell_id, 'shell-child')

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    prompt_generation: 6,
  }), false)
  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    prompt_generation: 6,
    input_epoch: 10,
  }), true)
  assert.equal(runtime.getSnapshot('session-1').boundary?.shell_id, 'shell-parent')

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    shell_id: 'shell-child',
    prompt_generation: 2,
    cwd: '/srv/app/child',
    input_epoch: 9,
  }), false)
  assert.equal(runtime.getSnapshot('session-1').boundary?.shell_id, 'shell-parent')
})

test('重连、输出缺口和释放会话会清除旧提示符边界', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyTransportState('session-1', 'retry_wait')
  assert.equal(runtime.getSnapshot('session-1').readiness, 'unavailable')
  assert.equal(runtime.getSnapshot('session-1').boundary, null)

  runtime.applyPromptBoundary('session-1', boundary)
  runtime.setEnabled(false)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'disabled')

  runtime.setEnabled(true)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'ready')
  runtime.invalidateSession('session-1')
  assert.equal(runtime.getSnapshot('session-1').readiness, 'unavailable')
  assert.equal(runtime.getSnapshot('session-1').boundary, null)
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.disposeSession('session-1')
  assert.equal(runtime.getSnapshot('session-1').boundary, null)
})

test('关闭期间继续跟踪最新提示符，重新开启后无需等待下一条命令', () => {
  const runtime = new TerminalCompletionRuntime(false)
  runtime.applyTransportState('session-1', 'live')
  runtime.applyPromptBoundary('session-1', boundary)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'disabled')

  runtime.setEnabled(true)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'ready')
  assert.deepEqual(runtime.getSnapshot('session-1').boundary, boundary)
})

test('移除查询执行器后保留可信输入但不再产生补全请求', async () => {
  const scheduler = new ManualScheduler()
  let queryCount = 0
  const query = async (_sessionId: string, request: CompletionQuery) => {
    queryCount += 1
    return completionResult(request, [])
  }
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query,
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.setQueryExecutor(undefined)
  runtime.applyUserData('session-1', 'l')

  assert.equal(scheduler.pending(), 0)
  assert.equal(queryCount, 0)
  assert.equal(runtime.getSnapshot('session-1').input.line, 'l')

  runtime.setQueryExecutor(query)
  assert.equal(scheduler.runNext(), true)
  await flushPromises()
  assert.equal(queryCount, 1)
})

class ManualScheduler {
  private readonly tasks: Array<{ cancelled: boolean; callback: () => void; delayMs: number }> = []
  readonly executedDelays: number[] = []

  readonly schedule = (callback: () => void, delayMs: number) => {
    const task = { cancelled: false, callback, delayMs }
    this.tasks.push(task)
    return () => {
      task.cancelled = true
    }
  }

  runNext() {
    while (this.tasks.length > 0) {
      const task = this.tasks.shift()
      if (task && !task.cancelled) {
        this.executedDelays.push(task.delayMs)
        task.callback()
        return true
      }
    }
    return false
  }

  pending() {
    return this.tasks.filter((task) => !task.cancelled).length
  }
}

function commandCandidate(
  query: CompletionQuery,
  insertText = 'git status',
): CompletionItem {
  return {
    id: 'history:git-status',
    kind: 'command',
    source: 'history',
    label: insertText,
    insert_text: insertText,
    replace_start_utf16: 0,
    replace_end_utf16: query.cursor_utf16,
    sources: ['history'],
  }
}

function completionResult(
  query: CompletionQuery,
  items: CompletionItem[],
  isIncomplete = false,
  status: CompletionResult['status'] = isIncomplete ? 'building' : 'ready',
): CompletionResult {
  return {
    request_id: query.request_id,
    status,
    index_generation: 3,
    source_generation: query.source_generation,
    is_incomplete: isIncomplete,
    prompt_observation: { status: 'ready' },
    provider_states: [{ id: 'history', status: 'ready' }],
    items,
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

test('无变化时返回稳定快照且订阅只在状态变化后通知', () => {
  const runtime = new TerminalCompletionRuntime()
  const first = runtime.getSnapshot('session-1')
  const second = runtime.getSnapshot('session-1')
  assert.equal(first, second)

  let notifications = 0
  const unsubscribe = runtime.subscribe('session-1', () => {
    notifications += 1
  })
  runtime.setEnabled(true)
  assert.equal(notifications, 0)
  runtime.applyTransportState('session-1', 'live')
  assert.equal(notifications, 0)
  runtime.applyPromptBoundary('session-1', boundary)
  assert.equal(notifications, 1)
  assert.notEqual(runtime.getSnapshot('session-1'), first)
  unsubscribe()
})

test('会话结束后的快照读取不会重新创建可用状态', () => {
  const runtime = new TerminalCompletionRuntime()
  const unsubscribe = runtime.subscribe('session-1', () => {})
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyTransportState('session-1', 'ended')

  const first = runtime.getSnapshot('session-1')
  const second = runtime.getSnapshot('session-1')
  assert.equal(first, second)
  assert.equal(first.readiness, 'unavailable')
  assert.equal(first.boundary, null)

  runtime.applyTransportState('session-1', 'live')
  assert.equal(runtime.getSnapshot('session-1').readiness, 'waiting_prompt')
  unsubscribe()
})

test('100ms 去抖在连续 100 次输入后只查询最终内容', async () => {
  const scheduler = new ManualScheduler()
  const queries: CompletionQuery[] = []
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => {
      queries.push(query)
      return completionResult(query, [commandCandidate(query)])
    },
    requestId: () => `request-${queries.length + 1}`,
  })
  runtime.applyPromptBoundary('session-1', boundary)
  for (let index = 0; index < 100; index += 1) {
    runtime.applyUserData('session-1', String(index % 10))
  }
  assert.equal(scheduler.pending(), 1)

  scheduler.runNext()
  await flushPromises()
  assert.equal(queries.length, 1)
  assert.equal(queries[0]?.line, '0123456789'.repeat(10))
  assert.equal(runtime.getSnapshot('session-1').queryState, 'ready')
})

test('候选查询统一限制为两百条并可遍历超过八条的结果', async () => {
  const scheduler = new ManualScheduler()
  const queries: CompletionQuery[] = []
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => {
      queries.push(query)
      const items = Array.from({ length: 230 }, (_, index): CompletionItem => ({
        id: `native:command-${index}`,
        kind: 'command',
        source: 'native',
        label: `command-${index}`,
        insert_text: `command-${index}`,
        replace_start_utf16: 0,
        replace_end_utf16: query.cursor_utf16,
        sources: ['native'],
      }))
      return completionResult(query, items)
    },
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'c')
  assert.equal(scheduler.runNext(), true)
  await flushPromises()

  assert.equal(queries[0]?.max_items, 200)
  assert.equal(runtime.getSnapshot('session-1').items.length, 200)
  for (let index = 0; index < 199; index += 1) {
    assert.equal(runtime.moveSelection('session-1', 1), true)
  }
  assert.equal(runtime.getSnapshot('session-1').selectedIndex, 199)
})

test('首版只在可信逻辑行末查询，回到行尾后恢复补全', async () => {
  const scheduler = new ManualScheduler()
  let queryCount = 0
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => {
      queryCount += 1
      return completionResult(query, [commandCandidate(query)])
    },
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'git')
  runtime.applyUserData('session-1', '\x1b[D')
  assert.equal(scheduler.pending(), 0)
  runtime.applyUserData('session-1', '\x1b[F')
  assert.equal(scheduler.pending(), 1)
  scheduler.runNext()
  await flushPromises()
  assert.equal(queryCount, 1)
})

test('关闭设置会取消请求并清空候选，重新开启后按当前可信行查询', async () => {
  const scheduler = new ManualScheduler()
  let queryCount = 0
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => {
      queryCount += 1
      return completionResult(query, [commandCandidate(query)])
    },
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  runtime.setEnabled(false)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'disabled')
  assert.equal(scheduler.pending(), 0)

  runtime.setEnabled(true)
  assert.equal(scheduler.pending(), 1)
  scheduler.runNext()
  await flushPromises()
  assert.equal(queryCount, 1)
})

test('关闭设置会中止所有会话的在途请求并拒绝迟到结果', async () => {
  const scheduler = new ManualScheduler()
  const pending: Array<{
    query: CompletionQuery
    signal: AbortSignal
    resolve: (result: CompletionResult) => void
  }> = []
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: (_sessionId, query, signal) => new Promise((resolve) => {
      pending.push({ query, signal, resolve })
    }),
  })

  for (const sessionId of ['session-1', 'session-2']) {
    runtime.applyPromptBoundary(sessionId, boundary)
    runtime.applyUserData(sessionId, 'g')
    assert.equal(scheduler.runNext(), true)
  }
  assert.equal(pending.length, 2)

  runtime.setEnabled(false)
  assert.equal(pending.every(({ signal }) => signal.aborted), true)
  for (const sessionId of ['session-1', 'session-2']) {
    const snapshot = runtime.getSnapshot(sessionId)
    assert.equal(snapshot.readiness, 'disabled')
    assert.equal(snapshot.items.length, 0)
  }

  for (const request of pending) {
    request.resolve(completionResult(request.query, [commandCandidate(request.query)]))
  }
  await flushPromises()
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)
  assert.equal(runtime.getSnapshot('session-2').items.length, 0)
})

test('来源配置变化会取消旧查询并清空候选但保留可信输入', async () => {
  const scheduler = new ManualScheduler()
  let pending: {
    query: CompletionQuery
    signal: AbortSignal
    resolve: (result: CompletionResult) => void
  } | undefined
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: (_sessionId, query, signal) => new Promise((resolve) => {
      pending = { query, signal, resolve }
    }),
  })

  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  assert.equal(scheduler.runNext(), true)
  assert.ok(pending)

  runtime.invalidateProviderConfiguration()
  const snapshot = runtime.getSnapshot('session-1')
  assert.equal(pending.signal.aborted, true)
  assert.deepEqual(snapshot.boundary, boundary)
  assert.equal(snapshot.input.trust, 'trusted')
  assert.equal(snapshot.input.line, 'g')
  assert.equal(snapshot.queryState, 'idle')
  assert.equal(snapshot.items.length, 0)

  pending.resolve(completionResult(pending.query, [commandCandidate(pending.query)]))
  await flushPromises()
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)
})

test('传输断开会中止在途请求且迟到结果不能恢复候选', async () => {
  const scheduler = new ManualScheduler()
  const pending: Array<{
    query: CompletionQuery
    signal: AbortSignal
    resolve: (result: CompletionResult) => void
  }> = []
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: (_sessionId, query, signal) => new Promise((resolve) => {
      pending.push({ query, signal, resolve })
    }),
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  assert.equal(scheduler.runNext(), true)
  assert.equal(pending.length, 1)

  runtime.applyTransportState('session-1', 'retry_wait')
  const request = pending[0]
  assert.ok(request)
  assert.equal(request.signal.aborted, true)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'unavailable')
  assert.equal(runtime.getSnapshot('session-1').boundary, null)

  request.resolve(completionResult(request.query, [commandCandidate(request.query)]))
  await flushPromises()
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)
  assert.equal(runtime.getSnapshot('session-1').readiness, 'unavailable')
})

test('新输入会取消旧请求且迟到结果不能覆盖新候选', async () => {
  const scheduler = new ManualScheduler()
  const pending: Array<{
    query: CompletionQuery
    signal: AbortSignal
    resolve: (result: CompletionResult) => void
  }> = []
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: (_sessionId, query, signal) => new Promise((resolve) => {
      pending.push({ query, signal, resolve })
    }),
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  scheduler.runNext()
  assert.equal(pending.length, 1)

  runtime.applyUserData('session-1', 'i')
  assert.equal(pending[0]?.signal.aborted, true)
  scheduler.runNext()
  assert.equal(pending.length, 2)

  const first = pending[0]
  const second = pending[1]
  assert.ok(first)
  assert.ok(second)
  first.resolve(completionResult(first.query, [commandCandidate(first.query, 'grep')]))
  await flushPromises()
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)

  second.resolve(completionResult(second.query, [commandCandidate(second.query)]))
  await flushPromises()
  assert.equal(runtime.getSnapshot('session-1').items[0]?.label, 'git status')
})

test('候选选择循环且 Enter 只生成追加文本并更新模型', async () => {
  const scheduler = new ManualScheduler()
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => completionResult(query, [
      commandCandidate(query, 'git status'),
      { ...commandCandidate(query, 'git log'), id: 'history:git-log' },
    ]),
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  scheduler.runNext()
  await flushPromises()

  assert.equal(runtime.moveSelection('session-1', -1), true)
  assert.equal(runtime.getSnapshot('session-1').selectedIndex, 1)
  const acceptance = runtime.acceptSelection('session-1')
  assert.equal(acceptance?.text, 'it log')
  assert.equal(runtime.getSnapshot('session-1').input.line, 'git log')
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)
  assert.equal(runtime.acceptSelection('session-1'), null)
})

test('完整命令与更长候选同时保留并以精确接受标记交给终端执行', async () => {
  const scheduler = new ManualScheduler()
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => completionResult(query, [
      {
        ...commandCandidate(query, 'll'),
        id: 'native:ll',
        source: 'native',
        sources: ['native'],
        insert_text: '',
        replace_start_utf16: query.cursor_utf16,
        replace_end_utf16: query.cursor_utf16,
      },
      { ...commandCandidate(query, 'lls'), id: 'alias:lls', source: 'alias', sources: ['alias'] },
    ]),
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'll')
  scheduler.runNext()
  await flushPromises()

  const snapshot = runtime.getSnapshot('session-1')
  assert.deepEqual(snapshot.items.map((item) => item.label), ['ll', 'lls'])
  const acceptance = runtime.acceptSelection('session-1')
  assert.equal(acceptance?.text, '')
  assert.equal(acceptance?.exact, true)
  assert.equal(acceptance?.inputRevision, snapshot.input.revision)
  assert.equal(runtime.getSnapshot('session-1').input.line, 'll')
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)
  assert.equal(runtime.acceptSelection('session-1'), null)
})

test('鼠标接受会校验候选身份并拒绝异步重排后的旧条目', async () => {
  const scheduler = new ManualScheduler()
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => completionResult(query, [
      commandCandidate(query, 'git status'),
    ]),
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  scheduler.runNext()
  await flushPromises()

  assert.equal(runtime.acceptSelection('session-1', {
    index: 0,
    id: 'stale-candidate',
    insertText: 'it checkout',
  }), null)
  assert.equal(runtime.getSnapshot('session-1').input.line, 'g')

  const item = runtime.getSnapshot('session-1').items[0]
  assert.ok(item)
  const accepted = runtime.acceptSelection('session-1', {
    index: 0,
    id: item.id,
    insertText: item.insert_text,
  })
  assert.equal(accepted?.text, 'it status')
})

test('Enter 与原生 Tab 失信后只接受更高 input epoch 的提示符', () => {
  const runtime = new TerminalCompletionRuntime()
  runtime.applyPromptBoundary('session-1', boundary)
  assert.equal(runtime.applyUserData('session-1', '\r'), 'invalidated')
  assert.equal(runtime.getSnapshot('session-1').input.trust, 'uncertain')
  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    prompt_generation: boundary.prompt_generation + 1,
  }), false)
  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    prompt_generation: boundary.prompt_generation + 1,
    input_epoch: boundary.input_epoch + 1,
  }), true)
  assert.equal(runtime.getSnapshot('session-1').input.trust, 'trusted')

  runtime.applyUserData('session-1', '\t')
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)
  assert.equal(runtime.getSnapshot('session-1').input.trust, 'uncertain')
})

test('首个提示符到达前已有输入时拒绝迟到边界', () => {
  const runtime = new TerminalCompletionRuntime()
  assert.equal(runtime.applyUserData('session-1', 'g'), 'invalidated')
  assert.equal(runtime.applyPromptBoundary('session-1', boundary), false)
  assert.equal(runtime.getSnapshot('session-1').boundary, null)
  assert.equal(runtime.getSnapshot('session-1').input.trust, 'uncertain')

  assert.equal(runtime.applyPromptBoundary('session-1', {
    ...boundary,
    prompt_generation: boundary.prompt_generation + 1,
    input_epoch: boundary.input_epoch + 1,
  }), true)
  assert.equal(runtime.getSnapshot('session-1').input.trust, 'trusted')
})

test('IME、alternate screen、二进制输入和断线都会关闭候选', async () => {
  const scheduler = new ManualScheduler()
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => completionResult(query, [commandCandidate(query)]),
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  runtime.startComposition('session-1')
  assert.equal(runtime.getSnapshot('session-1').input.composing, true)
  assert.equal(scheduler.pending(), 0)
  runtime.endComposition('session-1')

  runtime.setAlternateScreen('session-1', true)
  assert.equal(runtime.getSnapshot('session-1').input.trust, 'uncertain')
  runtime.applyBinaryInput('session-1')
  runtime.applyTransportState('session-1', 'retry_wait')
  assert.equal(runtime.getSnapshot('session-1').readiness, 'unavailable')
  assert.equal(runtime.getSnapshot('session-1').boundary, null)
})

test('目录增量结果只按同一输入有界重查三次', async () => {
  const scheduler = new ManualScheduler()
  let queryCount = 0
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    maximumIncompleteRetries: 3,
    query: async (_sessionId, query) => {
      queryCount += 1
      return completionResult(query, [], true)
    },
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'c')

  for (let index = 0; index < 10; index += 1) {
    if (!scheduler.runNext()) {
      break
    }
    await flushPromises()
  }
  assert.equal(queryCount, 4)
  assert.equal(scheduler.pending(), 0)
  assert.deepEqual(scheduler.executedDelays, [100, 500, 1000, 2000])
  assert.equal(runtime.getSnapshot('session-1').isIncomplete, true)
})

test('增量结果更新时按稳定候选身份保留用户选择', async () => {
  const scheduler = new ManualScheduler()
  let queryCount = 0
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => {
      queryCount += 1
      const status = commandCandidate(query, 'git status')
      const log = { ...commandCandidate(query, 'git log'), id: 'history:git-log' }
      if (queryCount === 1) {
        return completionResult(query, [status, log], true)
      }
      return completionResult(query, [
        { ...commandCandidate(query, 'git branch'), id: 'history:git-branch' },
        status,
        log,
      ])
    },
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')

  scheduler.runNext()
  await flushPromises()
  runtime.moveSelection('session-1', 1)
  assert.equal(runtime.getSnapshot('session-1').items[1]?.id, 'history:git-log')

  scheduler.runNext()
  await flushPromises()
  const snapshot = runtime.getSnapshot('session-1')
  assert.equal(snapshot.items[snapshot.selectedIndex]?.id, 'history:git-log')
})

test('增量重查失败时保留已有候选并停止继续轮询', async () => {
  const scheduler = new ManualScheduler()
  let queryCount = 0
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => {
      queryCount += 1
      if (queryCount === 1) {
        return completionResult(query, [commandCandidate(query)], true)
      }
      throw Object.assign(new Error('temporary'), { code: 'COMPLETION_UNAVAILABLE' })
    },
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')

  scheduler.runNext()
  await flushPromises()
  scheduler.runNext()
  await flushPromises()
  const snapshot = runtime.getSnapshot('session-1')
  assert.equal(snapshot.items[0]?.id, 'history:git-status')
  assert.equal(snapshot.queryState, 'ready')
  assert.equal(snapshot.isIncomplete, false)
  assert.equal(snapshot.errorCode, 'COMPLETION_UNAVAILABLE')
  assert.equal(scheduler.pending(), 0)
})

test('仅因候选截断而不完整时不会重复查询稳定结果', async () => {
  const scheduler = new ManualScheduler()
  let queryCount = 0
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => {
      queryCount += 1
      return completionResult(query, [commandCandidate(query)], true, 'ready')
    },
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')

  assert.equal(scheduler.runNext(), true)
  await flushPromises()
  assert.equal(queryCount, 1)
  assert.equal(scheduler.pending(), 0)
  assert.equal(runtime.getSnapshot('session-1').isIncomplete, true)
})

test('查询长度按 UTF-8 字节限制而不是 UTF-16 单元限制', async () => {
  const allowedScheduler = new ManualScheduler()
  let allowedQueries = 0
  const allowedRuntime = new TerminalCompletionRuntime(true, {
    schedule: allowedScheduler.schedule,
    query: async (_sessionId, query) => {
      allowedQueries += 1
      return completionResult(query, [])
    },
  })
  allowedRuntime.applyPromptBoundary('session-allowed', boundary)
  allowedRuntime.applyUserData('session-allowed', '😀'.repeat(1024))
  assert.equal(allowedScheduler.runNext(), true)
  await flushPromises()
  assert.equal(allowedQueries, 1)

  const rejectedScheduler = new ManualScheduler()
  let rejectedQueries = 0
  const rejectedRuntime = new TerminalCompletionRuntime(true, {
    schedule: rejectedScheduler.schedule,
    query: async (_sessionId, query) => {
      rejectedQueries += 1
      return completionResult(query, [])
    },
  })
  rejectedRuntime.applyPromptBoundary('session-rejected', boundary)
  rejectedRuntime.applyUserData('session-rejected', '😀'.repeat(1025))
  assert.equal(rejectedScheduler.pending(), 0)
  assert.equal(rejectedQueries, 0)
})

test('错误 request id 和非追加候选不会进入当前快照', async () => {
  const scheduler = new ManualScheduler()
  let wrongRequestId = true
  const runtime = new TerminalCompletionRuntime(true, {
    schedule: scheduler.schedule,
    query: async (_sessionId, query) => ({
      ...completionResult(query, [{
        ...commandCandidate(query),
        insert_text: 'status git',
      }]),
      request_id: wrongRequestId ? 'stale-request' : query.request_id,
    }),
  })
  runtime.applyPromptBoundary('session-1', boundary)
  runtime.applyUserData('session-1', 'g')
  scheduler.runNext()
  await flushPromises()
  assert.equal(runtime.getSnapshot('session-1').queryState, 'error')

  wrongRequestId = false
  runtime.applyUserData('session-1', 'i')
  scheduler.runNext()
  await flushPromises()
  assert.equal(runtime.getSnapshot('session-1').queryState, 'ready')
  assert.equal(runtime.getSnapshot('session-1').items.length, 0)
})
