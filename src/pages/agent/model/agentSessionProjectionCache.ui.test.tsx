import { expect, it } from 'vitest'
import type { AgentRun, AgentSession } from '#entities/agent'
import { createAgentSessionProjector } from './agentSessionProjectionCache.ts'

it('用量更新不重绘会话侧栏，状态、顺序和标题变化仍更新', () => {
  const project = createAgentSessionProjector()
  const sessions: AgentSession[] = [{ id: 'session', title: '原标题', model_id: 'model', reasoning_level: 'off', revision: 1, created_at: '', updated_at: '' }]
  const run = { id: 'run', session_id: 'session', status: 'running', model_id: 'model', queued_at: '', updated_at: '',
    model_snapshot: { model_id: 'model', provider_name: 'provider' } } as AgentRun
  const initial = project(sessions, [], [], { run })
  for (let i = 0; i < 2000; i++) {
    expect(project(sessions, [], [], { run: { ...run, event_sequence: i, updated_at: String(i) } })).toBe(initial)
  }
  expect(project(sessions, [], [], { run: { ...run, status: 'completed' } })[0]!.run_status).toBe('completed')
  expect(project([{ ...sessions[0]!, title: '新标题' }], [], [], { run })[0]!.title).toBe('新标题')
  expect(project([], [], [], {})).toEqual([])
})
