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
  type RuntimeCheckpointInput,
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

test('bootstrap 严格校验可信 SSH 资源绑定且拒绝未声明字段', async () => {
  const valid = bootstrapResponse()
  valid.session.resource_bindings = [runtimeResourceBinding()]
  const accepted = await new WorkerCoreClient({
    fetch: async () => Response.json(valid),
  }).bootstrap(start)
  assert.deepEqual(accepted.session.resource_bindings?.[0], runtimeResourceBinding())
  assert.equal(Object.isFrozen(accepted.session.resource_bindings?.[0]), true)

  for (const mutate of [
    (value: Record<string, unknown>) => { value.kind = 'file_session' },
    (value: Record<string, unknown>) => { value.session_id = 'ses invalid' },
    (value: Record<string, unknown>) => { value.platform = 'windows' },
    (value: Record<string, unknown>) => { value.bound_at = 'not-a-time' },
    (value: Record<string, unknown>) => { value.host_address = '192.0.2.1' },
    (value: Record<string, unknown>) => { delete value.ssh_profile_id },
  ]) {
    const response = bootstrapResponse()
    response.session.resource_bindings = [runtimeResourceBinding()]
    mutate(response.session.resource_bindings[0] as unknown as Record<string, unknown>)
    await assert.rejects(
      new WorkerCoreClient({ fetch: async () => Response.json(response) }).bootstrap(start),
      /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
    )
  }
})

test('bootstrap 严格校验可信 SSH Profile 绑定且冻结规范快照', async () => {
  const valid = bootstrapResponse()
  valid.session.resource_bindings = [runtimeSSHProfileBinding()]
  const accepted = await new WorkerCoreClient({
    fetch: async () => Response.json(valid),
  }).bootstrap(start)
  assert.deepEqual(accepted.session.resource_bindings?.[0], runtimeSSHProfileBinding())
  assert.equal(Object.isFrozen(accepted.session.resource_bindings?.[0]), true)

  for (const mutate of [
    (value: Record<string, unknown>) => { value.ssh_profile_name = '  ' },
    (value: Record<string, unknown>) => { value.ssh_profile_id = 'ssh invalid' },
    (value: Record<string, unknown>) => { value.platform = 'windows' },
    (value: Record<string, unknown>) => { value.session_id = 'ses_not_allowed' },
    (value: Record<string, unknown>) => { delete value.host_id },
  ]) {
    const response = bootstrapResponse()
    response.session.resource_bindings = [runtimeSSHProfileBinding()]
    mutate(response.session.resource_bindings[0] as unknown as Record<string, unknown>)
    await assert.rejects(
      new WorkerCoreClient({ fetch: async () => Response.json(response) }).bootstrap(start),
      /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
    )
  }
})

test('bootstrap 冻结双资源，拒绝重复类型和原文件会话 ID，并对账旧投影', async () => {
  const ssh = runtimeResourceBinding()
  const file = { kind: 'file_profile' as const, file_access_profile_id: 'file_one', file_access_profile_name: '文件配置',
    host_id: 'file_host', host_name: '文件主机', ssh_profile_id: 'file_ssh', engine: 'sftp' as const, bound_at: ssh.bound_at }
  const bootstrap = (session: Record<string, unknown>) => new WorkerCoreClient({ fetch: async () => Response.json({
    ...bootstrapResponse(), session: { ...bootstrapResponse().session, ...session },
  }) }).bootstrap(start)
  const accepted = await bootstrap({ resource_bindings: [file, ssh], resource_binding: ssh })
  assert.deepEqual(accepted.session.resource_bindings, [ssh, file])
  assert.equal(Object.isFrozen(accepted.session.resource_bindings), true)
  assert.equal(Object.isFrozen(accepted.session.resource_bindings?.[1]), true)
  assert.equal('resource_binding' in accepted.session, false)
  for (const resources of [[ssh, ssh], [file, file], [ssh, file, file], [null], null,
    [{ ...file, file_session_id: 'desktop_file_session' }], [{ ...file, engine: 'unknown' }]]) {
    await assert.rejects(bootstrap({ resource_bindings: resources }), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)
  }
  await assert.rejects(bootstrap({ resource_bindings: [file], resource_binding: ssh }), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)
  assert.deepEqual((await bootstrap({ resource_binding: ssh })).session.resource_bindings, [ssh])

  const profile = runtimeSSHProfileBinding()
  assert.deepEqual((await bootstrap({ resource_bindings: [file, profile] })).session.resource_bindings, [profile, file])
  await assert.rejects(bootstrap({ resource_bindings: [ssh, profile] }), /AGENT_RUNTIME_BOOTSTRAP_INVALID/)
  await assert.rejects(
    bootstrap({ resource_bindings: [profile], resource_binding: ssh }),
    /AGENT_RUNTIME_BOOTSTRAP_INVALID/,
  )
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
  assert.equal(Object.isFrozen(bootstrap.session), true)
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

test('bootstrap 兼容旧 Checkpoint 并严格校验版本化快照', async () => {
  const valid = bootstrapResponse()
  valid.context = {
    estimated_tokens: 7000, warning: true,
    checkpoint: { boundary_message_sequence: 4, summary: '已压缩历史', estimated_tokens: 6000 },
  }
  await new WorkerCoreClient({ fetch: async () => Response.json(valid) }).bootstrap(start)
  valid.context.checkpoint = checkpointResponse().checkpoint
  await new WorkerCoreClient({ fetch: async () => Response.json(valid) }).bootstrap(start)
  for (const invalid of [
    { ...valid.context.checkpoint, summary: '   ' },
    { ...valid.context.checkpoint, retained_tail: [{ role: 'toolResult' }] },
    { ...valid.context.checkpoint, image_sources: [{ type: 'image_ref' }] },
  ]) {
    await assert.rejects(new WorkerCoreClient({ fetch: async () => Response.json({
      ...valid, context: { ...valid.context, checkpoint: invalid },
    }) }).bootstrap(start), /AGENT_RUNTIME_BOOTSTRAP_INVALID/u)
  }
})

test('bootstrap 的新旧 Checkpoint 工具参数拒绝 JSON 解析后溢出的数值', async () => {
  for (const version of [undefined, 1, 2]) {
    const body = JSON.stringify({
      ...bootstrapResponse(),
      context: { estimated_tokens: 7000, warning: true, checkpoint: {
        ...checkpointResponse().checkpoint, version, boundary_message_sequence: 4,
        retained_tail: [{
          role: 'assistant', timestamp: 1, api: 'openai-completions', provider: 'test', model: 'test',
          stopReason: 'toolUse',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          content: [{ type: 'toolCall', id: 'call-json', name: 'test_tool', arguments: { nested: ['NUMBER'] } }],
        }],
      } },
    })
    await new WorkerCoreClient({ fetch: async () => new Response(body.replace('"NUMBER"', '1.5')) }).bootstrap(start)
    await assert.rejects(
      new WorkerCoreClient({ fetch: async () => new Response(body.replace('"NUMBER"', '1e400')) }).bootstrap(start),
      /AGENT_RUNTIME_BOOTSTRAP_INVALID/u,
    )
  }
})

test('Checkpoint 提交绑定 Run、generation、Bearer 并透传取消信号', async () => {
  let request: Request | undefined
  let requestSignal: AbortSignal | null | undefined
  const client = new WorkerCoreClient({ fetch: async (input, init) => {
    request = new Request(input, init)
    requestSignal = init?.signal
    return Response.json(checkpointResponse())
  } })
  const controller = new AbortController()
  const result = await client.commitCheckpoint(start, 'r'.repeat(48), checkpointInput(), controller.signal)
  assert.equal(result.checkpoint.version, 2)
  assert.equal(result.last_sequence, 4)
  assert.equal(request?.url, 'http://127.0.0.1:52000/api/v1/agent/runs/agr_test/runtime-checkpoints')
  assert.equal(request?.headers.get('authorization'), 'Bearer ' + 'r'.repeat(48))
  assert.equal(requestSignal?.aborted, false)
  assert.deepEqual(await request?.json(), checkpointInput())
})

test('Checkpoint 拒绝跨 generation、水位和被替换的摘要响应', async () => {
  const client = new WorkerCoreClient({ fetch: async () => Response.json(checkpointResponse()) })
  await assert.rejects(client.commitCheckpoint(start, 'r'.repeat(48), {
    ...checkpointInput(), generation: 2,
  }), /AGENT_RUNTIME_CHECKPOINT_INVALID/u)
  await assert.rejects(client.commitCheckpoint(start, 'r'.repeat(48), {
    ...checkpointInput(), covered_event_sequence: 4,
  }), /AGENT_RUNTIME_CHECKPOINT_INVALID/u)
  for (const altered of [
    { generation: 2 }, { run_id: 'agr_other' },
    { summary: '异常替换摘要' }, { covered_event_sequence: 0 },
  ]) {
    const response = checkpointResponse()
    Object.assign(response.checkpoint, altered)
    await assert.rejects(new WorkerCoreClient({ fetch: async () => Response.json(response) })
      .commitCheckpoint(start, 'r'.repeat(48), checkpointInput()), /AGENT_RUNTIME_CHECKPOINT_RESPONSE_INVALID/u)
  }
})

test('Checkpoint 响应丢失只使用完全相同的请求重试一次', async () => {
  const requests: string[] = []
  const client = new WorkerCoreClient({ fetch: async (_input, init) => {
    requests.push(String(init?.body))
    if (requests.length === 1) throw new TypeError('connection lost')
    return Response.json(checkpointResponse())
  } })
  await client.commitCheckpoint(start, 'r'.repeat(48), checkpointInput())
  assert.equal(requests.length, 2)
  assert.equal(requests[0], requests[1])
  let attempts = 0
  const conflict = new WorkerCoreClient({ fetch: async () => {
    attempts += 1
    return Response.json({ error: { code: 'AGENT_RUNTIME_CHECKPOINT_CONFLICT' } }, { status: 409 })
  } })
  await assert.rejects(conflict.commitCheckpoint(start, 'r'.repeat(48), checkpointInput()))
  assert.equal(attempts, 1)
})

function checkpointInput(): RuntimeCheckpointInput {
  return {
    generation: 1, event_id: 'age_complete', sequence: 4,
    compaction_id: 'agc_test', base_checkpoint_id: '', covered_event_sequence: 2,
    summary: '已压缩历史', retained_tail: [], tokens_before: 7000, tokens_after: 1000,
  }
}

function checkpointResponse() {
  return {
    last_sequence: 4,
    checkpoint: {
      id: 'agc_test', version: 2 as const, boundary_message_sequence: 0,
      summary: '已压缩历史', estimated_tokens: 1000,
      retained_tail: [], image_sources: [], run_id: 'agr_test', generation: 1,
      covered_event_sequence: 2,
    },
  }
}

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

function runtimeResourceBinding(): Extract<NonNullable<RuntimeBootstrap['session']['resource_bindings']>[number], { kind: 'ssh_session' }> {
  return {
    kind: 'ssh_session',
    session_id: 'ses_runtime_test',
    host_id: 'hst_runtime_test',
    ssh_profile_id: 'ssh_runtime_test',
    host_name: 'Production',
    platform: 'linux',
    bound_at: '2026-08-31T02:20:30Z',
  }
}

function runtimeSSHProfileBinding(): Extract<NonNullable<RuntimeBootstrap['session']['resource_bindings']>[number], { kind: 'ssh_profile' }> {
  return {
    kind: 'ssh_profile',
    ssh_profile_id: 'ssh_runtime_test',
    ssh_profile_name: 'Production deploy',
    host_id: 'hst_runtime_test',
    host_name: 'Production',
    platform: 'linux',
    bound_at: '2026-08-31T02:20:30Z',
  }
}
