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

test('Core Runtime Client 使用受管 Supervisor 领取下一条持久任务', async () => {
  const requests: Array<{ url: string; body: unknown }> = []
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async (input, init) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(JSON.stringify({ run: { id: 'agr_queued', generation: 3 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch,
  })

  assert.deepEqual(await client.claimNextQueuedRun('supervisor-1'), {
    run_id: 'agr_queued', generation: 3,
  })
  assert.deepEqual(requests, [{
    url: 'http://127.0.0.1:8122/api/v1/agent/runtime/queue/claim-next',
    body: { supervisor_instance_id: 'supervisor-1' },
  }])
})

test('Core Runtime Client 将 claim-next 的 204 响应解析为空队列', async () => {
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async () => new Response(null, { status: 204 })) as typeof fetch,
  })

  assert.equal(await client.claimNextQueuedRun('supervisor-1'), null)
})

test('Core Runtime Client 严格校验 queued-turn steer 归属并发送 generation 与乐观锁字段', async () => {
  let requestedURL = ''
  let requestedBody: unknown
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async (input, init) => {
      requestedURL = String(input)
      requestedBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        queued_turn: { id: 'agt_next', revision: 5 },
        run: { id: 'agr_active', generation: 2, revision: 8 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch,
  })

  const result = await client.steerQueuedTurn({
    queued_turn_id: 'agt_next', expected_revision: 4,
    run_id: 'agr_active', generation: 2, expected_run_revision: 7,
  })
  assert.deepEqual(result, {
    queued_turn: { id: 'agt_next', revision: 5 },
    run: { run_id: 'agr_active', generation: 2, revision: 8 },
  })
  assert.equal(requestedURL, 'http://127.0.0.1:8122/api/v1/agent/queued-turns/agt_next/steer')
  assert.deepEqual(requestedBody, {
    expected_revision: 4,
    active_run_id: 'agr_active',
    expected_generation: 2,
    expected_run_revision: 7,
  })
})

test('Core Runtime Client 对可恢复的 claim-next 传输失败仅重试一次', async () => {
  let calls = 0
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async () => {
      calls += 1
      if (calls === 1) {
        throw new TypeError('response lost')
      }
      return new Response(JSON.stringify({ run: { id: 'agr_recovered', generation: 4 } }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch,
  })

  assert.deepEqual(await client.claimNextQueuedRun('supervisor-1'), {
    run_id: 'agr_recovered', generation: 4,
  })
  assert.equal(calls, 2)
})

test('Core Runtime Client 对可恢复的 queued-turn steer 传输失败仅重试一次', async () => {
  let calls = 0
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async () => {
      calls += 1
      if (calls === 1) {
        throw new TypeError('response lost')
      }
      return new Response(JSON.stringify({
        queued_turn: { id: 'agt_next', revision: 5 },
        run: { id: 'agr_active', generation: 2, revision: 8 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }) as typeof fetch,
  })

  const result = await client.steerQueuedTurn({
    queued_turn_id: 'agt_next', expected_revision: 4,
    run_id: 'agr_active', generation: 2, expected_run_revision: 7,
  })
  assert.equal(result.run.run_id, 'agr_active')
  assert.equal(calls, 2)
})

test('Core Runtime Client 不重试业务冲突', async () => {
  let calls = 0
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async () => {
      calls += 1
      return new Response(JSON.stringify({ code: 'AGENT_REVISION_CONFLICT' }), {
        status: 409, headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch,
  })

  await assert.rejects(
    () => client.claimNextQueuedRun('supervisor-1'),
    (error: unknown) => error instanceof AgentCoreRuntimeError
      && error.code === 'AGENT_REVISION_CONFLICT',
  )
  assert.equal(calls, 1)
})

test('Core Runtime Client 拒绝与请求归属不一致的队列响应', async () => {
  const client = new AgentCoreRuntimeClient({
    getConfig: async () => runtimeConfig(),
    fetch: (async () => new Response(JSON.stringify({
      queued_turn: { id: 'agt_other', revision: 5 },
      run: { id: 'agr_active', generation: 2, revision: 8 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as typeof fetch,
  })

  await assert.rejects(
    () => client.steerQueuedTurn({
      queued_turn_id: 'agt_next', expected_revision: 4,
      run_id: 'agr_active', generation: 2, expected_run_revision: 7,
    }),
    (error: unknown) => error instanceof AgentCoreRuntimeError
      && error.code === 'AGENT_RUNTIME_RESPONSE_INVALID',
  )
})
