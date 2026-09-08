import { describe, expect, it } from 'vitest'
import type { AgentRetryActivity, AgentRunEvent } from '#entities/agent'
import { agentFixtureTime, agentMessageFixture, agentRunFixture, agentTextPartFixture } from '../../../features/agent-runtime/model/agentRuntimeTestFixtures.ts'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

const activity: AgentRetryActivity = {
  retry_id: 'retry-one', assistant_message_id: 'agm-assistant', purpose: 'response',
  status: 'waiting', attempt: 0, max_retries: 3, delay_ms: 2_000, error_message: '  request failed\n请稍后重试  ',
  after_part_sequence: 1, created_at: agentFixtureTime,
}

function retryEvent(sequence: number, patch: Partial<AgentRetryActivity> = {}): Extract<AgentRunEvent, { kind: 'retry' }> {
  return { id: `retry-${sequence}`, kind: 'retry', run_id: 'agr-run', generation: 1, sequence,
    created_at: agentFixtureTime, payload: { retry: { ...activity, ...patch } } }
}

describe('重试活动投影', () => {
  it('历史活动按正文、工具和摘要实际位置插入，同一位置按首次活动时间排序', () => {
    const message = agentMessageFixture({
      status: 'completed',
      parts: [agentTextPartFixture(), agentTextPartFixture({ id: 'after', sequence: 3 })],
      retries: [{ ...activity, status: 'completed', attempt: 1 }],
      compactions: [{ compaction_id: 'compact-one', assistant_message_id: activity.assistant_message_id,
        reason: 'threshold', status: 'completed', after_part_sequence: 1, tokens_before: 20_000,
        created_at: new Date(Date.parse(agentFixtureTime) + 100).toISOString() }],
    })
    const parts = projectAgentMessages([message], undefined, [])[0]!.parts
    expect(parts.map(({ kind }) => kind)).toEqual(['text', 'retry', 'compaction', 'text'])
    expect(parts[1]).toMatchObject({ id: 'retry:retry-one', activity: { attempt: 1 } })
  })

  it('位置零置于正文前，多次等待/请求更新同一行并保留初始锚点', () => {
    const message = agentMessageFixture({ parts: [agentTextPartFixture()] })
    const events = [retryEvent(1, { after_part_sequence: 0 }), retryEvent(2, { status: 'requesting', attempt: 1 }),
      retryEvent(3, { status: 'waiting', attempt: 1 }), retryEvent(4, { status: 'failed', attempt: 1, duration_ms: 3_000 })]
    const parts = projectAgentMessages([message], agentRunFixture(), events)[0]!.parts
    expect(parts.map(({ kind }) => kind)).toEqual(['retry', 'text'])
    expect(parts[0]).toMatchObject({ activity: { status: 'failed', attempt: 1, after_part_sequence: 0, duration_ms: 3_000 } })
  })

  it('历史终态领先时忽略迟到活动，其他消息、任务和代次均不混入', () => {
    const terminal = { ...activity, status: 'cancelled' as const, duration_ms: 900 }
    const message = agentMessageFixture({ retries: [terminal] })
    const events: AgentRunEvent[] = [retryEvent(1),
      retryEvent(2, { retry_id: 'other-message', assistant_message_id: 'other' }),
      { ...retryEvent(3, { retry_id: 'other-run' }), run_id: 'agr-other' },
      { ...retryEvent(4, { retry_id: 'other-generation' }), generation: 2 }]
    const parts = projectAgentMessages([message], agentRunFixture(), events)[0]!.parts
    expect(parts).toEqual([{ id: 'retry:retry-one', kind: 'retry', activity: terminal }])
  })

  it('历史原始错误与失败活动均完整投影，由渲染层统一处理重复展示', () => {
    const usage = { run_id: 'agr-run', usage: agentRunFixture().usage,
      error_code: 'AGENT_MODEL_PROVIDER_FAILED', error_message: activity.error_message }
    const message = agentMessageFixture({ status: 'failed', turn_usage: usage })
    expect(projectAgentMessages([message], undefined, [])[0]!.error_message).toBe(activity.error_message)
    const failed = { ...activity, status: 'failed' as const, attempt: 3, duration_ms: 10_000 }
    const projected = projectAgentMessages([{ ...message, retries: [failed] }], undefined, [])[0]!
    expect(projected.error_code).toBe(usage.error_code)
    expect(projected.error_message).toBe(activity.error_message)
    expect(projected.parts[0]).toMatchObject({ activity: { error_message: activity.error_message } })
    expect(projectAgentMessages([{ ...message, retries: [failed] }], agentRunFixture({
      status: 'failed', error_message: 'different final failure',
    }), [])[0]!.error_message).toBe('different final failure')
  })
})
