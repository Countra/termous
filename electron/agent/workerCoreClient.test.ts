import assert from 'node:assert/strict'
import test from 'node:test'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import type { AgentWorkerStartMessage } from './protocol.ts'
import { testAgentSkillBundle } from './skillBundleTestFixture.ts'
import {
  agentRuntimeBootstrapRequestTimeoutMs,
  agentRuntimeRequestTimeoutMs,
  WorkerCoreClient,
  type RuntimeBootstrap,
} from './workerCoreClient.ts'

const start: AgentWorkerStartMessage = {
  type: 'start',
  protocol_version: agentRuntimeProtocolVersion,
  core_base_url: 'http://127.0.0.1:52000',
  ticket: 't'.repeat(48),
  run_id: 'agr_test',
  generation: 1,
  skills: testAgentSkillBundle(),
}

test('bootstrap 独立使用大响应预算且不放宽普通 Runtime 请求', () => {
  assert.equal(agentRuntimeBootstrapRequestTimeoutMs, 60_000)
  assert.equal(agentRuntimeRequestTimeoutMs, 15_000)
  assert.ok(agentRuntimeBootstrapRequestTimeoutMs > agentRuntimeRequestTimeoutMs)
})

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

test('bootstrap 严格校验附件传输形状、数量与预解码长度', async () => {
  const valid = bootstrapResponse()
  valid.messages = [runtimeMessage()]
  const client = new WorkerCoreClient({ fetch: async () => Response.json(valid) })
  await client.bootstrap(start)

  const missingAttachments = bootstrapResponse()
  missingAttachments.messages = [runtimeMessage()]
  delete (missingAttachments.messages[0] as unknown as Record<string, unknown>).attachments
  await assert.rejects(
    new WorkerCoreClient({ fetch: async () => Response.json(missingAttachments) }).bootstrap(start),
    /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
  )

  const excessiveEnvelope = bootstrapResponse()
  excessiveEnvelope.messages = [runtimeMessage(Array.from({ length: 9 }, (_, index) => ({
    id: `aga_${index}`,
    kind: 'text' as const,
    mime_type: 'text/plain',
    content_base64: 'YQ==',
  })))]
  await assert.rejects(
    new WorkerCoreClient({ fetch: async () => Response.json(excessiveEnvelope) }).bootstrap(start),
    /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
  )

  const duplicateEnvelope = bootstrapResponse()
  duplicateEnvelope.messages = [runtimeMessage([
    runtimeMessage().attachments[0]!,
    runtimeMessage().attachments[0]!,
  ])]
  await assert.rejects(
    new WorkerCoreClient({ fetch: async () => Response.json(duplicateEnvelope) }).bootstrap(start),
    /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
  )
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

function runtimeMessage(
  attachments: RuntimeBootstrap['messages'][number]['attachments'] = [{
    id: 'aga_text',
    kind: 'text',
    mime_type: 'text/plain',
    content_base64: 'YQ==',
  }],
): RuntimeBootstrap['messages'][number] {
  return {
    id: 'agm_user',
    role: 'user',
    status: 'completed',
    sequence: 1,
    created_at: '2026-08-28T00:00:00Z',
    parts: [{
      id: 'agp_user',
      message_id: 'agm_user',
      kind: 'text',
      sequence: 1,
      content: { text: { text: 'hello' } },
    }],
    attachments,
  }
}
