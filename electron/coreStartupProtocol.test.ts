import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CoreStartupEventParser,
  coreStartupPrefix,
  parseCoreStartupEvent,
  sanitizeCoreStartupText,
  type CoreStartupEvent,
} from './coreStartupProtocol.ts'

const event: CoreStartupEvent = {
  protocol: 1, instanceId: 'instance-1', pid: 123, sequence: 1,
  at: '2026-09-07T12:00:00Z', phase: 'database',
  database: { status: 'running', operation: 'upgrade', fromVersion: 25, targetVersion: 37 },
}
const line = (value: unknown) => `${coreStartupPrefix}${JSON.stringify(value)}`

test('启动事件跨 UTF-8 字节拆包及多行读取仍保留具体中文原因', () => {
  const events: CoreStartupEvent[] = []
  const parser = new CoreStartupEventParser((item) => events.push(item))
  const failed: CoreStartupEvent = {
    ...event, sequence: 2, phase: 'failed', database: { ...event.database!, status: 'failed' },
    error: { code: 'DB_MIGRATION_FAILED', message: '磁盘空间不足', migrationVersion: 31, confirmedVersion: 30 },
  }
  const bytes = Buffer.from(`普通日志\n${line(event)}\r\n${line(failed)}`)
  for (let offset = 0; offset < bytes.length; offset += 1) parser.write(bytes.subarray(offset, offset + 1))
  parser.end()
  parser.end()
  assert.deepEqual(events, [event, failed])
})

test('拒绝非法协议、字段、版本和失败载荷，普通日志不作为启动事件', () => {
  const malformed = [
    { ...event, protocol: 2 }, { ...event, pid: -1 }, { ...event, sequence: 0 },
    { ...event, at: 'yesterday' }, { ...event, unexpected: 'field' },
    { ...event, phase: ['database'] },
    { ...event, database: { status: ['running'] } },
    { ...event, database: { status: 'running', operation: ['upgrade'] } },
    { ...event, database: { status: 'running', role: ['live'] } },
    { ...event, phase: 'failed', error: { code: ['DB_MIGRATION_FAILED'], message: '失败' } },
    { ...event, database: { status: 'running', targetVersion: -1 } },
    { ...event, phase: 'failed' },
    { ...event, error: { code: 'CORE_START_FAILED', message: '失败' } },
    { ...event, phase: 'failed', error: { code: 'DB_MIGRATION_FAILED', message: '失败', migrationFile: '../file.sql' } },
  ]
  for (const value of malformed) assert.equal(parseCoreStartupEvent(line(value)), null)
  assert.equal(parseCoreStartupEvent('Core 启动失败'), null)
  assert.equal(parseCoreStartupEvent(`${coreStartupPrefix}{`), null)
})

test('超长输出不会无限缓存，也不会将同一行尾部误识别为事件', () => {
  const events: CoreStartupEvent[] = []
  const parser = new CoreStartupEventParser((item) => events.push(item))
  parser.write('x'.repeat(17_000))
  parser.write(line(event))
  parser.write(`\n${line(event)}\n`)
  parser.end()
  assert.deepEqual(events, [event])
})

test('启动诊断隐藏认证信息并限制长度', () => {
  const safe = sanitizeCoreStartupText('https://user:pass@example.test/path?token=secret Authorization: Bearer abc API_KEY="sensitive value"')
  for (const secret of ['user:pass', 'secret', 'abc', 'sensitive value']) assert.equal(safe.includes(secret), false)
  assert.equal(sanitizeCoreStartupText('x'.repeat(5000)).length, 4096)
})

test('协议错误仅报告一次且不包含原始内容，普通日志不产生协议告警', () => {
  const reasons: string[] = []
  const parser = new CoreStartupEventParser(() => undefined, (reason) => reasons.push(reason))
  parser.write('普通错误日志\n')
  parser.write(`${coreStartupPrefix}{broken}\n${coreStartupPrefix}{broken again}\n`)
  parser.end()
  assert.deepEqual(reasons, ['invalid_message'])
})
