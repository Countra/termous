import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentApprovalModeFromBypass,
  agentApprovalModeToBypass,
} from './approvalMode.ts'

test('Agent 审核方式在展示语义与现有布尔合同之间稳定映射', () => {
  assert.equal(agentApprovalModeFromBypass(false), 'review')
  assert.equal(agentApprovalModeFromBypass(true), 'bypass')
  assert.equal(agentApprovalModeToBypass('review'), false)
  assert.equal(agentApprovalModeToBypass('bypass'), true)
})
