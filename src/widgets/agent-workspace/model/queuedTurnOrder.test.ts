import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOptimisticQueuedTurnOrder,
  moveQueuedTurnIDs,
  stepQueuedTurn,
} from './queuedTurnOrder.ts'

test('排队消息可按目标前后位置移动且不修改原数组', () => {
  const ids = ['first', 'second', 'third']

  assert.deepEqual(
    moveQueuedTurnIDs(ids, 'third', 'first', 'before')?.orderedIds,
    ['third', 'first', 'second'],
  )
  assert.deepEqual(
    moveQueuedTurnIDs(ids, 'first', 'third', 'after')?.orderedIds,
    ['second', 'third', 'first'],
  )
  assert.deepEqual(ids, ['first', 'second', 'third'])
})

test('排队消息忽略自身、缺失目标和未改变顺序的移动', () => {
  const ids = ['first', 'second', 'third']

  assert.equal(moveQueuedTurnIDs(ids, 'first', 'first', 'before'), undefined)
  assert.equal(moveQueuedTurnIDs(ids, 'missing', 'first', 'before'), undefined)
  assert.equal(moveQueuedTurnIDs(ids, 'first', 'missing', 'before'), undefined)
  assert.equal(moveQueuedTurnIDs(ids, 'first', 'second', 'before'), undefined)
  assert.equal(moveQueuedTurnIDs(ids, 'second', 'first', 'after'), undefined)
})

test('方向键移动只跨越相邻消息并正确处理列表边界', () => {
  const ids = ['first', 'second', 'third']

  assert.deepEqual(stepQueuedTurn(ids, 'second', -1), {
    sourceId: 'second', targetId: 'first', placement: 'before',
    orderedIds: ['second', 'first', 'third'],
  })
  assert.deepEqual(stepQueuedTurn(ids, 'second', 1), {
    sourceId: 'second', targetId: 'third', placement: 'after',
    orderedIds: ['first', 'third', 'second'],
  })
  assert.equal(stepQueuedTurn(ids, 'first', -1), undefined)
  assert.equal(stepQueuedTurn(ids, 'third', 1), undefined)
})

test('乐观顺序会移除已派发消息并保留并发新增消息', () => {
  const turns = [{ id: 'third' }, { id: 'first' }, { id: 'new' }]

  assert.deepEqual(
    applyOptimisticQueuedTurnOrder(turns, ['third', 'first', 'second']).map(({ id }) => id),
    ['third', 'first', 'new'],
  )
})
