import assert from 'node:assert/strict'
import test from 'node:test'
import { readDesktopBatch, readDesktopBatchContent } from './index.ts'

const receipt = { run: { id: 'desktop_execution_test', state: 'stopped', accepted_actions: 1, text: 'private',
  steps: [{ index: 0, kind: 'keyboard.text', state: 'accepted', wait_after_ms: 100 }, { index: 1, kind: 'pointer.click', state: 'failed', wait_after_ms: 0, error_code: 'desktop_control_stale' }] }, capture_state: 'ready' }

test('回执投影保留部分失败事实并排除输入正文', () => {
  const result = readDesktopBatch(receipt)!
  assert.equal(result.accepted_actions, 1)
  assert.equal(result.steps[1].error_code, 'desktop_control_stale')
  assert.ok(!JSON.stringify(result).includes('private'))
  assert.deepEqual(readDesktopBatchContent('termous.desktops.execute', [{ type: 'text', text: JSON.stringify(receipt) }]), result)
  assert.equal(readDesktopBatchContent('other', [{ type: 'text', text: JSON.stringify(receipt) }]), undefined)
})

test('错误数量、非连续索引、超长步骤和截断正文不参与可信投影', () => {
  for (const run of [{ ...receipt.run, accepted_actions: 2 }, { ...receipt.run, steps: [...receipt.run.steps, ...receipt.run.steps, ...receipt.run.steps] },
    { ...receipt.run, steps: [{ ...receipt.run.steps[0], index: 1 }] }, { ...receipt.run, steps: [{ ...receipt.run.steps[0], wait_after_ms: -1 }] }]) {
    assert.equal(readDesktopBatch({ ...receipt, run }), undefined)
  }
  assert.equal(readDesktopBatchContent('termous.desktops.execute', [{ type: 'text', text: JSON.stringify(receipt).slice(0, -3) }]), undefined)
})

test('预检失败原因使用有界错误码，不能携带任意错误正文', () => {
  assert.equal(readDesktopBatch({ ...receipt, run: { ...receipt.run, error_code: 'desktop_capability_unsupported' } })?.error_code, 'desktop_capability_unsupported')
  assert.equal(readDesktopBatch({ ...receipt, run: { ...receipt.run, error_code: 'private input text' } })?.error_code, undefined)
})

test('长等待回执保持可恢复并拒绝越界等待', () => {
  for (const delay of [0, 500, 30000, 60000, 90000, -1, 90001, 500.5]) {
    const value = { ...receipt, run: { ...receipt.run, steps: receipt.run.steps.map(step => ({ ...step, wait_after_ms: delay })) } }
    const result = readDesktopBatchContent('termous.desktops.executions.get', [{ type: 'text', text: JSON.stringify(value) }])
    if (Number.isInteger(delay) && delay >= 0 && delay <= 90000) assert.equal(result?.steps[0].wait_after_ms, delay)
    else assert.equal(result, undefined)
  }
})
