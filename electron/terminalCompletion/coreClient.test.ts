import assert from 'node:assert/strict'
import test from 'node:test'
import { TerminalCompletionCoreClient } from './coreClient.ts'
import { completionTestBootstrap, completionTestRequest } from './testFixture.ts'
import { agentRuntimeProtocolVersion } from '#common/contracts'

test('凭据bootstrap只通过本地Core和活Supervisor租约，完整传递快照并禁止重定向', async () => {
  const request = completionTestRequest()
  const client = new TerminalCompletionCoreClient({
    getConfig: async () => ({ apiBaseUrl: 'http://127.0.0.1:19000', wsBaseUrl: 'ws://127.0.0.1:19000', apiToken: 'core-key', version: '0.0.0', managed: false }),
    getLease: () => ({ supervisor_instance_id: 'supervisor_test', core_instance_id: 'core_test', revision: 1, expires_at: '2099-01-01T00:00:00Z', runtime_protocol_version: agentRuntimeProtocolVersion }),
    fetch: async (url, init) => {
      assert.equal(String(url), 'http://127.0.0.1:19000/api/v1/sessions/session_test/completions/ai/bootstrap')
      assert.equal(init?.redirect, 'error')
      assert.equal(new Headers(init?.headers).get('X-Termous-Token'), 'core-key')
      const body = JSON.parse(String(init?.body))
      assert.equal(body.supervisor_instance_id, 'supervisor_test')
      assert.equal(body.input_snapshot.prompt_generation, 3)
      assert.equal(body.input_snapshot.cursor_utf16, 2)
      assert.equal(body.input_snapshot.revision, 7)
      return Response.json(completionTestBootstrap())
    },
  })
  assert.deepEqual(await client.bootstrap(request, new AbortController().signal), completionTestBootstrap())
})

test('Core错误仅保留稳定code，响应中的私有正文不进入异常', async () => {
  const client = new TerminalCompletionCoreClient({
    getConfig: async () => ({ apiBaseUrl: 'http://127.0.0.1:19000', wsBaseUrl: 'ws://127.0.0.1:19000', apiToken: '', version: '0.0.0', managed: false }),
    getLease: () => ({ supervisor_instance_id: 'supervisor_test', core_instance_id: 'core_test', revision: 1, expires_at: '2099-01-01T00:00:00Z', runtime_protocol_version: agentRuntimeProtocolVersion }),
    fetch: async () => Response.json({ code: 'TERMINAL_AI_STALE', message: 'private-context' }, { status: 409 }),
  })
  await assert.rejects(client.bootstrap(completionTestRequest(), new AbortController().signal), (error: unknown) =>
    error instanceof Error && error.message === 'TERMINAL_AI_STALE')
})

test('异常超大bootstrap在128KiB处停止读取并释放响应流', async () => {
  let cancelled = false
  const client = new TerminalCompletionCoreClient({
    getConfig: async () => ({ apiBaseUrl: 'http://127.0.0.1:19000', wsBaseUrl: 'ws://127.0.0.1:19000', apiToken: '', version: '0.0.0', managed: false }),
    getLease: () => ({ supervisor_instance_id: 'supervisor_test', core_instance_id: 'core_test', revision: 1, expires_at: '2099-01-01T00:00:00Z', runtime_protocol_version: agentRuntimeProtocolVersion }),
    fetch: async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(64 * 1024)) },
      cancel() { cancelled = true },
    })),
  })
  await assert.rejects(client.bootstrap(completionTestRequest(), new AbortController().signal), /TERMINAL_AI_BOOTSTRAP_INVALID/u)
  assert.equal(cancelled, true)
})
