import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { AgentCoreRuntimeClient, AgentCoreRuntimeError } from './coreRuntimeClient.ts'

const skillsBundle = {
  status: 'ready',
  fingerprint: 'a'.repeat(64),
  skill_count: 2,
  resource_count: 4,
} as const

function runtimeConfig(apiBaseUrl = 'http://127.0.0.1:8122') {
  return {
    apiBaseUrl,
    apiToken: 'core-token',
    version: 'test',
    managed: false,
  }
}

test('Core Runtime Client 仅向本地 Core 发送主进程 Token', async () => {
  let requestedURL = ''
  let requestedInit: RequestInit | undefined
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async (input, init) => {
      requestedURL = String(input)
      requestedInit = init
      return new Response(JSON.stringify({
        core_instance_id: 'core-1',
        supervisor_instance_id: 'supervisor-1',
        runtime_protocol_version: agentRuntimeProtocolVersion,
        revision: 1,
        expires_at: '2030-01-01T00:00:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch,
  })

  const lease = await client.registerSupervisor('supervisor-1', skillsBundle)
  assert.equal(lease.core_instance_id, 'core-1')
  assert.equal(requestedURL, 'http://127.0.0.1:8122/api/v1/agent/runtime/supervisor')
  assert.equal(new Headers(requestedInit?.headers).get('X-Termous-Token'), 'core-token')
  assert.equal(requestedInit?.redirect, 'error')
  assert.equal(requestedInit?.cache, 'no-store')
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    supervisor_instance_id: 'supervisor-1',
    runtime_protocol_version: agentRuntimeProtocolVersion,
    skills_bundle: skillsBundle,
  })
})

test('Core Runtime Client 在请求前拒绝非本地地址', async () => {
  let called = false
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig('https://example.com'),
    fetch: (async () => {
      called = true
      return new Response(null, { status: 204 })
    }) as typeof fetch,
  })

  await assert.rejects(
    () => client.registerSupervisor('supervisor-1', skillsBundle),
    (error: unknown) => error instanceof AgentCoreRuntimeError
      && error.code === 'AGENT_RUNTIME_CORE_URL_INVALID',
  )
  assert.equal(called, false)
})
