import { describe, expect, it } from 'vitest'
import type { AgentCompactionActivity, AgentRunEvent } from '#entities/agent'
import { agentFixtureTime, agentMessageFixture, agentRunFixture, agentTextPartFixture } from '../../../features/agent-runtime/model/agentRuntimeTestFixtures.ts'
import { projectAgentMessages } from './agentWorkspaceProjection.ts'

const activity: AgentCompactionActivity = {
  compaction_id: 'compact-one', status: 'started', reason: 'threshold',
  assistant_message_id: 'agm-assistant', after_part_sequence: 1,
  tokens_before: 27_000, created_at: agentFixtureTime,
}

describe('压缩活动投影', () => {
  it('在原始消息的正确位置插入活动，不依赖历史 Run 事件', () => {
    const message = agentMessageFixture({
      status: 'completed',
      parts: [agentTextPartFixture(), agentTextPartFixture({ id: 'after', sequence: 3, text: '继续处理' })],
      compactions: [{ ...activity, status: 'completed' }],
    })
    const projected = projectAgentMessages([message], undefined, [])[0]!
    expect(projected.parts.map(({ kind }) => kind)).toEqual(['text', 'compaction', 'text'])
    expect(projected.parts[1]).toMatchObject({ activity: { status: 'completed' } })
  })

  it('开始与完成事件归并到同一行，位置零位于正文前', () => {
    const message = agentMessageFixture({ parts: [agentTextPartFixture()] })
    const started: AgentRunEvent = {
      id: 'start', kind: 'compaction', run_id: 'agr-run', generation: 1, sequence: 1,
      created_at: agentFixtureTime, payload: { compaction: { ...activity, after_part_sequence: 0 } },
    }
    const completed: AgentRunEvent = {
      ...started, id: 'end', sequence: 2,
      payload: { compaction: { ...started.payload.compaction, status: 'completed', tokens_after: 8_000 } },
    }
    const parts = projectAgentMessages([message], agentRunFixture(), [started, completed])[0]!.parts
    expect(parts.map(({ kind }) => kind)).toEqual(['compaction', 'text'])
    expect(parts[0]).toMatchObject({ activity: { status: 'completed', tokens_after: 8_000 } })
  })

  it('完成快照不会被补拉的 started 事件倒退，并忽略其他消息的活动', () => {
    const message = agentMessageFixture({ compactions: [{ ...activity, status: 'completed' }] })
    const event: AgentRunEvent = {
      id: 'start', kind: 'compaction', run_id: 'agr-run', generation: 1, sequence: 1,
      created_at: agentFixtureTime, payload: { compaction: activity },
    }
    const parts = projectAgentMessages([message], agentRunFixture(), [event, {
      ...event, id: 'other', sequence: 2,
      payload: { compaction: { ...activity, compaction_id: 'other', assistant_message_id: 'other' } },
    }])[0]!.parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ activity: { status: 'completed' } })
  })

  it('历史记录保留当次窗口和耗时，旧补拉事件不抹掉已保存的统计', () => {
    const historical = {
      ...activity, status: 'completed' as const,
      tokens_before: 80_000, tokens_after: 30_000, context_window_tokens: 100_000, duration_ms: 2_400,
    }
    const message = agentMessageFixture({ compactions: [historical] })
    const event: AgentRunEvent = {
      id: 'complete', kind: 'compaction', run_id: 'agr-run', generation: 1, sequence: 2,
      created_at: agentFixtureTime,
      payload: { compaction: { ...activity, status: 'completed', tokens_before: 80_000, tokens_after: 30_000 } },
    }
    const historyOnly = projectAgentMessages([message], undefined, [])[0]!.parts[0]
    expect(historyOnly).toMatchObject({ activity: historical })
    const reconciled = projectAgentMessages([message], agentRunFixture(), [event])[0]!.parts[0]
    expect(reconciled).toMatchObject({ activity: historical })
  })
})
