import assert from 'node:assert/strict'
import test from 'node:test'
import { AutomaticUpdateRetryPolicy } from './updateAutomaticCheckPolicy.ts'

test('自动检查失败使用有界指数退避且成功后清除', () => {
  const policy = new AutomaticUpdateRetryPolicy()
  const now = Date.parse('2026-07-26T00:00:00.000Z')

  assert.equal(policy.getRetryAt(), null)
  assert.equal(policy.recordFailure(now), now + 15 * 60 * 1000)
  assert.equal(policy.recordFailure(now), now + 30 * 60 * 1000)
  assert.equal(policy.recordFailure(now), now + 60 * 60 * 1000)

  for (let index = 0; index < 16; index += 1) {
    policy.recordFailure(now)
  }
  assert.equal(policy.getRetryAt(), now + 6 * 60 * 60 * 1000)

  policy.reset()
  assert.equal(policy.getRetryAt(), null)
  assert.equal(policy.recordFailure(now), now + 15 * 60 * 1000)
})

test('手动检查失败只延后自动检查且不会放大既有退避', () => {
  const policy = new AutomaticUpdateRetryPolicy()
  const now = Date.parse('2026-07-26T00:00:00.000Z')

  assert.equal(
    policy.deferAfterManualFailure(now),
    now + 15 * 60 * 1000,
  )
  assert.equal(
    policy.recordFailure(now),
    now + 15 * 60 * 1000,
  )
  assert.equal(
    policy.recordFailure(now),
    now + 30 * 60 * 1000,
  )
  assert.equal(
    policy.deferAfterManualFailure(now + 1_000),
    now + 30 * 60 * 1000,
  )
})
