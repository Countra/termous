import assert from 'node:assert/strict'
import test from 'node:test'
import { DetachedStatePublisher, DetachedStateReceiver } from './stateStream.ts'

test('释放投影副本后重新打开可交付完整快照，不沿用旧签名忽略数据', () => {
  const publisher = new DetachedStatePublisher()
  publisher.update({ message: '正文' })
  publisher.clear()
  assert.deepEqual(publisher.snapshot().partitions, {})
  assert.deepEqual(publisher.update({ message: '正文' })?.partitions, { message: '正文' })
  const receiver = new DetachedStateReceiver()
  assert.equal(receiver.accept(publisher.snapshot()), 'applied')
  assert.deepEqual(receiver.snapshot(), { message: '正文' })
})

test('初始化前缓冲更新，快照后按独立序号接续且拒绝旧帧', () => {
  const receiver = new DetachedStateReceiver()
  assert.equal(receiver.accept({ sequence: 2, full: false, partitions: { draft: 'new' } }), 'gap')
  assert.equal(receiver.accept({ sequence: 1, full: true, partitions: { draft: 'old', sessions: [1] } }), 'applied')
  assert.deepEqual(receiver.snapshot(), { draft: 'new', sessions: [1] })
  assert.equal(receiver.accept({ sequence: 1, full: true, partitions: {} }), 'ignored')
})

test('断档请求重同步，删除的分区不会残留', () => {
  const publisher = new DetachedStatePublisher()
  const receiver = new DetachedStateReceiver()
  publisher.update({ conversation: ['a'], sidebar: [1], archive: 'open' })
  receiver.accept(publisher.snapshot())
  publisher.update({ conversation: ['b'], sidebar: [1], archive: 'open' })
  const next = publisher.update({ conversation: ['c'], sidebar: [1] })!
  assert.deepEqual(Object.keys(next.partitions), ['conversation', 'archive'])
  assert.equal(receiver.accept(next), 'gap')
  assert.equal(receiver.accept(publisher.snapshot()), 'applied')
  assert.deepEqual(receiver.snapshot(), { conversation: ['c'], sidebar: [1] })
  assert.equal(publisher.update({ conversation: ['c'], sidebar: [1] }), undefined)
})

test('补快照仍落后于缺口时保留全部后续帧，下一次快照可完整接续', () => {
  const receiver = new DetachedStateReceiver()
  receiver.accept({ sequence: 0, full: true, partitions: { value: '初始' } })
  receiver.accept({ sequence: 3, full: false, partitions: { first: '三' } })
  receiver.accept({ sequence: 4, full: false, partitions: { last: '四' } })
  assert.equal(receiver.accept({ sequence: 1, full: true, partitions: { value: '一' } }), 'gap')
  assert.equal(receiver.accept({ sequence: 2, full: true, partitions: { value: '二' } }), 'applied')
  assert.deepEqual(receiver.snapshot(), { value: '二', first: '三', last: '四' })
})

test('增量移除消息分区后释放内容，再次出现时仍能恢复', () => {
  const publisher = new DetachedStatePublisher()
  const receiver = new DetachedStateReceiver()
  publisher.update({ message: '历史正文' })
  receiver.accept(publisher.snapshot())
  receiver.accept(publisher.update({})!)
  assert.deepEqual(receiver.snapshot(), {})
  receiver.accept(publisher.update({ message: '重新加载' })!)
  assert.deepEqual(receiver.snapshot(), { message: '重新加载' })
})

test('内容比较覆盖相同长度的文字、数组重排与字段移除', () => {
  const publisher = new DetachedStatePublisher()
  publisher.update({ part: { text: '甲', ids: ['one', 'two'], pending: true } })
  assert.equal(publisher.update({ part: { pending: true, ids: ['one', 'two'], text: '甲' } }), undefined)
  assert.deepEqual(publisher.update({ part: { text: '乙', ids: ['two', 'one'] } })?.partitions,
    { part: { text: '乙', ids: ['two', 'one'] } })
})

test('未设置的可选分区不反复发送删除帧，实际删除只通知一次', () => {
  const publisher = new DetachedStatePublisher()
  const receiver = new DetachedStateReceiver()
  assert.equal(publisher.update({ warning: undefined, archive: null }), undefined)
  publisher.update({ warning: 'reconnecting', archive: undefined })
  receiver.accept(publisher.snapshot())
  const cleared = publisher.update({ warning: undefined, archive: null })!
  assert.deepEqual(cleared.partitions, { warning: null })
  receiver.accept(cleared)
  assert.deepEqual(receiver.snapshot(), {})
  assert.deepEqual(publisher.snapshot().partitions, {})
  assert.equal(publisher.update({ warning: undefined, archive: undefined }), undefined)
  assert.equal(publisher.update({}), undefined)
})
