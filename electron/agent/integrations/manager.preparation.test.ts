import assert from 'node:assert/strict'
import test from 'node:test'
import { IntegrationManager } from './manager.ts'
import type { IntegrationCorePort, IntegrationHostConfig, IntegrationToolDefinition } from '../contracts/integrations.ts'

const executable = process.env.TERMOUS_MCP_FIXTURE

test('新 Run 在候选验证失败后仍能发现当前版本工具，不循环重试候选', { skip: !executable, timeout: 10_000 }, async () => {
  const config: IntegrationHostConfig = { source: { id: 'fixture', kind: 'mcp', name: 'fixture', revision: 1, enabled: true,
    startup_confirmed: true, mcp: { transport: 'stdio', command: executable, args: ['--stdio'] }, secret_configured: false,
    created_at: '', updated_at: '' }, secret: {} }
  let directory: IntegrationToolDefinition[] = []
  let attempts = 0
  const failures: string[] = []
  let retried!: () => void
  const retryFinished = new Promise<void>(resolve => { retried = resolve })
  const core = {
    preparationSources: async () => [{ source: config.source, candidate_id: 'broken' }],
    config: async (_source: string, _revision: number, _signal?: AbortSignal, candidate?: string) => ({ ...config, candidate_id: candidate }),
    sources: async () => [config.source],
    saveTools: async (_source: string, _revision: number, tools: IntegrationToolDefinition[]) => { directory = tools },
    tools: async () => directory,
    activate: async () => { assert.fail('验证失败不能发布候选') },
  } as unknown as IntegrationCorePort
  const manager = new IntegrationManager(core, { ensureSupervised: async () => {}, superviseGroup: async () => {},
    installationLease: async () => {}, verifyLaunch: async value => {
      if (value.candidate_id) { attempts++; throw new Error('INTEGRATION_CONFIG_CHANGED') }
    }, report: code => { failures.push(code); if (attempts === 2) retried() } })
  const context = { run_id: 'run', session_id: 'session', generation: 1, bearer: 'fixture-only' }
  try {
    const result = await manager.directory(context)
    assert.ok('tools' in result && result.tools.some(tool => tool.name === 'echo'))
    assert.ok('sources' in result && !result.sources[0].unavailable_reason)
    await manager.directory(context)
    assert.equal(attempts, 1)
    assert.deepEqual(failures, ['INTEGRATION_CONFIG_CHANGED'])
    await manager.invalidate('fixture')
    await manager.directory(context)
    await retryFinished
    const reconnected = await manager.directory(context)
    assert.ok('tools' in reconnected && reconnected.tools.some(tool => tool.name === 'echo'))
    await manager.directory(context)
    assert.equal(attempts, 2, '显式重连应允许重新准备一次，后续目录读取不能循环重试')
  } finally { manager.release('run'); await manager.close() }
})
