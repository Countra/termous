import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { agentRuntimeProtocolVersion } from '#common/contracts'
import { runtimeBootstrap, runtimeUserMessage } from '../test-support/runtimeBootstrapTestFixture.ts'
import { runtimeToolResponse } from '../test-support/runtimeToolResponseFixture.ts'
import { testAgentSkillBundle } from '../test-support/skillBundleTestFixture.ts'
import { createPiAgent } from './piAgentAdapter.ts'
import { RuntimeEventWriter } from './runtimeEventWriter.ts'
import type { RuntimeEventInput } from '../contracts/runtimeEvents.ts'

for (const api of ['responses', 'chat_completions'] as const) {
  for (const action of ['steer', 'stop'] as const) {
    test(`${api} wait 在真实 Pi 循环中暂停请求并响应 ${action}`, { timeout: 5000 }, async () => {
      const bootstrap = runtimeBootstrap()
      bootstrap.model.snapshot.api_mode = api
      bootstrap.model.snapshot.context_window_tokens = 32768
      bootstrap.messages = [runtimeUserMessage([], { text: '短暂等待后再观察。' })]
      const events: RuntimeEventInput[] = []
      let waiting = false, requests = 0
      const skills = testAgentSkillBundle()
      const writer = new RuntimeEventWriter({
        start: { type: 'start', protocol_version: agentRuntimeProtocolVersion, core_base_url: 'http://127.0.0.1:8122',
          ticket: 't'.repeat(48), run_id: bootstrap.run.id, generation: 1, skills },
        runtimeBearer: bootstrap.runtime_bearer, initialSequence: 1, onFailure: error => { throw error },
        core: { bootstrap: async () => bootstrap, appendAuditEvents: async () => {},
          appendEvents: async (_start, _bearer, batch) => {
            events.push(...batch)
            waiting ||= batch.some(event => event.kind === 'tool_progress' && JSON.stringify(event.payload).includes('waiting'))
            return batch[batch.length - 1]!.sequence
          }, appendSteer: async () => { throw new Error('追加指令已持久化') },
          commitCheckpoint: async () => { throw new Error('短上下文不应压缩') } },
      })
      const agent = createPiAgent({ bootstrap, events: writer, skills,
        mcp: { tools: [], originalName: () => null, close: async () => {} },
        commitCheckpoint: async () => { throw new Error('短上下文不应压缩') },
        fetch: async (_url, init) => {
          requests++
          assert.ok(requests <= 2, '等待期间不得轮询模型')
          if (requests === 1) return runtimeToolResponse(api, 'wait', { duration_seconds: 60, reason: '等待观察条件变化' })
          assert.match(String(init?.body), /立即检查状态/)
          assert.match(String(init?.body), /wake_reason/)
          return runtimeToolResponse(api)
        },
      })
      try {
        const running = agent.continue()
        for (let i = 0; i < 100 && !waiting; i++) await delay(5)
        assert.ok(waiting)
        await delay(30)
        assert.equal(requests, 1)
        if (action === 'steer') agent.steer('立即检查状态', { message_id: 'persisted-message', part_id: 'persisted-part' })
        else agent.abort()
        assert.equal(await running, action === 'steer' ? 'completed' : 'cancelled')
        await writer.flush()
        assert.equal(requests, action === 'steer' ? 2 : 1)
        assert.equal(events.filter(event => event.kind === 'steer_applied').length, action === 'steer' ? 1 : 0)
      } finally { agent.close(); await writer.close() }
    })
  }
}
