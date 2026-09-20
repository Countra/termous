import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeAuditWriter, type RuntimeAuditEvent } from './runtimeAuditWriter.ts'
import { auditParameters, auditResult } from './auditProjection.ts'

function event(id: string): RuntimeAuditEvent {
  return { id, tool_call_id: 'call-1', tool_name: 'termous.hosts.list', phase: 'start', outcome: 'started', occurred_at: new Date().toISOString(), duration_ms: 0 }
}

test('审计按批提交，失败有限重试且正常排空', async () => {
  let attempts = 0
  const batches: RuntimeAuditEvent[][] = []
  const writer = new RuntimeAuditWriter({ originalName: (name) => name, submit: async (items) => {
    attempts++
    if (attempts === 1) throw new Error('temporary')
    batches.push(items)
  } })
  for (let index = 0; index < 70; index++) writer.push(event(String(index)))
  await writer.close()
  assert.equal(batches.flat().length, 70)
  assert.ok(batches.every((batch) => batch.length <= 32))
  assert.equal(attempts, 4)
})

test('队列过载与持续故障不会抛给业务，关闭释放请求', async () => {
  let drops = 0
  let aborted = false
  const writer = new RuntimeAuditWriter({ originalName: () => null, warn: (count) => { drops = count }, submit: async (_items, signal) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted = true; reject(new Error('abort')) }, { once: true })
  }) })
  for (let index = 0; index < 1000; index++) writer.push(event(String(index)))
  assert.ok(drops > 0)
  const started = Date.now()
  await writer.close()
  assert.ok(Date.now() - started < 3000)
  assert.equal(aborted, true)
})

test('参数错误仍有开始和终态，正文和完整输出不会进入审计', async () => {
  const batches: RuntimeAuditEvent[] = []
  const writer = new RuntimeAuditWriter({ originalName: () => null, submit: async (items) => { batches.push(...items) } })
  writer.capture({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'unknown', args: { password: 'SECRET', content: 'BODY' } })
  writer.capture({ type: 'tool_execution_end', toolCallId: 'call-1', toolName: 'unknown', result: { content: [{ type: 'text', text: 'SECRET BODY' }], details: {} }, isError: true })
  await writer.close()
  assert.deepEqual(batches.map((item) => item.outcome), ['started', 'failed'])
  assert.doesNotMatch(JSON.stringify(batches), /SECRET|BODY/)
  const projected = { parameters: auditParameters({ command: 'curl --token SECRET https://u:p@host/?X-Amz-Signature=SIGNATURE', content: 'BODY', path: '/normal.txt' }), result: auditResult({ output: 'OUTPUT', status: 'failed', error: { code: 'FAILED', message: 'password=SECRET' } }) }
  assert.doesNotMatch(JSON.stringify(projected), /SECRET|SIGNATURE|BODY|OUTPUT|u:p/)
  assert.match(JSON.stringify(projected), /normal.txt/)
  const commands = auditParameters({ commands: [
    'curl -u "alice:PRIVATE_PASSWORD" https://host/',
    'wget --http-password=PRIVATE_PASSWORD https://host/',
    'curl https://host/?sig=PRIVATE_SIGNATURE',
    'Bearer PRIVATE_BEARER',
    '-----BEGIN PRIVATE KEY-----\nPRIVATE_MATERIAL\n-----END PRIVATE KEY-----',
  ] })
  assert.doesNotMatch(JSON.stringify(commands), /PRIVATE_PASSWORD|PRIVATE_SIGNATURE|PRIVATE_BEARER|PRIVATE_MATERIAL/)
})
