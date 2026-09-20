import assert from 'node:assert/strict'
import test from 'node:test'
import { auditOutcome, auditParameters, auditResult } from './auditProjection.ts'

test('命令执行参数完整保留，其他工具及结果继续脱敏', () => {
  const command = `  curl -u 'alice:PASS' -H 'Authorization: Bearer TOKEN' https://host/?sig=SIGNED\nprintf 中文\n${'x'.repeat(6000)}`
  const parameters = auditParameters({ command, source: { password: 'PRIVATE_VALUE' }, content: 'FILE_BODY' }, 'termous.commands.dispatch')
  assert.equal(parameters.command, command)
  assert.doesNotMatch(JSON.stringify(parameters), /PRIVATE_VALUE|FILE_BODY/)
  assert.doesNotMatch(JSON.stringify(auditParameters({ command }, 'termous.snippets.create')), /alice:PASS|Bearer TOKEN|sig=SIGNED/)
  assert.equal(auditParameters({ command: '<'.repeat(8192) }, 'termous.commands.dispatch').command, '<'.repeat(8192))
  assert.equal(auditParameters({ command: 'x'.repeat(8193) }, 'termous.commands.dispatch')._truncated, true)
})

test('Worker 与 Core 对进行中、部分完成和不确定结果采用相同分类', () => {
  for (const state of ['enqueued', 'verifying', 'validating', 'interrupting', 'waiting_host_trust']) {
    assert.equal(auditOutcome(auditResult({ operation: { phase: state } })), 'accepted', state)
  }
  const cases: [Record<string, unknown>, string][] = [
    [{ transfer: { status: 'failed', partial: true } }, 'partial'],
    [{ transfer: { status: 'failed', partial: true, error_code: 'FILES_WRITE_UNCERTAIN' } }, 'unknown'],
    [{ task: { status: 'completed', unknown_targets: 1 } }, 'unknown'],
    [{ approval: { state: 'approved' }, task: { status: 'queued' } }, 'accepted'],
    [{ status: 'ok', task: { status: 'failed' } }, 'failed'],
    [{ status: 'running', partial: true }, 'accepted'],
    [{ error: { code: 'OPERATION_CANCELLED' } }, 'cancelled'],
    [{ id: 'file', content: '正文' }, 'succeeded'],
    [{ _truncated: true }, 'unknown'],
  ]
  for (const [value, outcome] of cases) assert.equal(auditOutcome(auditResult(value)), outcome)
})

test('认证头完整脱敏，路径和复制目标保留，正文排除', () => {
  const parameters = auditParameters({
    commands: [
      "curl -H 'Authorization: Basic PRIVATE_BASE64' https://example.test",
      'curl -H "Proxy-Authorization: Basic PRIVATE_PROXY" https://example.test',
      "curl -H 'Cookie: session=PRIVATE_SESSION; second=PRIVATE_COOKIE' https://example.test",
    ],
    source_file_session_id: 'source', target_file_session_id: 'target', source_paths: ['/a'],
    target_dir: '/b', overwrite_policy: 'skip', content: '文件正文',
  })
  assert.doesNotMatch(JSON.stringify(parameters), /PRIVATE_|文件正文/)
  assert.equal(parameters.source_file_session_id, 'source')
  assert.equal(parameters.target_file_session_id, 'target')
  assert.equal(parameters.target_dir, '/b')
  assert.equal(parameters.overwrite_policy, 'skip')
  assert.deepEqual(parameters.source_paths, ['/a'])
})

test('有界投影保留截断标记和嵌套秘密隔离', () => {
  const paths = auditParameters({ paths: Array.from({ length: 90 }, () => '/a') })
  assert.equal(paths._truncated, true)
  const result = auditResult({ message: '文'.repeat(5000) })
  assert.equal(result._truncated, true)
  assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 16 * 1024)
  const parameters = auditParameters({ source: { secret_key: 'PRIVATE_VALUE', body: 'FILE_BODY' } })
  assert.doesNotMatch(JSON.stringify(parameters), /PRIVATE_VALUE|FILE_BODY/)
})
