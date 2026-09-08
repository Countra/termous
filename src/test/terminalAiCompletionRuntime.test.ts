import assert from 'node:assert/strict'
import test from 'node:test'
import type { TerminalAICompletionRequest, TerminalAICompletionResult } from '#common/contracts'
import { TerminalCompletionRuntime } from '../features/terminal/model/terminalCompletionRuntime.ts'
import { TerminalAiCompletionRuntime } from '../features/terminal/model/terminalAiCompletionRuntime.ts'
import { isTerminalAiCommand, terminalAiAppendState } from '../features/terminal/model/terminalAiCompletion.ts'

const boundary = { source_generation: 1, shell_id: 'bash-1', prompt_generation: 2, input_epoch: 3, shell: 'bash', cwd: '/srv' }

function fixture() {
  const completion = new TerminalCompletionRuntime()
  completion.applyTransportState('s1', 'live')
  completion.applyPromptBoundary('s1', boundary)
  const pending: { request: TerminalAICompletionRequest; resolve: (result: TerminalAICompletionResult) => void }[] = []
  const cancelled: string[] = []
  let sequence = 0
  const runtime = new TerminalAiCompletionRuntime({
    sessionId: 's1', captureInput: () => completion.captureAiInput('s1'),
    setPaused: (paused) => completion.setSuggestionsPaused('s1', paused),
    requestId: () => `r${++sequence}`,
    generate: (request) => new Promise((resolve) => pending.push({ request, resolve })),
    cancel: async (requestId) => { cancelled.push(requestId) },
  })
  completion.subscribe('s1', () => runtime.inputChanged())
  const succeed = (index = 0, command = 'ls -la') => pending[index].resolve({
    ...pending[index].request, status: 'completed', command, description: '列出文件',
    model: { id: 'm', name: 'Model', providerName: 'Provider' },
  })
  return { completion, runtime, pending, cancelled, succeed }
}

test('AI 手动生成冻结输入，打开和编辑需求不产生模型请求', async () => {
  const { runtime, pending, succeed } = fixture()
  assert.equal(runtime.open(), true)
  runtime.updatePrompt('列出文件')
  assert.equal(pending.length, 0)
  const call = runtime.generate()
  await runtime.generate()
  assert.equal(pending.length, 1)
  assert.equal(runtime.getSnapshot().phase, 'loading')
  assert.equal(pending[0].request.inputSnapshot.line, '')
  succeed()
  await call
  assert.equal(runtime.getSnapshot().phase, 'ready')
  assert.equal(runtime.getSelectedResult()?.command, 'ls -la')
})

test('输入修改立即取消；迟到生成结果不能重开面板', async () => {
  const { completion, runtime, cancelled, succeed } = fixture()
  runtime.open()
  runtime.updatePrompt('列出文件')
  const call = runtime.generate()
  completion.applyUserData('s1', 'pwd')
  assert.equal(runtime.getSnapshot().open, false)
  assert.deepEqual(cancelled, ['r1'])
  succeed()
  await call
  assert.deepEqual(runtime.getSnapshot().results, [])
})

test('连续生成追加候选，修改需求保留列表，并使用稳定 ID 选择相同命令', async () => {
  const { runtime, succeed } = fixture()
  runtime.open()
  runtime.updatePrompt('列出文件')
  const first = runtime.generate()
  succeed()
  await first
  runtime.updatePrompt('换一种方式')
  assert.equal(runtime.getSnapshot().results.length, 1)
  const second = runtime.generate()
  assert.equal(runtime.getSelectedResult()?.requestId, 'r1')
  succeed(1)
  await second
  assert.deepEqual(runtime.getSnapshot().results.map((item) => item.requestId), ['r1', 'r2'])
  assert.equal(runtime.getSnapshot().selectedResultId, 'r2')
  assert.equal(runtime.selectResult('r1'), true)
  assert.equal(runtime.getSelectedResult()?.requestId, 'r1')
  assert.equal(runtime.selectResult('missing'), false)
  assert.equal(runtime.getSnapshot().selectedResultId, 'r1')
  runtime.close()
  assert.deepEqual(runtime.getSnapshot().results, [])
  assert.equal(runtime.getSelectedResult(), undefined)
})

test('生成期间手动选择旧候选，回包不切换用户将要填入的命令', async () => {
  const { runtime, succeed } = fixture()
  runtime.open()
  runtime.updatePrompt('列出文件')
  const first = runtime.generate()
  succeed()
  await first
  const second = runtime.generate()
  assert.equal(runtime.selectResult('r1'), true)
  succeed(1, 'pwd')
  await second
  assert.equal(runtime.getSnapshot().results.length, 2)
  assert.equal(runtime.getSelectedResult()?.command, 'ls -la')
})

test('生成失败和取消保留旧候选，迟到响应不追加', async () => {
  const { runtime, pending, succeed } = fixture()
  runtime.open()
  runtime.updatePrompt('列出文件')
  const first = runtime.generate()
  succeed()
  await first
  const second = runtime.generate()
  pending[1].resolve({ ...pending[1].request, status: 'failed', code: 'MODEL_ERROR', message: 'Connection error.' })
  await second
  assert.equal(runtime.getSnapshot().phase, 'error')
  assert.equal(runtime.getSelectedResult()?.requestId, 'r1')
  const third = runtime.generate()
  runtime.cancel()
  assert.equal(runtime.getSnapshot().results.length, 1)
  succeed(2, 'pwd')
  await third
  assert.deepEqual(runtime.getSnapshot().results.map((item) => item.requestId), ['r1'])
  assert.equal(runtime.getSelectedResult()?.command, 'ls -la')
})

test('已有多条候选时输入版本失效会一起清空，并取消新请求', async () => {
  const { runtime, completion, cancelled, succeed } = fixture()
  runtime.open()
  runtime.updatePrompt('列出文件')
  for (let index = 0; index < 2; index += 1) {
    const call = runtime.generate()
    succeed(index)
    await call
  }
  const third = runtime.generate()
  completion.applyUserData('s1', 'pwd')
  assert.equal(runtime.getSnapshot().open, false)
  assert.deepEqual(runtime.getSnapshot().results, [])
  assert.deepEqual(cancelled, ['r3'])
  succeed(2)
  await third
  assert.deepEqual(runtime.getSnapshot().results, [])
})

test('同一行改回原文也不能采用之前的输入版本', () => {
  const { completion } = fixture()
  const original = completion.captureAiInput('s1')
  completion.applyUserData('s1', 'x')
  completion.applyUserData('s1', '\x7f')
  assert.equal(completion.captureAiInput('s1')?.line, '')
  assert.equal(terminalAiAppendState(completion.captureAiInput('s1'), original, 'ls'), 'stale')
})

test('填入只允许完整命令的后缀且精确匹配没有执行语义', () => {
  const { completion } = fixture()
  completion.applyUserData('s1', 'ls')
  const input = completion.captureAiInput('s1')
  assert.equal(terminalAiAppendState(input, input, 'ls -la'), 'append')
  assert.equal(terminalAiAppendState(input, input, 'ls'), 'exact')
  assert.equal(terminalAiAppendState(input, input, 'pwd'), 'mismatch')
  for (const command of ['ls\r', 'ls\nwhoami', 'ls\x1b[A', 'ls\u2028whoami', 'ls\u202e']) {
    assert.equal(isTerminalAiCommand(command), false)
  }
})

test('非行末、原生 Tab、备用屏幕、输入法和禁用时不能捕获 AI 输入', () => {
  for (const update of [
    (c: TerminalCompletionRuntime) => { c.applyUserData('s1', 'ls'); c.applyUserData('s1', '\x1b[D') },
    (c: TerminalCompletionRuntime) => c.applyUserData('s1', '\t'),
    (c: TerminalCompletionRuntime) => c.setAlternateScreen('s1', true),
    (c: TerminalCompletionRuntime) => c.startComposition('s1'),
    (c: TerminalCompletionRuntime) => c.setEnabled(false),
  ]) {
    const { completion, runtime } = fixture()
    update(completion)
    assert.equal(completion.captureAiInput('s1'), null)
    assert.equal(runtime.open(), false)
  }
})

test('取消保留需求，手动重试独立请求，旧结果无法覆盖新结果', async () => {
  const { runtime, pending, cancelled, succeed } = fixture()
  runtime.open()
  runtime.updatePrompt('列出文件')
  const first = runtime.generate()
  runtime.cancel()
  assert.equal(runtime.getSnapshot().prompt, '列出文件')
  assert.equal(runtime.getSnapshot().phase, 'idle')
  const second = runtime.generate()
  assert.equal(pending.length, 2)
  succeed(0)
  await first
  assert.equal(runtime.getSnapshot().phase, 'loading')
  succeed(1)
  await second
  assert.equal(runtime.getSnapshot().phase, 'ready')
  assert.deepEqual(cancelled, ['r1'])
})

test('失败只呈现一次且保留原文；超过 4 KiB 需求不调用模型', async () => {
  const { runtime, pending } = fixture()
  runtime.open()
  runtime.updatePrompt('查看空间')
  const call = runtime.generate()
  pending[0].resolve({ ...pending[0].request, status: 'failed', code: 'MODEL_ERROR', message: 'Connection error.\nTry later.' })
  await call
  assert.equal(runtime.getSnapshot().errorMessage, 'Connection error.\nTry later.')
  assert.equal(pending.length, 1)
  runtime.updatePrompt('中'.repeat(1400))
  await runtime.generate()
  assert.equal(pending.length, 1)
  assert.equal(runtime.getSnapshot().errorCode, 'AI_COMPLETION_PROMPT_TOO_LONG')
})

test('AI 面板暂停普通查询，关闭后恢复查询调度', () => {
  const scheduled = new Set<() => void>()
  const completion = new TerminalCompletionRuntime(true, {
    query: async () => { throw new Error('不应执行测试调度') },
    schedule: (fn) => { scheduled.add(fn); return () => { scheduled.delete(fn) } },
  })
  completion.applyPromptBoundary('s1', boundary)
  completion.applyUserData('s1', 'ls')
  assert.equal(scheduled.size, 1)
  completion.setSuggestionsPaused('s1', true)
  assert.equal(scheduled.size, 0)
  assert.ok(completion.captureAiInput('s1'))
  completion.applyUserData('s1', ' -')
  assert.equal(scheduled.size, 0)
  completion.setSuggestionsPaused('s1', false)
  assert.equal(scheduled.size, 1)
  completion.clear()
  assert.equal(scheduled.size, 0)
})
