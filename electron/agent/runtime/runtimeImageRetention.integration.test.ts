import assert from 'node:assert/strict'
import test from 'node:test'
import type { ToolResultMessage } from '@earendil-works/pi-ai'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { withToolDiscovery } from '../test-support/runtimeDiscoveryTestFixture.ts'
import { runtimeToolResponse } from '../test-support/runtimeToolResponseFixture.ts'
import { compactionTestAssistant } from '../test-support/runtimeCompactionTestFixture.ts'
import { mapMCPTools } from '../tools/mcpClientAdapter.ts'
import { createPiAgent } from './piAgentAdapter.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import { RuntimeContextImages } from '../context/runtimeContextImages.ts'
import { RuntimeImageWorkingSet } from '../context/runtimeImageWorkingSet.ts'
import { ownRuntimeImageMessages } from '../context/runtimeImageLifetime.ts'
import { isRuntimeCheckpointInput } from '../contracts/runtimeCheckpoint.ts'

for (const api of ['chat_completions', 'responses'] as const) {
  for (const restored of [false, true]) test(`${api} ${restored ? '恢复检查点' : '新会话'}长工具轮释放图片，持久化完整且可重读历史像素`, async () => {
    const bootstrap = runtimeBootstrap()
    bootstrap.model.snapshot.api_mode = api
    bootstrap.model.snapshot.supports_images = true
    bootstrap.model.snapshot.context_window_tokens = 128000
    bootstrap.messages = [runtimeUserMessage([])]
    const live: ToolResultMessage[] = []
    const persisted: unknown[] = []
    let captures = 0
    let reread = false
    const mapped = mapMCPTools([{ name: 'termous.desktops.capture', annotations: { readOnlyHint: true },
      inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], async () => {
      captures++
      return { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.alloc(32 * 1024, captures).toString('base64') }],
        structuredContent: { capture: { screenshot_id: `capture-${captures}`, metadata: { connection_generation: 1 } } } }
    })
    if (restored) {
      const previous = [1, 2, 3].map(index => ({ ...screenshot(`restored-${index}`), toolName: mapped.tools[0]!.name }))
      const registry = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
      previous.forEach((message, index) => registry.registerToolResult(`agp_restored_${index}`, message))
      bootstrap.context.checkpoint = { id: 'agc_restored', version: 2, summary: '继续已有桌面任务',
        boundary_message_sequence: 1, estimated_tokens: 100, run_id: 'agr_previous', generation: 1, covered_event_sequence: 1,
        retained_tail: previous.flatMap(message => [{ ...compactionTestAssistant(''), stopReason: 'toolUse' as const,
          content: [{ type: 'toolCall' as const, id: message.toolCallId, name: message.toolName, arguments: {} }],
        }, message]),
        image_sources: previous.map(message => {
          const image = message.content.find(block => block.type === 'image')!
          return registry.reference(image.mimeType, image.data)
        }),
      }
    }
    const before = structuredClone(bootstrap)
    const writer = new RuntimeEventWriter({
      start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122',
        ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
      runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1, onFailure: error => assert.fail(String(error)),
      core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
        appendEvents: async (_start, _bearer, batch) => {
          // 保留实际事件对象，验证运行时淘汰不会回写已交付的历史内容块。
          for (const event of batch) if (event.kind === 'message_part') persisted.push(event.payload)
          return batch[batch.length - 1]!.sequence
        }, appendSteer: async () => { throw new Error('不应追加指令') },
        commitCheckpoint: async () => { throw new Error('不应压缩短上下文') } },
    })
    const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
      mcp: { ...mapped, originalName: name => mapped.originalNames.get(name) ?? null, close: async () => {} },
      audit: { capture: event => { if (event.type === 'message_end' && event.message.role === 'toolResult'
        && [mapped.tools[0]!.name, 'read_history_image'].includes(event.message.toolName)) live.push(event.message) } },
      readHistoryImage: async reference => {
        assert.ok(reference.message_part_id)
        assert.equal(reference.content_index, 0)
        reread = true
        return { data: Buffer.alloc(32 * 1024, 1).toString('base64'), mime_type: 'image/png' }
      },
      commitCheckpoint: async () => { throw new Error('不应压缩短上下文') },
      fetch: withToolDiscovery(async (_input, init) => {
        const body = String(init?.body)
        assert.equal((body.match(api === 'responses' ? /"type":"input_image"/gu : /"type":"image_url"/gu) ?? []).length,
          Math.min(captures + (restored ? 3 : 0), 2))
        assert.ok(imageCount(live) <= 2)
        assert.ok(live.every(message => !JSON.stringify(message.details).includes('"type":"image"')))
        if (captures === 24 && !reread) {
          const history = live[0]!.content[0]!
          assert.equal(history.type, 'text')
          const reference = JSON.parse((history as { text: string }).text).history_image
          return runtimeToolResponse(api, 'read_history_image', { reference }, 'history-first')
        }
        return runtimeToolResponse(api, captures < 24 ? mapped.tools[0]!.name : undefined, {}, `capture-${captures}`)
      }, mapped.tools.map(tool => tool.name)),
    })
    try {
      assert.equal(await agent.continue(), 'completed')
      await writer.flush()
      assert.equal(captures, 24)
      assert.equal(reread, true)
      assert.equal(imageCount(live), 2)
      assert.deepEqual(live[live.length - 1]!.content.find(block => block.type === 'image'),
        { type: 'image', data: Buffer.alloc(32 * 1024, 1).toString('base64'), mimeType: 'image/png' })
      assert.equal((JSON.stringify(persisted).match(/"type":"image"/gu) ?? []).length, 25)
      assert.deepEqual(bootstrap, before)
    } finally { agent.close(); await writer.close() }
  })
}

test('Core 未确认持久化时保留图片，回写失败后停止而不继续淘汰或调用工具', { timeout: 10000 }, async () => {
  const bootstrap = runtimeBootstrap()
  bootstrap.model.snapshot.supports_images = true
  bootstrap.model.snapshot.context_window_tokens = 128000
  bootstrap.messages = [runtimeUserMessage([])]
  const live: ToolResultMessage[] = []
  const failures: unknown[] = []
  let captures = 0
  let notifyWrite!: () => void
  const writing = new Promise<void>(resolve => { notifyWrite = resolve })
  let rejectWrite!: (error: Error) => void
  const pendingWrite = new Promise<never>((_resolve, reject) => { rejectWrite = reject })
  const mapped = mapMCPTools([{ name: 'termous.desktops.capture', annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {}, additionalProperties: false } }], async () => {
    captures++
    return { content: [{ type: 'image', mimeType: 'image/png', data: Buffer.from(String(captures)).toString('base64') }] }
  })
  const writer = new RuntimeEventWriter({
    start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122',
      ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills: testAgentSkillBundle() },
    runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1,
    onFailure: error => { failures.push(error); agent.abort() },
    core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
      appendEvents: async (_start, _bearer, batch) => {
        if (live.length === 3) { notifyWrite(); return pendingWrite }
        return batch[batch.length - 1]!.sequence
      }, appendSteer: async () => { throw new Error('不应追加指令') },
      commitCheckpoint: async () => { throw new Error('不应压缩短上下文') } },
  })
  const agent = createPiAgent({ bootstrap, events: writer, skills: testAgentSkillBundle(),
    mcp: { ...mapped, originalName: name => mapped.originalNames.get(name) ?? null, close: async () => {} },
    audit: { capture: event => { if (event.type === 'message_end' && event.message.role === 'toolResult'
      && event.message.toolName === mapped.tools[0]!.name) live.push(event.message) } },
    commitCheckpoint: async () => { throw new Error('不应压缩短上下文') },
    fetch: withToolDiscovery(async () => runtimeToolResponse('chat_completions', mapped.tools[0]!.name, {}, `capture-${captures}`),
      mapped.tools.map(tool => tool.name)),
  })
  const running = agent.continue()
  try {
    await writing
    assert.equal(imageCount(live), 3)
    rejectWrite(new Error('fixture persistence failed'))
    await running
    assert.equal(failures.length, 1)
    assert.equal(captures, 3)
    assert.equal(imageCount(live), 3)
    await assert.rejects(writer.flush(), /fixture persistence failed/u)
  } finally {
    rejectWrite(new Error('fixture persistence failed'))
    agent.abort()
    await running
    agent.close()
    await assert.rejects(writer.close(), /fixture persistence failed/u)
  }
})

test('检查点移除 MCP 重复图片正文，保留元数据且符合原有信封上限', () => {
  const message = screenshot('large', Buffer.alloc(768 * 1024).toString('base64'))
  const before = structuredClone(message)
  const images = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
  images.registerToolResult('agp_large', message)
  const tail = images.serialize([message])
  const input = { generation: 1, event_id: 'age_checkpoint', sequence: 3, compaction_id: 'agc_checkpoint',
    base_checkpoint_id: '', covered_event_sequence: 2, summary: '保留截图引用', retained_tail: tail, tokens_before: 2000, tokens_after: 1000 }
  assert.equal(isRuntimeCheckpointInput(input, 1), true)
  assert.ok(Buffer.byteLength(JSON.stringify(input)) < 2048)
  assert.deepEqual(message, before)
  assert.match(JSON.stringify(tail), /image_ref/u)
  assert.match(JSON.stringify(tail), /screenshot_id/u)
})

test('待确认预览与最近两组全部图片保持可用，释放共享尾部不改写调用方启动数据', () => {
  const original = [screenshot('preview'), ...[1, 2, 3].map(n => screenshot(String(n)))]
  original[0]!.toolName = 'termous.desktop_workflows.templates.preview'
  original[0]!.content.push({ type: 'text', text: '{"preview":{"preview_id":"pending","expires_at":"2099-01-01T00:00:00Z"}}' })
  original[3]!.content.push(screenshot('second-image').content[0]!)
  const before = structuredClone(original)
  const messages = ownRuntimeImageMessages(original) as ToolResultMessage[]
  const images = new RuntimeContextImages({ context: { estimated_tokens: 0, warning: false }, messages: [] })
  messages.forEach((message, index) => images.registerToolResult(`agp_${index}`, message))
  const working = new RuntimeImageWorkingSet(images)
  const sharedTail = messages.map(message => ({ ...message, content: message.content.slice() }))
  working.releasePersisted(messages)
  assert.equal(imageCount(messages), 4)
  assert.equal(imageCount(sharedTail), 4)
  assert.equal(messages[1]!.content[0]!.type, 'text')
  assert.deepEqual(original, before)
  assert.equal(imageCount(working.project(messages).messages as ToolResultMessage[]), 4)
})

function screenshot(id: string, data = Buffer.from(id).toString('base64')): ToolResultMessage {
  const content = [{ type: 'image' as const, data, mimeType: 'image/png' }]
  return { role: 'toolResult', toolName: 'termous.desktops.capture', toolCallId: id, timestamp: 1, isError: false, content,
    details: { kind: 'mcp', originalToolName: 'termous.desktops.capture', result: { content,
      structuredContent: { capture: { screenshot_id: id } } } } }
}

function imageCount(messages: ToolResultMessage[]) {
  return messages.reduce((count, message) => count + message.content.filter(block => block.type === 'image').length, 0)
}
