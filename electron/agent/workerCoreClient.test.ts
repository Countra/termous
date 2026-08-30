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

  const wrongProviderResponse = bootstrapResponse()
  wrongProviderResponse.model.snapshot.provider_id = 'amp_other'
  const wrongProvider = new WorkerCoreClient({
    fetch: async () => Response.json(wrongProviderResponse),
  })
  await assert.rejects(wrongProvider.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const invalidRevisionResponse = bootstrapResponse()
  invalidRevisionResponse.model.snapshot.model_revision = 0
  const invalidRevision = new WorkerCoreClient({
    fetch: async () => Response.json(invalidRevisionResponse),
  })
  await assert.rejects(invalidRevision.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const invalidBaseURLResponse = bootstrapResponse()
  invalidBaseURLResponse.model.snapshot.base_url = 'https://user@example.test/v1'
  const invalidBaseURL = new WorkerCoreClient({
    fetch: async () => Response.json(invalidBaseURLResponse),
  })
  await assert.rejects(invalidBaseURL.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const invalidTokenRangeResponse = bootstrapResponse()
  invalidTokenRangeResponse.model.snapshot.max_output_tokens = 16_384
  const invalidTokenRange = new WorkerCoreClient({
    fetch: async () => Response.json(invalidTokenRangeResponse),
  })
  await assert.rejects(invalidTokenRange.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)
})

test('bootstrap 严格校验推理控制、支持档位及本次 Run 档位', async () => {
  const unsupportedRunResponse = bootstrapResponse()
  unsupportedRunResponse.run.reasoning_level = 'high'
  const unsupportedRun = new WorkerCoreClient({
    fetch: async () => Response.json(unsupportedRunResponse),
  })
  await assert.rejects(unsupportedRun.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const duplicateLevelsResponse = bootstrapResponse()
  duplicateLevelsResponse.model.snapshot.reasoning_control = 'openai_effort'
  duplicateLevelsResponse.model.snapshot.supported_reasoning_levels = ['off', 'high', 'high']
  const duplicateLevels = new WorkerCoreClient({
    fetch: async () => Response.json(duplicateLevelsResponse),
  })
  await assert.rejects(duplicateLevels.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const noneWithEffortResponse = bootstrapResponse()
  noneWithEffortResponse.model.snapshot.supported_reasoning_levels = ['off', 'low']
  const noneWithEffort = new WorkerCoreClient({
    fetch: async () => Response.json(noneWithEffortResponse),
  })
  await assert.rejects(noneWithEffort.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const effortWithoutLevelResponse = bootstrapResponse()
  effortWithoutLevelResponse.model.snapshot.reasoning_control = 'openai_effort'
  const effortWithoutLevel = new WorkerCoreClient({
    fetch: async () => Response.json(effortWithoutLevelResponse),
  })
  await assert.rejects(effortWithoutLevel.bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)

  const validMaxResponse = bootstrapResponse()
  validMaxResponse.run.reasoning_level = 'max'
  validMaxResponse.model.snapshot.reasoning_control = 'openai_effort'
  validMaxResponse.model.snapshot.supported_reasoning_levels = ['high', 'max']
  const validMax = new WorkerCoreClient({
    fetch: async () => Response.json(validMaxResponse),
  })
  await assert.doesNotReject(validMax.bootstrap(start))
})

test('bootstrap 冻结 Run 模型快照且不混淆内部模型 ID', async () => {
  const client = new WorkerCoreClient({
    fetch: async () => Response.json(bootstrapResponse()),
  })
  const bootstrap = await client.bootstrap(start)

  assert.equal(bootstrap.run.model_id, 'apm_model')
  assert.equal(bootstrap.model.snapshot.model_id, 'test-model')
  assert.equal(Object.isFrozen(bootstrap.model.snapshot), true)
  assert.equal(Object.isFrozen(bootstrap.model), false)
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

test('bootstrap 严格校验上下文 Checkpoint 与压缩计划', async () => {
  const valid = bootstrapResponse()
  valid.context = {
    estimated_tokens: 7000,
    warning: true,
    checkpoint: {
      boundary_message_sequence: 4,
      summary: '已压缩历史',
      estimated_tokens: 6000,
    },
    compression: {
      boundary_message_sequence: 8,
      source_hash: 'a'.repeat(64),
      estimated_tokens: 7000,
    },
  }
  await new WorkerCoreClient({ fetch: async () => Response.json(valid) }).bootstrap(start)

  const invalidHash = structuredClone(valid)
  invalidHash.context.compression!.source_hash = 'A'.repeat(64)
  await assert.rejects(
    new WorkerCoreClient({ fetch: async () => Response.json(invalidHash) }).bootstrap(start),
    /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
  )

  const emptySummary = structuredClone(valid)
  emptySummary.context.checkpoint!.summary = '   '
  await assert.rejects(
    new WorkerCoreClient({ fetch: async () => Response.json(emptySummary) }).bootstrap(start),
    /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
  )
})

test('Checkpoint 提交绑定 Run、generation、Bearer 并透传取消信号', async () => {
  let request: Request | undefined
  let requestSignal: AbortSignal | null | undefined
  const client = new WorkerCoreClient({
    fetch: async (input, init) => {
      request = new Request(input, init)
      requestSignal = init?.signal
      return Response.json({
        checkpoint: {
          boundary_message_sequence: 4,
          summary: '已压缩历史',
          estimated_tokens: 7000,
        },
      })
    },
  })
  const controller = new AbortController()
  const checkpoint = await client.commitCheckpoint(start, 'r'.repeat(48), {
    generation: 1,
    boundary_message_sequence: 4,
    source_hash: 'b'.repeat(64),
    summary: '已压缩历史',
  }, controller.signal)

  assert.equal(checkpoint.boundary_message_sequence, 4)
  assert.equal(request?.url, 'http://127.0.0.1:52000/api/v1/agent/runs/agr_test/runtime-checkpoints')
  assert.equal(request?.headers.get('authorization'), `Bearer ${'r'.repeat(48)}`)
  assert.equal(requestSignal?.aborted, false)
  assert.deepEqual(await request?.json(), {
    generation: 1,
    boundary_message_sequence: 4,
    source_hash: 'b'.repeat(64),
    summary: '已压缩历史',
  })
})

test('Checkpoint 提交拒绝跨 generation 和被替换的响应内容', async () => {
  const client = new WorkerCoreClient({
    fetch: async () => Response.json({
      checkpoint: {
        boundary_message_sequence: 5,
        summary: '已压缩历史',
        estimated_tokens: 7000,
      },
    }),
  })
  await assert.rejects(client.commitCheckpoint(start, 'r'.repeat(48), {
    generation: 2,
    boundary_message_sequence: 4,
    source_hash: 'b'.repeat(64),
    summary: '已压缩历史',
  }), /AGENT_RUNTIME_CHECKPOINT_INVALID/u)
  await assert.rejects(client.commitCheckpoint(start, 'r'.repeat(48), {
    generation: 1,
    boundary_message_sequence: 4,
    source_hash: 'b'.repeat(64),
    summary: '已压缩历史',
  }), /AGENT_RUNTIME_CHECKPOINT_RESPONSE_INVALID/u)

  const replacedSummaryClient = new WorkerCoreClient({
    fetch: async () => Response.json({
      checkpoint: {
        boundary_message_sequence: 4,
        summary: '异常替换摘要',
        estimated_tokens: 7000,
      },
    }),
  })
  await assert.rejects(replacedSummaryClient.commitCheckpoint(start, 'r'.repeat(48), {
    generation: 1,
    boundary_message_sequence: 4,
    source_hash: 'b'.repeat(64),
    summary: '已压缩历史',
  }), /AGENT_RUNTIME_CHECKPOINT_RESPONSE_INVALID/u)
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
      provider_id: 'amp_provider',
      model_id: 'apm_model',
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
        provider_id: 'amp_provider',
        provider_name: '本地 Provider',
        model_display_name: '测试模型',
        provider_revision: 3,
        model_revision: 5,
        context_window_tokens: 8192,
        max_output_tokens: 1024,
        supports_images: false,
        reasoning_control: 'none',
        supported_reasoning_levels: ['off'],
      },
      api_key: 'configured',
    },
    context: { estimated_tokens: 1280, warning: false },
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
