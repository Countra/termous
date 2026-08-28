import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { AgentWorkerStartMessage } from './protocol.ts'
import { WorkerCoreClient, type RuntimeBootstrap } from './workerCoreClient.ts'

const start: AgentWorkerStartMessage = {
  type: 'start',
  protocol_version: agentRuntimeProtocolVersion,
  core_base_url: 'http://127.0.0.1:52000',
  ticket: 't'.repeat(48),
  run_id: 'agr_test',
  generation: 1,
}

test('已取消的 bootstrap signal 在发起 fetch 前生效', async () => {
  let aborted = false
  const client = new WorkerCoreClient({
    fetch: async (_input, init) => {
      aborted = init?.signal?.aborted === true
      throw new DOMException('cancelled', 'AbortError')
    },
  })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    client.bootstrap(start, controller.signal),
    (error: unknown) => (error as { code?: unknown }).code === 'AGENT_RUNTIME_REQUEST_ABORTED',
  )
  assert.equal(aborted, true)
})

test('bootstrap 拒绝空 API Key 和超长运行凭据', async () => {
  const response = bootstrapResponse()
  response.model.api_key = ''
  const emptyKey = new WorkerCoreClient({
    fetch: async () => Response.json(response),
  })
  await assert.rejects(emptyKey.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  delete response.model.api_key
  response.runtime_bearer = 'r'.repeat(4097)
  const oversizedBearer = new WorkerCoreClient({
    fetch: async () => Response.json(response),
  })
  await assert.rejects(oversizedBearer.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const oversizedMCPBearerResponse = bootstrapResponse()
  oversizedMCPBearerResponse.mcp.bearer_token = 'm'.repeat(4097)
  const oversizedMCPBearer = new WorkerCoreClient({
    fetch: async () => Response.json(oversizedMCPBearerResponse),
  })
  await assert.rejects(oversizedMCPBearer.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const oversizedAPIKeyResponse = bootstrapResponse()
  oversizedAPIKeyResponse.model.api_key = 'k'.repeat(16 * 1024 + 1)
  const oversizedAPIKey = new WorkerCoreClient({
    fetch: async () => Response.json(oversizedAPIKeyResponse),
  })
  await assert.rejects(oversizedAPIKey.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)
})

test('bootstrap 绑定 Run、generation、Session 与 reasoning 枚举', async () => {
  const response = bootstrapResponse()
  response.session.id = 'ags_other'
  const wrongSession = new WorkerCoreClient({
    fetch: async () => Response.json(response),
  })
  await assert.rejects(wrongSession.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const wrongReasoningResponse = bootstrapResponse() as unknown as {
    run: { reasoning_level: string }
  }
  wrongReasoningResponse.run.reasoning_level = 'ultra'
  const wrongReasoning = new WorkerCoreClient({
    fetch: async () => Response.json(wrongReasoningResponse),
  })
  await assert.rejects(wrongReasoning.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)
})

function bootstrapResponse(): RuntimeBootstrap {
  return {
    core_instance_id: 'core-1',
    run: {
      id: start.run_id,
      session_id: 'ags_test',
      generation: start.generation,
      event_sequence: 1,
      status: 'starting',
      assistant_message_id: 'agm_reply',
      reasoning_level: 'off',
    },
    session: { id: 'ags_test' },
    messages: [],
    runtime_bearer: 'r'.repeat(48),
    mcp: {
      endpoint: '/mcp',
      bearer_token: 'm'.repeat(48),
      protocol_version: '2025-11-25',
    },
    model: {
      snapshot: {
        api_mode: 'responses',
        base_url: 'http://127.0.0.1:11434/v1',
        model_id: 'test-model',
        context_window_tokens: 8192,
        max_output_tokens: 1024,
        supports_images: false,
        supports_reasoning: false,
      },
      api_key: 'configured',
    },
  }
}
