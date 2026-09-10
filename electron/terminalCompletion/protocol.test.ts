import assert from 'node:assert/strict'
import test from 'node:test'
import { isTerminalCompletionRequest, isTerminalCompletionBootstrap, isTerminalCompletionResult, completionFailure } from './protocol.ts'
import { completionTestBootstrap, completionTestRequest } from './testFixture.ts'

test('终端请求只接受完整稳定快照、行末光标和有界的有效Unicode', () => {
  const request = completionTestRequest()
  assert.equal(isTerminalCompletionRequest(request), true)
  for (const snapshot of [
    { ...request.inputSnapshot, sourceGeneration: 0 }, { ...request.inputSnapshot, inputEpoch: -1 },
    { ...request.inputSnapshot, cursorUtf16: 1 }, { ...request.inputSnapshot, line: '\ud800', cursorUtf16: 1 },
    { ...request.inputSnapshot, line: 'echo\nrm', cursorUtf16: 7 },
  ]) assert.equal(isTerminalCompletionRequest({ ...request, inputSnapshot: snapshot }), false)
  assert.equal(isTerminalCompletionRequest({ ...request, prompt: '请查看\n磁盘空间' }), true)
  assert.equal(isTerminalCompletionRequest({ ...request, prompt: '请查看\t磁盘空间' }), true)
  assert.equal(isTerminalCompletionRequest({ ...request, inputSnapshot: { ...request.inputSnapshot, line: 'a\tb', cursorUtf16: 3 } }), false)
  assert.equal(isTerminalCompletionRequest({ ...request, prompt: 'x'.repeat(4097) }), false)
})

test('bootstrap校验模型与环境，响应必须匹配原快照且不能带控制字符命令', () => {
  const request = completionTestRequest()
  const bootstrap = completionTestBootstrap()
  assert.equal(isTerminalCompletionBootstrap(bootstrap, request.requestId), true)
  assert.equal(isTerminalCompletionBootstrap(bootstrap, 'other'), false)
  assert.equal(isTerminalCompletionBootstrap({ ...bootstrap, environment: { os: 'linux', shell: 'bash', cwd: '\0' } }, request.requestId), false)
  const result = completionFailure(request, 'TERMINAL_AI_CANCELLED', '已取消')
  assert.equal(isTerminalCompletionResult(result, request), true)
  assert.equal(isTerminalCompletionResult({ ...result, message: '503\toverloaded\ntry later' }, request), true)
  assert.equal(isTerminalCompletionResult({ ...result, inputSnapshot: Object.fromEntries(Object.entries(request.inputSnapshot).reverse()) }, request), true)
  assert.equal(isTerminalCompletionResult({ ...result, inputSnapshot: { ...request.inputSnapshot, extra: 1n } }, request), true)
  assert.equal(isTerminalCompletionResult({ ...result, inputSnapshot: { ...request.inputSnapshot, revision: 9 } }, request), false)
  const completed = { ...request, status: 'completed', command: 'df -h', description: '磁盘空间', model: { id: 'model', name: 'model', providerName: 'provider' } }
  assert.equal(isTerminalCompletionResult(completed, request), true)
  assert.equal(isTerminalCompletionResult({ ...completed, command: 'a'.repeat(4097) }, request), false)
  assert.equal(isTerminalCompletionResult({ ...completed, description: '' }, request), false)
})
