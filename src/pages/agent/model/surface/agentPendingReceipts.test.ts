import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentPendingReceipts } from './agentPendingReceipts.ts'

test('接收超时后保留请求，显式重试沿用原 ID', async () => {
  const receipts = new AgentPendingReceipts()
  const ids: string[] = []
  await assert.rejects(receipts.start('file', async id => {
    ids.push(id)
    if (ids.length === 1) throw new Error('timeout')
  }))
  await assert.rejects(receipts.flush(false), /unconfirmed/)
  await receipts.flush()
  assert.equal(ids.length, 2)
  assert.equal(ids[0], ids[1])
  await receipts.flush()
  assert.equal(ids.length, 2)
})

test('同一草稿的新输入可覆盖旧失败，但其他附件仍需要确认', async () => {
  const receipts = new AgentPendingReceipts()
  await assert.rejects(receipts.start('draft', async () => { throw new Error('timeout') }))
  await receipts.start('draft', async () => undefined)
  let received = false
  let acknowledge!: () => void
  const file = receipts.start('file', () => new Promise<void>(resolve => { acknowledge = resolve }))
  const flush = receipts.flush().then(() => { received = true })
  await Promise.resolve()
  assert.equal(received, false)
  acknowledge()
  await Promise.all([file, flush])
  assert.equal(received, true)
})
