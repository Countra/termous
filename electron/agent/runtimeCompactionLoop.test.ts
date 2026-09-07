import assert from 'node:assert/strict'
import test from 'node:test'
import { Agent } from '@earendil-works/pi-agent-core'
import { createAssistantMessageEventStream, type Context } from '@earendil-works/pi-ai'
import { Type } from 'typebox'
import {
  compactionTestAssistant,
  compactionTestModel,
  compactionTestUser,
  createCompactionTestHarness,
} from './runtimeCompactionTestFixture.ts'

test('真实 Pi loop 在工具结果和 steering 注入后压缩，随后继续同一 run', async () => {
  const harness = createCompactionTestHarness()
  const requests: Context[] = []
  const events: string[] = []
  const toolOutput = 'logs '.repeat(800)
  const steering = '新要求：保持 SSH Session 不变。' + 's'.repeat(800)
  const agent = new Agent({
    initialState: {
      model: compactionTestModel,
      systemPrompt: '',
      thinkingLevel: 'off',
      messages: [
        compactionTestUser('first ' + 'a'.repeat(4000)),
        compactionTestAssistant('first answer ' + 'b'.repeat(4000)),
        compactionTestUser('second ' + 'c'.repeat(4000)),
        compactionTestAssistant('second answer ' + 'd'.repeat(4000), 4000),
        compactionTestUser('检查当前日志'),
      ],
      tools: [{
        name: 'remote_read',
        label: 'Read logs',
        description: '读取已绑定连接的日志',
        parameters: Type.Object({}),
        execute: async () => {
          agent.steer(compactionTestUser(steering))
          return { content: [{ type: 'text', text: toolOutput }], details: {} }
        },
      }],
    },
    transformContext: harness.controller.transformContext,
    streamFn: (_model, context) => {
      harness.controller.beforeProviderRequest()
      requests.push(context)
      const message = requests.length === 1 ? {
        ...compactionTestAssistant('', 5800),
        stopReason: 'toolUse' as const,
        content: [{ type: 'toolCall' as const, id: 'read-1', name: 'remote_read', arguments: {} }],
      } : compactionTestAssistant('日志检查完成', 2000)
      const stream = createAssistantMessageEventStream()
      stream.push({ type: 'start', partial: message })
      stream.push({ type: 'done', reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop', message })
      return stream
    },
    toolExecution: 'sequential',
  })
  agent.subscribe((event) => { events.push(event.type) })
  await agent.continue()
  await agent.waitForIdle()
  assert.equal(requests.length, 2)
  assert.equal(harness.commits.length, 1)
  assert.equal(events.filter((type) => type === 'agent_start').length, 1)
  assert.equal(events.filter((type) => type === 'agent_end').length, 1)
  assert.match(JSON.stringify(requests[1]!.messages[0]), /compacted/u)
  const recentMessages = requests[1]!.messages
  assert.ok(recentMessages.some((message) => message.role === 'toolResult'
    && message.toolCallId === 'read-1' && JSON.stringify(message.content).includes(toolOutput)))
  assert.ok(recentMessages.some((message) => message.role === 'user' && message.content === steering))
  assert.equal(agent.state.isStreaming, false)
})

test('门禁失败经主 streamFn 进入 Pi 标准失败终态，不调用实际 Provider', async () => {
  const harness = createCompactionTestHarness()
  const events: string[] = []
  let providerCalls = 0
  const agent = new Agent({
    initialState: { model: compactionTestModel, messages: [compactionTestUser('x'.repeat(40000))] },
    transformContext: harness.controller.transformContext,
    streamFn: () => {
      harness.controller.beforeProviderRequest()
      providerCalls += 1
      throw new Error('unexpected provider dispatch')
    },
  })
  agent.subscribe((event) => { events.push(event.type) })
  await agent.continue()
  await agent.waitForIdle()
  assert.equal(providerCalls, 0)
  assert.equal(agent.state.isStreaming, false)
  assert.equal(agent.state.messages[agent.state.messages.length - 1]!.role, 'assistant')
  assert.deepEqual(events.slice(-3), ['message_end', 'turn_end', 'agent_end'])
  assert.match(agent.state.errorMessage!, /COMPRESSION_UNAVAILABLE/u)
})
