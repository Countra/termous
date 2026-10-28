import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { runtimeBootstrap, runtimeUserMessage } from '../../test-support/runtimeBootstrapTestFixture.ts'
import { runtimeToolResponse } from '../../test-support/runtimeToolResponseFixture.ts'
import { withToolDiscovery } from '../../test-support/runtimeDiscoveryTestFixture.ts'
import { testAgentSkillBundle } from '../../test-support/skillBundleTestFixture.ts'
import { mapMCPTools } from '../../tools/mcpClientAdapter.ts'
import { createPiAgent } from '../piAgentAdapter.ts'
import { RuntimeEventWriter } from '../runtimeEventWriter.ts'
import type { RuntimeEventInput } from '../../contracts/runtimeEvents.ts'
import type { DesktopTaskReceipt } from '../../contracts/desktopTasks.ts'

for (const api of ['chat_completions', 'responses'] as const) test(`${api} 后台期间独立工作、空闲挂起及完成观察只接续一次`, async () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.model.snapshot.api_mode = api
  bootstrap.model.snapshot.supports_images = true
  bootstrap.model.snapshot.context_window_tokens = 128000
  bootstrap.context.request_usage_supported = true
  bootstrap.context.progress_supported = true
  bootstrap.messages = [runtimeUserMessage([], { text: '启动应用，等待期间读取说明，完成后检查结果。' })]
  let requests = 0, reads = 0, recorded = false, wake: (() => void) | undefined
  let receipt: DesktopTaskReceipt = { tool_call_id: 'call_1', execution_id: 'desktop_execution_async', revision: 2,
    result: { run: { id: 'desktop_execution_async', revision: 2, client_request_id: 'req', attachment_id: 'att',
      target: { kind: 'protocol_session', protocol: { session_id: 'remote', connection_generation: 1 } },
      state: 'running', phase: 'waiting', accepted_actions: 1,
      steps: [{ index: 0, kind: 'keyboard.key', state: 'accepted', wait_after_ms: 30000 }] }, capture_state: 'pending' } }
  const events: RuntimeEventInput[] = []
  const mapped = mapMCPTools([
    { name: 'termous.desktops.execute', inputSchema: { type: 'object', properties: {} } },
    { name: 'termous.hosts.list', inputSchema: { type: 'object', properties: {} } },
  ], async tool => {
    if (tool.name === 'termous.hosts.list') { reads++; return { content: [{ type: 'text', text: 'Independent documentation is ready.' }] } }
    return { content: [{ type: 'text', text: JSON.stringify(receipt.result) }], structuredContent: receipt.result }
  })
  const writer = new RuntimeEventWriter({ start: { type: 'start', protocol_version: agentRuntimeProtocolVersion,
    core_base_url: 'http://127.0.0.1:8122', ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
    runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1, onFailure: error => { throw error },
    core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => {
        events.push(...batch)
        if (batch.some(event => event.kind === 'message_part' && (event.payload.message_part as { kind: string })?.kind === 'task_result')) recorded = true
        return batch[batch.length - 1]!.sequence
      }, appendSteer: async () => { throw new Error('无追加指令') }, commitCheckpoint: async () => { throw new Error('无压缩') } },
  })
  const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
    mcp: { tools: mapped.tools, originalName: name => mapped.originalNames.get(name) ?? null, close: async () => {} },
    commitCheckpoint: async () => { throw new Error('无压缩') },
    readHistoryImage: async () => ({ mime_type: 'image/png', data: 'aW1hZ2U=' }),
    readResourceImage: async () => 'aW1hZ2U=',
    readDesktopTasks: async (_cursor, waitMS, signal) => {
      if (waitMS && receipt.result.run.state === 'running') await new Promise<void>((resolve, reject) => {
        const abort = () => { signal?.removeEventListener('abort', abort); reject(signal?.reason) }
        wake = () => { signal?.removeEventListener('abort', abort); resolve() }
        signal?.addEventListener('abort', abort, { once: true })
      })
      return { cursor: String(receipt.revision).padStart(64, '0'), tasks: recorded ? [] : [{ tool_call_id: receipt.tool_call_id, client_request_id: 'req', generation: 1, execution_id: receipt.execution_id, receipt }] }
    },
    fetch: withToolDiscovery(async (_url, init) => {
      requests++
      assert.ok(requests <= 4, '不得空转或重复注入')
      if (requests === 4) {
        assert.match(String(init?.body), /Termous desktop task observation/)
        assert.match(String(init?.body), /data:image\/png;base64,aW1hZ2U=/)
      }
      return runtimeToolResponse(api, requests === 1 ? mapped.tools[0]!.name : requests === 2 ? mapped.tools[1]!.name : undefined, {}, String(requests))
    }, ['termous.desktops.execute', 'termous.hosts.list']),
  })
  try {
    const running = agent.continue()
    for (let i = 0; i < 100 && requests < 3; i++) await delay(5)
    assert.equal(requests, 3)
    assert.equal(reads, 1)
    await delay(30)
    assert.equal(requests, 3, '没有独立工作时不得发起模型请求')
    receipt = { ...receipt, revision: 4,
      image: { resource_id: 'agres_async', kind: 'image', mime_type: 'image/png', sha256: '6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d', size_bytes: 5, image: { width: 1, height: 1 } },
      result: { ...receipt.result, capture_state: 'ready', run: { ...receipt.result.run, revision: 4, state: 'completed', phase: 'finished' } } }
    wake?.()
    assert.equal(await running, 'completed', JSON.stringify(events.slice(-6)))
    await writer.flush()
    assert.equal(requests, 4)
    assert.equal(events.filter(event => event.kind === 'message_part' && (event.payload.message_part as { kind: string })?.kind === 'task_result').length, 1)
    assert.ok(events.some(event => event.kind === 'request_usage' && JSON.stringify(event.payload.request_usage).includes('desktop_execution_async')))
  } finally { agent.close(); await writer.close() }
})
