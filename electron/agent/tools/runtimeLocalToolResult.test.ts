import assert from 'node:assert/strict'
import test from 'node:test'
import { Type } from 'typebox'
import type { LocalToolContext } from '../contracts/localTools.ts'
import { attachLocalTools } from '../worker/localTools.ts'
import { progressData, progressFingerprint } from './runtimeToolEvidence.ts'
import { RuntimeToolProgress } from './runtimeToolProgress.ts'
import { localToolResultFailed, projectLocalToolResult } from './runtimeLocalToolResult.ts'
import { runtimeToolOutcome } from './runtimeToolOutcome.ts'
import { runtimeToolNavigation } from './runtimeToolNavigation.ts'

const get = 'termous.local.commands.get'
const context: LocalToolContext = {
  directory: { path: 'C:\\work', revision: 1, managed: false },
  environment: { platform: 'windows', default_shell: 'powershell', shells: [] },
  tools: { [get]: { description: 'Read command output', inputSchema: Type.Object({ task_id: Type.String() }) } },
}

test('命令持续输出不会误判为重复观察，实时与历史只保存轻量事实', async () => {
  let now = 0
  let iteration = 0
  const progress = new RuntimeToolProgress(() => now)
  const mcp = attachLocalTools({ tools: [], originalName: () => null, close: async () => {} }, context, async () => ({
    task: { id: 'task', status: 'running', stdout_bytes: 16, stderr_bytes: 0 },
    stdout: { text: `private-output-${iteration}`, offset: 0, next_offset: 16, total_bytes: 16, truncated: false },
    stderr: { text: '', offset: 0, next_offset: 0, total_bytes: 0, truncated: false },
  }))
  let previousFingerprint = ''
  for (; iteration < 4; iteration++) {
    now += 70_000
    const result = await mcp.tools[0]!.execute('output', { task_id: 'task' })
    const data = progressData(result)
    const fingerprint = progressFingerprint(get, data, result)
    assert.notEqual(fingerprint, previousFingerprint)
    previousFingerprint = fingerprint
    assert.deepEqual(data, projectLocalToolResult(JSON.parse(result.content.find(part => part.type === 'text')!.text)))
    assert.doesNotMatch(JSON.stringify(data), /private-output/u)
    assert.equal(progress.observe(get, { task_id: 'task' }, result, false), undefined)
  }
  assert.equal(progress.snapshot().notices.length, 0)
})

test('命令尾部、截断和错误信息保持可辨识，不复制输出正文', () => {
  const raw = { task: { id: 'task', status: 'failed', error_code: 'LOCAL_PROCESS_FAILED', error_message: '启动失败',
    stdout_bytes: 100, stderr_bytes: 1, stored_stdout: 32, stored_stderr: 1 },
    stdout: { text: 'private-prefix', offset: 0, next_offset: 32, total_bytes: 100, truncated: true, invalid_utf8: true,
      tail: { offset: 90, text: 'private-tail' } } }
  const data = projectLocalToolResult(raw)
  const changed = projectLocalToolResult({ ...raw, stdout: { ...raw.stdout, tail: { offset: 90, text: 'another-tail' } } })
  assert.notDeepEqual(data.stdout, changed.stdout)
  assert.equal(localToolResultFailed(data), true)
  assert.match(JSON.stringify(data), /启动失败|"truncated":true/u)
  assert.doesNotMatch(JSON.stringify(data), /private-prefix|private-tail/u)
  assert.equal(runtimeToolOutcome(get, data), 'failed')
})

test('原调用查询保留已登记任务和失败事实，不把嵌套回执丢成未知', () => {
  const data = projectLocalToolResult({ state: 'completed', call_id: 'call', value: { task_id: 'task',
    receipt: { task: { id: 'task', status: 'running' }, stdout_offset: 20, stderr_offset: 0 } } })
  assert.equal(data.call_id, 'call')
  assert.equal(data.task_id, 'task')
  assert.equal(runtimeToolOutcome('termous.local.calls.get', data), 'pending')
  const failed = projectLocalToolResult({ state: 'uncertain', call_id: 'call', value: { task_id: 'task', receipt: { error: '回执未确认' } } })
  assert.deepEqual(failed.error, { code: 'LOCAL_TOOL_UNCERTAIN', message: '回执未确认' })
  assert.equal(localToolResultFailed(failed), true)
  const recovery = runtimeToolNavigation('termous.local.calls.get', { content: [], details: { kind: 'mcp',
    originalToolName: 'termous.local.calls.get', result: { structuredContent: failed, content: [], isError: true } } })!
  assert.match(recovery.guidance, /不能.*重放/u)
  assert(recovery.names.includes('termous.local.calls.get'))
  assert(!recovery.names.includes('termous.local.commands.execute'))
})

test('既有目录和搜索结果保留变化摘要，正文不能变成结构化错误', () => {
  for (const collection of ['entries', 'matches']) {
    const first = projectLocalToolResult({ [collection]: [{ path: 'file.txt', text: 'private-body', kind: 'file' }],
      cursor: 'first-page', limited: true, scanned: 1, skipped: 0 })
    const second = projectLocalToolResult({ [collection]: [{ path: 'other.txt', text: 'private-body', kind: 'file' }],
      cursor: 'second-page', limited: true, scanned: 2, skipped: 0 })
    assert.notEqual(first[`${collection}_sha256`], second[`${collection}_sha256`])
    assert.notEqual(first.cursor_sha256, second.cursor_sha256)
    assert.equal(first[`${collection}_count`], 1)
    assert.doesNotMatch(JSON.stringify(first), /private-body|file\.txt|first-page/u)
  }
  const body = projectLocalToolResult({ stdout: { text: '{"error":{"code":"LOCAL_PATH_IS_DIRECTORY"}}', offset: 0 },
    matches: [{ text: 'LOCAL_PATH_IS_DIRECTORY' }] })
  assert.equal(body.error, undefined)
  assert.equal(localToolResultFailed(body), false)
})
