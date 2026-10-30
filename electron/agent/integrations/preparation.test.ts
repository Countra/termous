import assert from 'node:assert/strict'
import test from 'node:test'
import { IntegrationPreparation } from './preparation.ts'
import type { IntegrationPreparationSource } from '../contracts/integrations.ts'

function source(revision = 1): IntegrationPreparationSource {
  return { source: { id: 'fixture', name: 'Fixture', kind: 'mcp', revision, enabled: true, startup_confirmed: true,
    secret_configured: false, created_at: '', updated_at: '', mcp: { transport: 'http', url: 'http://fixture.invalid' } }, configuration_key: 'network-1' }
}

test('同一所有者重复准备合并，配置变更触发一次新准备，失败不自动重启', async () => {
  let configuration = source()
  let opens = 0
  let failures = 0
  const preparation = new IntegrationPreparation({ sources: async () => [configuration], open: async () => { opens++; throw new Error('fixture') }, release: () => {}, failed: () => { failures++ } })
  try {
    await Promise.all([preparation.start('session', 'owner'), preparation.start('session', 'owner')])
    await preparation.start('session', 'owner')
    assert.equal(opens, 1); assert.equal(failures, 1)
    configuration = { ...source(), configuration_key: 'network-2' }
    await preparation.start('session', 'owner')
    assert.equal(opens, 2)
    preparation.release('owner')
    await preparation.start('session', 'owner')
    assert.equal(opens, 3)
  } finally { preparation.close() }
})

test('离开页面取消其初始化，不取消其他 Run 的准备所有权', async () => {
  const signals = new Map<string, AbortSignal>()
  const preparation = new IntegrationPreparation({ sources: async () => [source()], open: async (_source, _session, owner, signal) => {
    signals.set(owner, signal)
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }))
  }, release: () => {}, failed: () => assert.fail('不应报告主动取消') })
  try {
    await preparation.refresh('session', 'page')
    await preparation.refresh('session', 'run')
    preparation.release('page')
    assert.equal(signals.get('page')?.aborted, true)
    assert.equal(signals.get('run')?.aborted, false)
  } finally { preparation.close() }
})

test('修改其他来源不会重启已失败的来源', async () => {
  const failed = source()
  let changed = { ...source(), source: { ...source().source, id: 'changed' } }
  const attempts: string[] = []
  const preparation = new IntegrationPreparation({ sources: async () => [failed, changed],
    open: async value => { attempts.push(value.source.id); if (value.source.id === 'fixture') throw new Error('fixture') },
    release: () => {}, failed: () => {} })
  try {
    await preparation.start('session', 'owner')
    changed = { ...changed, configuration_key: 'new-proxy' }
    await preparation.start('session', 'owner')
    assert.deepEqual(attempts, ['fixture', 'changed', 'changed'])
  } finally { preparation.close() }
})
