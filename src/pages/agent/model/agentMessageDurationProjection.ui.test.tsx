import { describe, expect, it } from 'vitest'
import type { AgentMessage, AgentRun } from '#entities/agent'
import { decodeAgentMessagePage } from '../../../features/agent-runtime/model/agentRuntimeProtocol.ts'
import { agentFixtureTime, agentMessageFixture, agentRunFixture } from '../../../features/agent-runtime/model/agentRuntimeTestFixtures.ts'
import { loadAgentMessages } from '../../../features/agent-runtime/runtime/loadAgentMessages.ts'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

const completedAt = '2026-08-29T00:00:02.400Z'
const historicalTiming = {
  run_id: 'agr-run', usage: agentRunFixture().usage,
  started_at: agentFixtureTime, completed_at: completedAt,
}
const message = (overrides: Partial<AgentMessage> = {}) => agentMessageFixture({
  status: 'completed', turn_usage: historicalTiming, ...overrides,
})
const duration = (item: AgentMessage, run?: AgentRun) => projectAgentMessages([item], run, [])[0]?.duration_ms

describe('消息本轮耗时投影', () => {
  it('优先使用匹配终态 Run 的完整起止时间，不计排队且独立于 Token 用量', () => {
    const run = agentRunFixture({
      status: 'completed', started_at: '2026-08-29T00:00:01Z', completed_at: completedAt,
      queued_at: '2026-08-28T23:59:00Z', updated_at: '2026-08-29T00:05:00Z',
    })
    const projected = projectAgentMessages([message()], run, [])[0]!
    expect(projected.duration_ms).toBe(1_400)
    expect(projected.usage).toBeUndefined()
  })

  it('主历史和归档共用的分页读取保留时间，并兼容缺少新字段的旧消息', async () => {
    const current = message()
    const legacy = message({
      id: 'agm-legacy', sequence: 3,
      turn_usage: { run_id: 'agr-legacy', usage: historicalTiming.usage },
    })
    const pages = [
      { items: [current], next_after_sequence: 2 },
      { items: [legacy] },
    ]
    const loaded = await loadAgentMessages({ messages: async () => decodeAgentMessagePage(pages.shift()) }, 'ags-session')
    const projected = projectAgentMessages(loaded, undefined, [])
    expect(projected.map(({ duration_ms }) => duration_ms)).toEqual([2_400, undefined])
    expect(projected.every(({ usage }) => usage === undefined)).toBe(true)
  })

  it('完成、失败、取消和中断均按整轮运行跨度计时', () => {
    for (const status of ['completed', 'failed', 'cancelled', 'interrupted'] as const) {
      const run = agentRunFixture({ status, completed_at: completedAt })
      const statusMessage = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : 'interrupted'
      expect(duration(message({ status: statusMessage }), run)).toBe(2_400)
    }
  })

  it('消息页已确认同一任务终态时，较旧的活动 Run 不遮蔽历史耗时和错误', () => {
    for (const status of ['queued', 'starting', 'running', 'waiting_approval', 'stopping'] as const) {
      const run = agentRunFixture({ status, completed_at: completedAt, error_code: 'AGENT_RUN_STEERED' })
      expect(duration(message(), run)).toBe(2_400)
      const projected = projectAgentMessages([message({ status: 'failed', turn_usage: {
        ...historicalTiming, error_code: 'AGENT_RUNTIME_FAILURE', error_message: '原始错误\n第二行',
      } })], run, [])[0]!
      expect(projected.status).toBe('failed')
      expect(projected.error_code).toBe('AGENT_RUNTIME_FAILURE')
      expect(projected.error_message).toBe('原始错误\n第二行')
      expect(duration(message({ turn_usage: undefined }), run)).toBeUndefined()
    }
  })

  it('用户和流式消息不展示本轮耗时', () => {
    const run = agentRunFixture({ status: 'completed', completed_at: completedAt })
    expect(duration(message({ role: 'user' }), run)).toBeUndefined()
    for (const status of ['pending', 'streaming'] as const) {
      expect(duration(message({ status }), run)).toBeUndefined()
    }
  })

  it('不借用其他会话或其他回复的 Run 时间，缺少实时完整时间对时回退历史', () => {
    const run = agentRunFixture({ status: 'completed', started_at: '2026-08-29T00:00:01Z', completed_at: completedAt })
    expect(duration(message(), { ...run, session_id: 'ags-other' })).toBe(2_400)
    expect(duration(message(), { ...run, assistant_message_id: 'agm-other' })).toBe(2_400)
    expect(duration(message(), { ...run, completed_at: undefined })).toBe(2_400)
    expect(duration(message({ turn_usage: undefined }), { ...run, completed_at: undefined })).toBeUndefined()
  })

  it('缺失、倒序或非有限时间不生成耗时，零毫秒仍为合法结果', () => {
    const invalidTimings = [
      { started_at: undefined, completed_at: completedAt },
      { started_at: agentFixtureTime, completed_at: undefined },
      { started_at: completedAt, completed_at: agentFixtureTime },
      { started_at: 'invalid', completed_at: completedAt },
      { started_at: agentFixtureTime, completed_at: '999999-01-01T00:00:00Z' },
    ]
    for (const timing of invalidTimings) {
      expect(duration(message({ turn_usage: { ...historicalTiming, ...timing } }))).toBeUndefined()
      expect(duration(message({ turn_usage: undefined }), agentRunFixture({ status: 'cancelled', ...timing }))).toBeUndefined()
    }
    expect(duration(message(), agentRunFixture({ status: 'completed', completed_at: agentFixtureTime }))).toBe(0)
    expect(duration(message({ turn_usage: { ...historicalTiming, completed_at: agentFixtureTime } }))).toBe(0)
  })
})
