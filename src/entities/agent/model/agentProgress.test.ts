import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeAgentProgress } from './agentProgress.ts'
import { isAgentProgressData, type AgentProgressActivity } from '#common/contracts'

test('重复诊断合并保持首次位置；重连旧快照不回退恢复状态', () => {
  const first: AgentProgressActivity = { pattern_id: 'p', assistant_message_id: 'm', after_part_sequence: 2, tool_name: 'capture', reason: 'repeated_observation', status: 'detected', count: 3, guidance: '检查工具', next_tools: ['create'], created_at: '2026-10-15T00:00:00Z' }
  const later = mergeAgentProgress(first, { ...first, count: 6, after_part_sequence: 9 })
  assert.equal(later.after_part_sequence, 2)
  const recovered = mergeAgentProgress(later, { ...later, status: 'progressed' })
  assert.equal(mergeAgentProgress(recovered, later), recovered)
  assert.equal(mergeAgentProgress(recovered, first), recovered)
  assert.equal(mergeAgentProgress(recovered, { ...later, count: 12 }), recovered)
  assert.ok(isAgentProgressData(recovered))
  for (const change of [{ count: -1 }, { next_tools: Array(9).fill('x') }, { guidance: 'x'.repeat(2049) }, { reason: 'other' }]) assert.equal(isAgentProgressData({ ...first, ...change }), false)
})
